// Creates a Stripe Checkout session (mode=setup) so a done-for-you client saves a card or SEPA mandate.
// Nothing is charged here. Requires ref + the email used on the case.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { cors, json, ipHash, rateLimited, SITE_URL } from "../_shared/http.ts";
import { stripe, stripeReady } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: { ref?: string; email?: string };
  try { b = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const ref = String(b.ref ?? "").trim().toUpperCase().slice(0, 12);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!ref || !email) return json({ error: "Reference and email are required." }, 400);
  if (!stripeReady()) return json({ status: "not_configured" });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (await rateLimited(sb, "pay", await ipHash(req), 15)) return json({ error: "Too many attempts today." }, 429);

  const { data: c } = await sb.from("cases").select("id, ref, tier, nif, company, profile, contact_name, contact_email, stripe_customer_id, stripe_payment_method_id")
    .eq("ref", ref).eq("tier", "dfy").maybeSingle();
  if (!c || String(c.contact_email).toLowerCase() !== email) return json({ error: "We couldn’t find a request with that reference and email." }, 404);
  if (c.stripe_payment_method_id) return json({ status: "already_done" });

  try {
    let customer = c.stripe_customer_id as string | null;
    if (!customer) {
      const cu = await stripe("POST", "customers", {
        // deno-lint-ignore no-explicit-any
        name: (c.company as any)?.name || (c.profile as any)?.name || c.contact_name || undefined,
        email: c.contact_email,
        preferred_locales: ["es", "en"],
        metadata: { case_ref: c.ref, case_id: c.id, contact_name: c.contact_name ?? "" },
      }, `cus-${c.id}`);
      customer = cu.id;
      if (c.nif) { try { await stripe("POST", `customers/${customer}/tax_ids`, { type: "es_cif", value: c.nif }); } catch (e) { console.warn("tax id", (e as Error).message); } }
      await sb.from("cases").update({ stripe_customer_id: customer }).eq("id", c.id);
    }
    const s = await stripe("POST", "checkout/sessions", {
      mode: "setup",
      customer,
      currency: "eur",
      payment_method_types: ["card", "sepa_debit"],
      success_url: `${SITE_URL}/?setup=done&ref=${c.ref}`,
      cancel_url: `${SITE_URL}/?setup=cancel&ref=${c.ref}`,
      metadata: { case_id: c.id, case_ref: c.ref },
      setup_intent_data: { metadata: { case_id: c.id, case_ref: c.ref } },
    });
    return json({ status: "ok", url: s.url });
  } catch (e) {
    console.error("payment-setup", e);
    return json({ error: "Payment setup is unavailable right now. We’ll email you a link." }, 502);
  }
});
