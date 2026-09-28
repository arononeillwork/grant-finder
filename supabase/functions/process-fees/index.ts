// Runs every 10 minutes (pg_cron). Charges due success fees: 3% of the awarded amount (min €150) + 21% IVA,
// as a Stripe invoice collected automatically from the client's saved card/SEPA mandate.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { stripe } from "../_shared/stripe.ts";

const RATE = 0.03;           // 3% success fee
const MIN_FEE_CENTS = 15000; // €150 minimum per grant
const IVA = 21;

async function ivaRate(): Promise<string> {
  const list = await stripe("GET", "tax_rates", { active: true, limit: 100 });
  // deno-lint-ignore no-explicit-any
  const found = list.data.find((t: any) => Number(t.percentage) === IVA && !t.inclusive && t.display_name === "IVA");
  if (found) return found.id;
  const t = await stripe("POST", "tax_rates", { display_name: "IVA", percentage: IVA, inclusive: false, country: "ES", description: "IVA 21%" }, "iva-21-es");
  return t.id;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!Deno.env.get("STRIPE_SECRET_KEY")) return Response.json({ skipped: "stripe_not_configured" });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: due } = await sb.from("case_grants")
    .select("case_id, grant_id, amount_awarded, stripe_invoice_id, grants(name), cases(ref, stripe_customer_id, stripe_payment_method_id)")
    .eq("fee_status", "due").limit(20);
  const results: unknown[] = [];
  let taxRate: string | null = null;

  for (const row of due ?? []) {
    // Claim the row so two runs never charge twice
    const { data: claimed } = await sb.from("case_grants").update({ fee_status: "invoicing" })
      .eq("case_id", row.case_id).eq("grant_id", row.grant_id).eq("fee_status", "due").select("case_id");
    if (!claimed?.length) continue;
    // deno-lint-ignore no-explicit-any
    const c: any = row.cases, g: any = row.grants;
    const fail = async (status: string, msg: string) => { await sb.from("case_grants").update({ fee_status: status, fee_error: msg }).eq("case_id", row.case_id).eq("grant_id", row.grant_id); results.push({ ref: c?.ref, grant: row.grant_id, status, msg }); };

    if (!row.amount_awarded) { await fail("not_due", "No awarded amount recorded."); continue; }
    if (!c?.stripe_customer_id || !c?.stripe_payment_method_id) { await fail("awaiting_method", "Client hasn’t authorised a payment method yet. Send them the payment link."); continue; }

    const fee = Math.max(Math.round(Number(row.amount_awarded) * RATE * 100), MIN_FEE_CENTS);
    const key = `${row.case_id}-${row.grant_id}`;
    try {
      taxRate ??= await ivaRate();
      const inv = await stripe("POST", "invoices", {
        customer: c.stripe_customer_id,
        collection_method: "charge_automatically",
        default_payment_method: c.stripe_payment_method_id,
        default_tax_rates: [taxRate],
        auto_advance: true,
        description: `Grant application service, case ${c.ref}`,
        metadata: { case_id: row.case_id, grant_id: row.grant_id, case_ref: c.ref },
      }, `inv-${key}`);
      await stripe("POST", "invoiceitems", {
        customer: c.stripe_customer_id,
        invoice: inv.id,
        currency: "eur",
        amount: fee,
        description: `${g?.name ?? row.grant_id}: 3% of €${Number(row.amount_awarded).toLocaleString("es-ES")} awarded (minimum €150)`,
      }, `ii-${key}`);
      await sb.from("case_grants").update({ stripe_invoice_id: inv.id, fee_charged: fee / 100 }).eq("case_id", row.case_id).eq("grant_id", row.grant_id);
      await stripe("POST", `invoices/${inv.id}/finalize`, {}, `fin-${key}`);
      try {
        await stripe("POST", `invoices/${inv.id}/pay`, {}, `pay-${key}`);
      } catch (e) {
        // SEPA debits settle over days; card declines are retried by Stripe. The webhook records the outcome.
        console.warn("pay", (e as Error).message);
      }
      await sb.from("case_grants").update({ fee_status: "invoiced", fee_error: null }).eq("case_id", row.case_id).eq("grant_id", row.grant_id).eq("fee_status", "invoicing");
      results.push({ ref: c.ref, grant: row.grant_id, status: "invoiced", fee: fee / 100 });
    } catch (e) {
      console.error("fee", key, e);
      await fail("failed", (e as Error).message);
    }
  }
  return Response.json({ processed: results.length, results });
});
