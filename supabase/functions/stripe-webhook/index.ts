// Stripe webhook (deploy with --no-verify-jwt). Verifies Stripe's signature itself.
// Events: checkout.session.completed (setup), invoice.paid, invoice.payment_failed.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { stripe } from "../_shared/stripe.ts";

async function verify(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const t = header.split(",").find((p) => p.startsWith("t="))?.slice(2);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((acc, ch, i) => acc | (ch.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return new Response("Webhook secret not configured", { status: 500 });
  const raw = await req.text();
  if (!(await verify(raw, req.headers.get("stripe-signature"), secret))) return new Response("Bad signature", { status: 400 });

  const event = JSON.parse(raw);
  const obj = event.data?.object ?? {};
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (event.type === "checkout.session.completed" && obj.mode === "setup") {
      const caseId = obj.metadata?.case_id;
      const si = await stripe("GET", `setup_intents/${obj.setup_intent}`);
      const pmId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
      if (caseId && pmId) {
        const pm = await stripe("GET", `payment_methods/${pmId}`);
        await stripe("POST", `customers/${obj.customer}`, { invoice_settings: { default_payment_method: pmId } });
        await sb.from("cases").update({ stripe_payment_method_id: pmId, payment_method_type: pm.type, payment_setup_at: new Date().toISOString() }).eq("id", caseId);
        // Any fee that was waiting for a payment method can now be charged
        await sb.from("case_grants").update({ fee_status: "due", fee_error: null }).eq("case_id", caseId).eq("fee_status", "awaiting_method");
      }
    } else if (event.type === "invoice.paid") {
      await sb.from("case_grants").update({ fee_status: "paid", fee_paid_at: new Date().toISOString(), fee_error: null }).eq("stripe_invoice_id", obj.id);
    } else if (event.type === "invoice.payment_failed") {
      const msg = obj.last_finalization_error?.message ?? "Payment failed. Stripe will retry and email the client a payment link.";
      await sb.from("case_grants").update({ fee_status: "failed", fee_error: msg }).eq("stripe_invoice_id", obj.id);
    }
  } catch (e) {
    console.error("webhook", event.type, e);
    return new Response("Handler error", { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
