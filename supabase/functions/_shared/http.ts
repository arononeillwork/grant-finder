// Shared HTTP helpers for all edge functions.
export const SITE_URL = (Deno.env.get("SITE_URL") ?? "http://localhost:3000").replace(/\/$/, "");

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Hashed client IP, used only for rate limiting (never stored raw). */
export async function ipHash(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|solicita"));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Returns true if this IP has made `perDay` requests of `kind` in the last 24h; otherwise logs one. */
// deno-lint-ignore no-explicit-any
export async function rateLimited(sb: any, kind: string, ip: string, perDay: number) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { count } = await sb.from("request_log").select("id", { count: "exact", head: true })
    .eq("kind", kind).eq("ip_hash", ip).gte("created_at", since);
  if ((count ?? 0) >= perDay) return true;
  await sb.from("request_log").insert({ kind, ip_hash: ip });
  return false;
}
