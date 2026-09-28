import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { SITE, esc, eur, fmtDate, ownerEmail, mailReady, sendMail, actionLink, layout, p, h2, ul, btn, kv, loadCase, bizName, docStatus } from "../_shared/mail.ts";

const LABELS: Record<string, string> = {
  entity: "Business type", sector: "Sector", province: "Province", town: "Town size", employees: "Employees", debts: "Debts with Hacienda/SS",
  alta: "Autónomo registration", tarifaPlana: "Tarifa plana", empadronado: "Padrón in Andalucía", age: "Age (oldest partner)", gender: "Gender",
  education: "ESO or higher", turnover: "Turnover ≥ €100k", hiring: "Hiring full-time 6+ months", candidate: "Candidate", replaceEquip: "Old equipment to replace",
  rta: "Registro de Turismo", energyProject: "Energy project ≥ €11k", kitBefore: "Had Kit Digital", unemployed: "Receiving paro",
};

// deno-lint-ignore no-explicit-any
async function sendConfirmations(sb: any, c: any, grants: any[]) {
  const { files, missing, prepared } = await docStatus(sb, c, grants);
  const biz = esc(bizName(c));
  const first = esc((c.contact_name || "").split(" ")[0] || "there");
  const dl = (g: any) => g.grants.window_state === "open" && g.grants.closes ? ` (deadline ${fmtDate(g.grants.closes)})` : "";
  let client: string, subject: string;

  if (c.tier === "dfy") {
    subject = `We’ve received your grant request (${c.ref})`;
    client = p(`Hi ${first},`) + p(`Thanks. We’ve received your request for <b>${biz}</b>. Your reference is <b>${esc(c.ref)}</b>.`)
      + h2("Grants you asked us to apply for") + ul(grants.map((g) => `${esc(g.grants.name)}${dl(g)}${g.fee_estimate ? ` <span style="color:#5A6876">(our fee if awarded: ${eur(g.fee_estimate)} + IVA)</span>` : ""}`))
      + h2("Documents received") + (files.length ? ul(files.map((f) => `${esc(f.doc)}: ${esc(f.name)}`)) : p("None yet."))
      + (missing.length ? h2("Still needed") + ul(missing.map((d) => esc(d.name))) + p("Reply to this email with them attached, one document per file.") : "")
      + (prepared.length ? p(`We’ll prepare for you: ${prepared.map((d) => esc(d.name)).join(", ")}.`) : "")
      + h2("What happens next") + ul(["We check your documents within one working day.", "We email you the service agreement to sign.", "You authorise us to submit for you (the signed template, or online in the REA register).", "We submit and email you the official registration number. Official notices come to us as your representative, and we’ll tell you if anything is needed."])
      + (!c.stripe_payment_method_id ? h2("One last step") + p("Choose how we charge our fee: card or bank direct debit. Nothing is charged until your grant money arrives.") + btn(`${SITE}/?pay=${c.ref}`, "Choose payment method") : "");
  } else {
    subject = `Your grant checklist is saved (${c.ref})`;
    client = p(`Hi ${first},`) + p(`Your case for <b>${biz}</b> is saved. Reference: <b>${esc(c.ref)}</b>.`)
      + h2("Your grants") + ul(grants.map((g) => `${esc(g.grants.name)}${dl(g)}`))
      + p("We’ll email you 7 days and 1 day before each deadline. Your document checklist, templates and official links are on the site.")
      + btn(SITE, "Open Solicita") + p("Prefer us to handle it? Reply to this email and we’ll take it from here.");
  }
  const r1 = await sendMail(sb, { to: c.contact_email, subject, html: layout(subject.replace(/ \(.*\)$/, ""), client), caseId: c.id, kind: "confirmation", dedupe: `confirm:${c.id}` });

  // Owner alert
  const prof = c.profile ?? {};
  const answers = Object.entries(LABELS).filter(([k]) => prof[k] !== undefined && prof[k] !== "" && prof[k] !== null).map(([k, l]) => `${esc(l)}: <b>${esc(k === "alta" && prof.alta === "date" ? `${prof.altaM}/${prof.altaY}` : prof[k])}</b>`);
  let grantBlocks = "";
  for (const g of grants) {
    grantBlocks += `<div style="border:1px solid #E0E6EC;border-radius:8px;padding:10px 12px;margin:0 0 8px"><b>${esc(g.grants.name)}</b>${dl(g)}<br><span style="color:#5A6876;font-size:13px">Estimate ${g.amount_estimate ? eur(g.amount_estimate) : "n/a"}${g.fee_estimate ? ` · fee ${eur(g.fee_estimate)}` : ""} · <a href="${esc(g.grants.source_url)}">official page</a></span><br>`
      + (c.tier === "dfy" ? btn(await actionLink(sb, c.id, g.grant_id, "submitted"), "Submitted") + btn(await actionLink(sb, c.id, g.grant_id, "awarded"), "Awarded", "#1D7A46") + btn(await actionLink(sb, c.id, g.grant_id, "paid"), "Money arrived", "#5A49B4") + btn(await actionLink(sb, c.id, g.grant_id, "rejected"), "Rejected", "#8A2922") : "")
      + `</div>`;
  }
  const oSubject = `New ${c.tier === "dfy" ? "done-for-you" : "DIY"} request: ${bizName(c)} (${c.ref})`;
  const owner = kv([["Business", biz], ["NIF", esc(c.nif || "not given")], ["Contact", `${esc(c.contact_name || "")} · <a href="mailto:${esc(c.contact_email)}">${esc(c.contact_email)}</a>${c.contact_phone ? " · " + esc(c.contact_phone) : ""}`], ["Service", c.tier === "dfy" ? "We apply for you" : "Do it yourself"], ["Payment method", c.payment_method_type ? esc(c.payment_method_type) : "not set yet"]])
    + h2("Grants") + grantBlocks
    + (c.tier === "dfy" ? h2("Documents (links valid 7 days)") + (files.length ? ul(files.map((f) => `${esc(f.doc)}: <a href="${esc(f.url)}">${esc(f.name)}</a>`)) : p("None uploaded.")) + (missing.length ? h2("Missing") + ul(missing.map((d) => esc(d.name))) : "") + (prepared.length ? h2("Client asked us to prepare") + ul(prepared.map((d) => esc(d.name))) : "") : "")
    + h2("Answers") + ul(answers);
  await sendMail(sb, { to: ownerEmail(), subject: oSubject, html: layout(oSubject, owner), caseId: c.id, kind: "owner_new_case", dedupe: `owner:${c.id}` });
  return r1 === "sent" || r1 === "duplicate";
}

