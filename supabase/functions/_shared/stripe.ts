// Minimal Stripe REST client (form-encoded), no SDK needed.
export const stripeReady = () => !!Deno.env.get("STRIPE_SECRET_KEY");

// deno-lint-ignore no-explicit-any
function enc(obj: Record<string, any>, prefix = "", out: string[] = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => typeof x === "object" ? enc(x, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`));
    else if (typeof v === "object") enc(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export async function stripe(method: string, path: string, params?: Record<string, any>, idem?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idem) headers["Idempotency-Key"] = idem;
  let url = `https://api.stripe.com/v1/${path}`;
  let body: string | undefined;
  if (params) { const q = enc(params).join("&"); if (method === "GET") url += `?${q}`; else body = q; }
  const r = await fetch(url, { method, headers, body });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? `Stripe error ${r.status}`);
  return j;
}
