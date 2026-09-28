// Validates a NIF/NIE/CIF and, for companies, looks up Registro Mercantil data via APIEmpresas.
// Secrets: APIEMPRESAS_KEY (optional; without it the site asks the user to type details).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, json, ipHash, rateLimited } from "../_shared/http.ts";
import { checkNif } from "../_shared/nif.ts";

const ANDALUCIA = ["almeria", "cadiz", "cordoba", "granada", "huelva", "jaen", "malaga", "sevilla"];
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// APIEmpresas field names are not fully verified: this accepts several likely names.
function normalise(raw: Record<string, unknown>) {
  const d = (raw?.data ?? raw) as Record<string, unknown>;
  const pick = (...k: string[]) => { for (const x of k) if (d?.[x] != null && d[x] !== "") return d[x]; return null; };
  const province = pick("province", "provincia") as string | null;
  const p = norm(province);
  const founded = pick("founded", "founded_at", "incorporation_date", "constitution_date", "fecha_constitucion", "date_constitution") as string | null;
  const cnae = pick("cnae", "cnae_code") as string | null;
  return {
    name: pick("name", "razon_social", "company_name"),
    status: pick("status", "estado"),
    province,
    provinceKey: !p ? null : p === "malaga" ? "malaga" : ANDALUCIA.includes(p) ? "andalucia" : "outside",
    municipality: pick("municipality", "municipio", "city", "localidad"),
    address: pick("address", "domicilio", "domicilio_social"),
    cnae,
    cnaeLabel: pick("cnae_label", "cnae_description", "actividad"),
    hospitality: cnae ? /^5[56]/.test(String(cnae)) : null,
    founded,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: { nif?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const v = checkNif(body.nif ?? "");
  if (!v.ok) return json({ valid: false, message: v.msg }, 200);
  const base = { valid: true, nif: v.v, type: v.type, entity: v.entity, label: v.label };
  if (v.type !== "cif") return json({ ...base, lookup: "not_public", message: "Autónomos aren’t in any public register." });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cached } = await sb.from("company_cache").select("data, fetched_at").eq("nif", v.v).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 30 * 864e5) {
    return json({ ...base, lookup: "found", cached: true, company: normalise(cached.data) });
  }

  const key = Deno.env.get("APIEMPRESAS_KEY");
  if (!key) return json({ ...base, lookup: "not_configured" });

  const ip = await ipHash(req);
  if (await rateLimited(sb, "lookup", ip, 20)) return json({ ...base, lookup: "rate_limited", message: "Too many lookups today. Enter the details by hand." });

  try {
    const r = await fetch(`https://apiempresas.es/api/v1/companies?cif=${encodeURIComponent(v.v)}`, {
      headers: { "X-API-KEY": key, Accept: "application/json" },
    });
    if (r.status === 404) return json({ ...base, lookup: "not_found" });
    if (!r.ok) { console.error("apiempresas", r.status, await r.text()); return json({ ...base, lookup: "error" }); }
    const raw = await r.json();
    if (raw?.success === false || !(raw?.data ?? raw)) return json({ ...base, lookup: "not_found" });
    await sb.from("company_cache").upsert({ nif: v.v, provider: "apiempresas", data: raw, fetched_at: new Date().toISOString() });
    return json({ ...base, lookup: "found", company: normalise(raw) });
  } catch (e) {
    console.error("lookup failed", e);
    return json({ ...base, lookup: "error" });
  }
});
