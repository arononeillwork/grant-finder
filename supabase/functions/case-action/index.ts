import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SITE, cors, json, esc, eur, fmtDate, ownerEmail, sendMail, readToken, actionLink, layout, p, btn, loadCase, bizName } from "../_shared/mail.ts";

const RANK: Record<string, number> = { selected: 0, preparing: 0, submitted: 1, rejected: 2, awarded: 2, paid: 3, withdrawn: 9 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: { t?: string; mode?: string; amount?: number; reg?: string };
  try { b = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tok = await readToken(sb, b.t ?? "");
  if (!tok) return json({ error: "This link has expired or isn’t valid. Reply to our last email and we’ll help." }, 400);

  // Owner: confirm a grant was re-checked against its official source
  if (tok.a === "verify") {
    const { data: g } = await sb.from("grants").select("id, name, source_url, verified_at").eq("id", tok.g).maybeSingle();
    if (!g) return json({ error: "Grant not found." }, 404);
    if (b.mode !== "apply") return json({ title: "Confirm official check", desc: `${g.name}. Only confirm after opening the official source and finding no changes.`, link: g.source_url, needs: null });
    await sb.from("grants").update({ verified_at: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq("id", g.id);
    return json({ ok: true, message: `${g.name} marked as checked today.` });
  }

  const { c, grants } = await loadCase(sb, tok.c);
  const cg = grants.find((x: any) => x.grant_id === tok.g);
  if (!c || !cg) return json({ error: "Case not found." }, 404);
  const gname = cg.grants.name, biz = bizName(c), feeTrigger = cg.grants.fee_trigger;
  const META: Record<string, { title: string; needs: string | null; to: string }> = {
    submitted: { title: "Mark as submitted", needs: "reg", to: "submitted" },
    awarded: { title: "Mark as awarded", needs: "amount", to: "awarded" },
    rejected: { title: "Mark as rejected", needs: null, to: "rejected" },
    paid: { title: "Mark grant money as received", needs: cg.amount_awarded ? null : "amount", to: "paid" },
    client_paid: { title: "Has your grant money arrived?", needs: cg.amount_awarded ? null : "amount", to: "paid" },
  };
  const m = META[tok.a];
  if (!m) return json({ error: "Unknown action." }, 400);
  const desc = tok.a === "client_paid"
    ? `${gname}${cg.amount_awarded ? `: ${eur(cg.amount_awarded)}` : ""} for ${biz}. Confirm once the money is in your bank account.`
    : `${gname} for ${biz} (${c.ref}). Current status: ${cg.status}.`;
  if (b.mode !== "apply") return json({ title: m.title, desc, needs: m.needs, current: cg.status, client: tok.a === "client_paid" });

  if (cg.status === m.to) return json({ ok: true, message: "Already recorded. Nothing changed." });
  if ((RANK[cg.status] ?? 0) > RANK[m.to] && !(m.to === "paid")) return json({ error: `This grant is already marked as ${cg.status}.` }, 409);
  if (cg.status === "rejected" && m.to !== "awarded") return json({ error: "This grant was marked as rejected." }, 409);

  const now = new Date().toISOString();
  const amount = Number(b.amount);
  // deno-lint-ignore no-explicit-any
  const upd: any = { status: m.to };
  if (m.to === "submitted") { upd.submitted_at = now; upd.registration_no = String(b.reg ?? "").slice(0, 80) || null; }
  if (m.to === "awarded") { if (!(amount > 0)) return json({ error: "Enter the awarded amount." }, 400); upd.amount_awarded = amount; upd.awarded_at = now; }
  if (m.to === "paid") { if (!cg.amount_awarded && !(amount > 0)) return json({ error: "Enter the amount received." }, 400); if (!cg.amount_awarded) upd.amount_awarded = amount; if (!cg.awarded_at) upd.awarded_at = now; upd.paid_at = now; }
  const { error } = await sb.from("case_grants").update(upd).eq("case_id", c.id).eq("grant_id", cg.grant_id);
  if (error) { console.error(error); return json({ error: "Couldn’t save. Please try again." }, 500); }
  if (m.to === "submitted") await sb.from("cases").update({ status: "submitted" }).eq("id", c.id).eq("status", "new");

  const first = esc((c.contact_name || "").split(" ")[0] || "there");
  const amt = upd.amount_awarded ?? cg.amount_awarded;
  const feeLine = c.tier === "dfy" && amt ? `Our fee is ${eur(Math.max(Math.round(amt * 0.03), 150))} + IVA (3%, minimum €150), charged to your saved payment method; Stripe emails you the invoice.` : "";
  const mail = async (subject: string, title: string, body: string, kind: string) =>
    sendMail(sb, { to: c.contact_email, subject: `${subject} (${c.ref})`, html: layout(title, p(`Hi ${first},`) + body), caseId: c.id, kind, dedupe: `${kind}:${c.id}:${cg.grant_id}` });

  let message = "Saved.";
  if (tok.a === "submitted") {
    await mail(`Application submitted: ${gname}`, "Your application has been submitted",
      p(`We’ve submitted your application for <b>${esc(gname)}</b>${upd.registration_no ? `. Official registration number: <b>${esc(upd.registration_no)}</b>` : ""}.`)
      + p("Official notices come to us as your representative. We’ll email you if the administration asks for anything, and when there’s a decision."), "status_submitted");
    message = "Marked as submitted. The client has been emailed.";
  } else if (tok.a === "awarded") {
    const body = feeTrigger === "award"
      ? p(`Good news: <b>${esc(gname)}</b> has been awarded: <b>${eur(amount)}</b>.`) + p(feeLine)
      : p(`Good news: <b>${esc(gname)}</b> has been awarded: <b>${eur(amount)}</b>.`) + p("When the money reaches your bank account, please tell us with one click:") + btn(await actionLink(sb, c.id, cg.grant_id, "client_paid", 365), "Yes, it’s arrived", "#1D7A46") + p(feeLine.replace("charged", "charged at that point"));
    await mail(`Grant awarded: ${gname}`, "Your grant has been awarded", body, "status_awarded");
    message = feeTrigger === "award" ? "Marked as awarded. The client has been emailed and the fee will be charged within 10 minutes." : "Marked as awarded. The client has been emailed and will confirm when the money arrives.";
  } else if (tok.a === "rejected") {
    await mail(`Update on ${gname}`, "Update on your application", p(`Unfortunately the application for <b>${esc(gname)}</b> was not successful. There’s no fee to pay. Reply to this email if you’d like us to look at other options.`), "status_rejected");
    message = "Marked as rejected. The client has been emailed; no fee will be charged.";
  } else {
    if (tok.a === "paid") await mail(`Grant received: ${gname}`, "Great news: your grant has been paid", p(`We’ve recorded that your <b>${esc(gname)}</b> money has arrived.`) + p(feeLine), "status_paid");
    await sendMail(sb, { to: ownerEmail(), subject: `${tok.a === "client_paid" ? "Client confirmed" : "Recorded"}: grant money received, ${biz} (${c.ref})`, caseId: c.id, kind: "owner_paid", dedupe: `ownerpaid:${c.id}:${cg.grant_id}`,
      html: layout("Grant money received", p(`<b>${esc(gname)}</b> for ${esc(biz)}: ${eur(amt)}.`) + p(c.tier === "dfy" ? `The fee (${eur(Math.max(Math.round(amt * 0.03), 150))} + IVA) will be charged within 10 minutes${c.stripe_payment_method_id ? "." : ", but the client hasn’t saved a payment method yet: send them " + `${SITE}/?pay=${c.ref}`}` : "")) });
    message = tok.a === "client_paid" ? "Thank you! We’ve recorded that your grant money has arrived. Your invoice will follow by email." : "Marked as received. The fee will be charged within 10 minutes.";
  }
  return json({ ok: true, message });
});
