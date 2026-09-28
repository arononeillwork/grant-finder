// Saves a DIY or done-for-you case and returns signed upload URLs, one per document (matched by doc type).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, json, ipHash, rateLimited } from "../_shared/http.ts";

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/rtf", "text/rtf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_FILES = 40, MAX_BYTES = 10 * 1024 * 1024;
const clean = (s: unknown, n = 200) => String(s ?? "").slice(0, n).trim();
const refCode = () => "SOL-" + Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const tier = b.tier === "dfy" ? "dfy" : b.tier === "diy" ? "diy" : null;
  if (!tier) return json({ error: "Choose a service tier." }, 400);
  const email = clean(b.contact?.email, 200);
  const name = clean(b.contact?.name, 120);
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
  if (!b.consents?.data) return json({ error: "Please agree to the data use." }, 400);
  if (tier === "dfy" && (!name || !b.consents?.fee)) return json({ error: "Name and both agreements are required." }, 400);

  const grantIds: string[] = Array.isArray(b.grants) ? b.grants.map((g: { id: string }) => clean(g.id, 60)).slice(0, 20) : [];
  if (!grantIds.length) return json({ error: "Select at least one grant." }, 400);
  const files = tier === "dfy" && Array.isArray(b.files) ? b.files.slice(0, MAX_FILES) : [];
  for (const f of files) {
    if (!ALLOWED.includes(f.type)) return json({ error: `${clean(f.name, 80)}: please upload a PDF, photo or Word/RTF document.` }, 400);
    if (!(f.size > 0 && f.size <= MAX_BYTES)) return json({ error: `${clean(f.name, 80)}: files must be under 10 MB.` }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (await rateLimited(sb, "case", await ipHash(req), 10)) return json({ error: "Too many requests today. Please email us instead." }, 429);

  const { data: grants } = await sb.from("grants").select("id").in("id", grantIds).eq("active", true);
  if (!grants?.length) return json({ error: "Those grants are no longer available." }, 400);
  const valid = new Set(grants.map((g) => g.id));
  const { data: docTypes } = await sb.from("document_types").select("id");
  const validDocs = new Set((docTypes ?? []).map((d) => d.id));

  const ref = refCode();
  const { data: kase, error: cErr } = await sb.from("cases").insert({
    ref, tier,
    nif: clean(b.nif, 12) || null,
    company: b.company ?? {},
    profile: b.profile ?? {},
    contact_name: name || null,
    contact_email: email,
    contact_phone: clean(b.contact?.phone, 40) || null,
    consent_data: !!b.consents?.data,
    consent_fee: !!b.consents?.fee,
    consent_at: new Date().toISOString(),
  }).select("id, ref").single();
  if (cErr) { console.error(cErr); return json({ error: "Could not save your request." }, 500); }

  await sb.from("case_grants").insert(b.grants.filter((g: { id: string }) => valid.has(g.id)).map((g: { id: string; amount?: number; fee?: number }) => ({
    case_id: kase.id, grant_id: g.id,
    amount_estimate: Number.isFinite(g.amount) ? g.amount : null,
    fee_estimate: Number.isFinite(g.fee) ? g.fee : null,
  })));

  const uploads = [];
  for (const f of files) {
    const docType = validDocs.has(f.doc) ? f.doc : null;
    const safe = clean(f.name, 100).replace(/[^\w.\-]+/g, "_");
    const path = `${kase.id}/${docType ?? "other"}/${crypto.randomUUID()}-${safe}`;
    const { data: s, error } = await sb.storage.from("case-documents").createSignedUploadUrl(path);
    if (error) { console.error(error); continue; }
    await sb.from("case_documents").insert({ case_id: kase.id, doc_type_id: docType, storage_path: path, file_name: clean(f.name, 200), mime_type: f.type, size_bytes: f.size });
    uploads.push({ key: f.key, path, token: s.token });
  }
  return json({ ref: kase.ref, uploads });
});