// deno-lint-ignore no-explicit-any
async function bdnsNew(): Promise<string[]> {
  try {
    const since = new Date(Date.now() - 7 * 864e5);
    const d = `${String(since.getDate()).padStart(2, "0")}/${String(since.getMonth() + 1).padStart(2, "0")}/${since.getFullYear()}`;
    const r = await fetch(`https://www.infosubvenciones.es/bdnstrans/api/convocatorias/busqueda?page=0&pageSize=200&fechaDesde=${encodeURIComponent(d)}&vpd=GE`, { headers: { Accept: "application/json" } });
    if (!r.ok) return [`BDNS check unavailable (status ${r.status}). Check infosubvenciones.es manually.`];
    const j = await r.json();
    const items = (j.content ?? j.convocatorias ?? []) as any[];
    const rel = items.filter((x) => /ANDALUC|MÁLAGA|MALAGA|ESTADO/i.test(`${x.nivel1 ?? ""} ${x.nivel2 ?? ""} ${x.nivel3 ?? ""}`) && /empres|autónom|autonom|pyme|hostel|turism|contrata|emple|digital|energ/i.test(x.descripcion ?? ""));
    return rel.slice(0, 25).map((x) => `<a href="https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/${esc(x.numeroConvocatoria ?? x.id)}">${esc(x.descripcion)}</a> <span style="color:#5A6876">(${esc(x.nivel2 ?? x.nivel1 ?? "")}, BDNS ${esc(x.numeroConvocatoria ?? x.id)})</span>`);
  } catch (e) { return [`BDNS check unavailable (${esc((e as Error).message)}). Check infosubvenciones.es manually.`]; }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!mailReady()) return Response.json({ skipped: "gmail_not_configured" });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: Record<string, number> = { confirmations: 0, missing: 0, deadlines: 0, paidChecks: 0, digest: 0 };
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" })); today.setHours(0, 0, 0, 0);

  // 1. Confirmations (after uploads have had time to finish)
  const { data: pending } = await sb.from("cases").select("id").is("confirmation_sent_at", null).lt("created_at", new Date(Date.now() - 3 * 60e3).toISOString()).limit(10);
  for (const row of pending ?? []) {
    const { c, grants } = await loadCase(sb, row.id);
    if (c && await sendConfirmations(sb, c, grants)) { await sb.from("cases").update({ confirmation_sent_at: new Date().toISOString() }).eq("id", c.id); out.confirmations++; }
  }

  // 2. Missing-document reminder, 3 days after a done-for-you request
  const { data: older } = await sb.from("cases").select("id").eq("tier", "dfy").eq("status", "new").not("confirmation_sent_at", "is", null)
    .lt("created_at", new Date(Date.now() - 3 * 864e5).toISOString()).gt("created_at", new Date(Date.now() - 14 * 864e5).toISOString()).limit(20);
  for (const row of older ?? []) {
    const { c, grants } = await loadCase(sb, row.id);
    const { missing } = await docStatus(sb, c, grants);
    if (!missing.length) continue;
    const subject = `Documents still needed for your grant request (${c.ref})`;
    const r = await sendMail(sb, { to: c.contact_email, subject, caseId: c.id, kind: "missing_docs", dedupe: `missing:${c.id}`,
      html: layout("A few documents are still missing", p(`To submit your application${grants.length > 1 ? "s" : ""} for <b>${esc(bizName(c))}</b> we still need:`) + ul(missing.map((d) => `<b>${esc(d.name)}</b>${d.how_to_get ? `<br><span style="color:#5A6876;font-size:13px">${esc(d.how_to_get)}</span>` : ""}`)) + p("Reply to this email with them attached, one document per file.")) });
    if (r === "sent") out.missing++;
  }

  // 3. Deadline reminders for DIY clients (7 days and 1 day before)
  const { data: diy } = await sb.from("case_grants").select("case_id, grant_id, grants(name, closes, window_state, source_url), cases!inner(id, ref, tier, contact_email, contact_name)").eq("cases.tier", "diy");
  for (const g of diy ?? []) {
    const gr: any = g.grants, c: any = g.cases;
    if (!gr?.closes || gr.window_state !== "open") continue;
    const days = Math.round((new Date(gr.closes + "T00:00:00").getTime() - today.getTime()) / 864e5);
    const which = days === 7 ? 7 : days === 1 ? 1 : null;
    if (!which) continue;
    const subject = `${which === 1 ? "Tomorrow" : "In 7 days"}: deadline for ${gr.name}`;
    const r = await sendMail(sb, { to: c.contact_email, subject, caseId: c.id, kind: `deadline_${which}`, dedupe: `deadline${which}:${c.id}:${g.grant_id}`,
      html: layout(subject, p(`The application window for <b>${esc(gr.name)}</b> closes on <b>${fmtDate(gr.closes)}</b>.`) + btn(gr.source_url, "Official page") + btn(SITE, "Your checklist on Solicita", "#5A6876") + p("Want us to submit it for you? Reply to this email today.")) });
    if (r === "sent") out.deadlines++;
  }

  // 4. "Has your grant money arrived?" every 30 days after award (up to 6 times)
  const { data: awarded } = await sb.from("case_grants").select("case_id, grant_id, amount_awarded, awarded_at, grants(name, fee_trigger), cases!inner(id, ref, tier, contact_email, contact_name)").eq("status", "awarded").eq("cases.tier", "dfy");
  for (const g of awarded ?? []) {
    const gr: any = g.grants, c: any = g.cases;
    if (gr?.fee_trigger !== "payment" || !g.awarded_at) continue;
    const n = Math.floor((Date.now() - new Date(g.awarded_at).getTime()) / (30 * 864e5));
    if (n < 1 || n > 6) continue;
    const subject = `Has your ${gr.name} money arrived? (${c.ref})`;
    const r = await sendMail(sb, { to: c.contact_email, subject, caseId: c.id, kind: "paid_check", dedupe: `paidcheck:${c.id}:${g.grant_id}:${n}`,
      html: layout("Has your grant money arrived?", p(`Your <b>${esc(gr.name)}</b> grant${g.amount_awarded ? ` of <b>${eur(g.amount_awarded)}</b>` : ""} was awarded on ${fmtDate(g.awarded_at)}. Once it reaches your bank account, please let us know with one click.`) + btn(await actionLink(sb, c.id, g.grant_id, "client_paid", 365), "Yes, it’s arrived", "#1D7A46") + p("Not yet? No need to do anything; we’ll check again next month.")) });
    if (r === "sent") out.paidChecks++;
  }

  // 5. Weekly check email to the owner (Mondays)
  const madrid = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  if (madrid.getDay() === 1 && madrid.getHours() >= 8) {
    const week = `${madrid.getFullYear()}-${Math.ceil(((madrid.getTime() - new Date(madrid.getFullYear(), 0, 1).getTime()) / 864e5 + 1) / 7)}`;
    const { data: gs } = await sb.from("grants").select("id, name, active, window_state, closes, verified_at, source_url, official_ref, hidden_reason");
    const stale = (gs ?? []).filter((g: any) => g.active && (!g.verified_at || (Date.now() - new Date(g.verified_at).getTime()) / 864e5 > (g.window_state === "open" ? 14 : 60)));
    const closing = (gs ?? []).filter((g: any) => g.active && g.window_state === "open" && g.closes && (new Date(g.closes).getTime() - Date.now()) / 864e5 <= 14 && new Date(g.closes).getTime() >= Date.now() - 864e5);
    const hidden = (gs ?? []).filter((g: any) => !g.active);
    const bdns = await bdnsNew();
    const { data: fees } = await sb.from("case_grants").select("fee_status").in("fee_status", ["failed", "awaiting_method"]);
    const subject = `Weekly check: ${stale.length} grant${stale.length === 1 ? "" : "s"} to re-verify`;
    const html = layout("Your weekly Solicita check",
      h2("Re-check against the official source") + (stale.length ? (await Promise.all(stale.map(async (g: any) => `<div style="border:1px solid #E0E6EC;border-radius:8px;padding:10px 12px;margin:0 0 8px"><b>${esc(g.name)}</b><br><span style="color:#5A6876;font-size:13px">Last checked ${g.verified_at ? fmtDate(g.verified_at) : "never"}${g.official_ref ? ` · ${esc(g.official_ref)}` : ""}</span><br>${btn(g.source_url, "Open official source", "#5A6876")}${btn(await actionLink(sb, "-", g.id, "verify", 14), "Checked: no change", "#1D7A46")}</div>`))).join("") + p("Only press “Checked: no change” after opening the official source. If something changed, update the grant in Supabase (Table editor → grants) before confirming.") : p("All grants were checked recently."))
      + (closing.length ? h2("Closing within 14 days") + ul(closing.map((g: any) => `${esc(g.name)}: ${fmtDate(g.closes)}`)) : "")
      + h2("New calls in the national grants database (BDNS, last 7 days)") + (bdns.length ? ul(bdns) : p("Nothing relevant found."))
      + (hidden.length ? h2("Hidden until verified") + ul(hidden.map((g: any) => `${esc(g.name)}: ${esc(g.hidden_reason ?? "")}`)) : "")
      + ((fees ?? []).length ? h2("Fees needing attention") + p(`${fees!.length} fee(s) failed or are waiting for the client’s payment method.`) : ""));
    const r = await sendMail(sb, { to: ownerEmail(), subject, html, kind: "weekly_digest", dedupe: `digest:${week}` });
    if (r === "sent") out.digest++;
  }
  return Response.json(out);
});
