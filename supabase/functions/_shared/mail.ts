// Email sending, signed one-click links, email layout and case helpers.
import nodemailer from "npm:nodemailer@6.9.14";
import { SITE_URL } from "./http.ts";
export { cors, json, SITE_URL } from "./http.ts";
export const SITE = SITE_URL;

// deno-lint-ignore no-explicit-any
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
export const eur = (n: number) => "€" + Math.round(Number(n)).toLocaleString("es-ES");
export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Madrid" });
export const ownerEmail = () => Deno.env.get("OWNER_EMAIL") || Deno.env.get("GMAIL_USER") || "";
export const mailReady = () => !!(Deno.env.get("GMAIL_USER") && Deno.env.get("GMAIL_APP_PASSWORD"));

// ---------- Sending (Gmail now; swap host/user for a domain provider later) ----------
// deno-lint-ignore no-explicit-any
let transport: any = null;
// deno-lint-ignore no-explicit-any
export async function sendMail(sb: any, o: { to: string; subject: string; html: string; caseId?: string | null; kind: string; dedupe?: string }) {
  if (!mailReady() || !o.to) return "not_configured";
  if (o.dedupe) {
    const { data } = await sb.from("email_log").select("id").eq("dedupe_key", o.dedupe).maybeSingle();
    if (data) return "duplicate";
  }
  transport ??= nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com", port: Number(Deno.env.get("SMTP_PORT") || 465), secure: true,
    auth: { user: Deno.env.get("GMAIL_USER"), pass: Deno.env.get("GMAIL_APP_PASSWORD") },
  });
  const from = Deno.env.get("MAIL_FROM") || `Solicita <${Deno.env.get("GMAIL_USER")}>`;
  const text = o.html.replace(/<br\s*\/?>/g, "\n").replace(/<\/(p|h1|h2|li|tr|div)>/g, "\n").replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();
  try {
    await transport.sendMail({ from, to: o.to, replyTo: ownerEmail(), subject: o.subject, html: o.html, text });
    await sb.from("email_log").insert({ case_id: o.caseId ?? null, kind: o.kind, dedupe_key: o.dedupe ?? null, to_email: o.to, subject: o.subject, status: "sent" });
    return "sent";
  } catch (e) {
    console.error("mail", o.kind, e);
    await sb.from("email_log").insert({ case_id: o.caseId ?? null, kind: o.kind, to_email: o.to, subject: o.subject, status: "failed", error: String((e as Error).message).slice(0, 500) });
    return "failed";
  }
}

// ---------- Signed one-click links ----------
const b64url = (buf: Uint8Array) => btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
let secretCache: string | null = null;
// deno-lint-ignore no-explicit-any
async function sign(sb: any, data: string) {
  if (!secretCache) { const { data: row } = await sb.from("app_settings").select("value").eq("key", "action_secret").single(); secretCache = row.value; }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretCache!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}
// deno-lint-ignore no-explicit-any
export async function makeToken(sb: any, p: { c: string; g: string; a: string }, days: number) {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ ...p, exp: Math.floor(Date.now() / 1000) + days * 86400 })));
  return `${body}.${await sign(sb, body)}`;
}
// deno-lint-ignore no-explicit-any
export async function readToken(sb: any, t: string) {
  try {
    const [b, s] = String(t || "").split(".");
    if (!b || !s || !/^[A-Za-z0-9_-]+$/.test(b) || (await sign(sb, b)) !== s) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(b)));
    return p.exp && p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
// deno-lint-ignore no-explicit-any
export const actionLink = async (sb: any, c: string, g: string, a: string, days = 120) => `${SITE}/action.html?t=${encodeURIComponent(await makeToken(sb, { c, g, a }, days))}`;

// ---------- Email building blocks ----------
export function layout(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#F6F8FB;font-family:Arial,Helvetica,sans-serif;color:#17222E">
<div style="max-width:600px;margin:0 auto;padding:24px 16px"><div style="font-size:20px;font-weight:800;margin-bottom:16px">Solicita<span style="color:#2457C5">.</span></div>
<div style="background:#ffffff;border:1px solid #E0E6EC;border-radius:12px;padding:24px"><h1 style="font-size:20px;line-height:1.3;margin:0 0 14px">${esc(title)}</h1>${body}</div>
<p style="font-size:12px;color:#5A6876;margin-top:16px;line-height:1.5">Solicita is operated by Easy Beans Coffee, C. Pizarro 8, 29670 San Pedro de Alcántara (Málaga). Reply to this email with any questions.</p></div></body></html>`;
}
export const p = (s: string) => `<p style="margin:0 0 12px;line-height:1.55">${s}</p>`;
export const h2 = (s: string) => `<h2 style="font-size:15px;margin:20px 0 8px">${esc(s)}</h2>`;
export const ul = (items: string[]) => items.length ? `<ul style="margin:0 0 12px;padding-left:20px;line-height:1.55">${items.map((i) => `<li style="margin:3px 0">${i}</li>`).join("")}</ul>` : "";
export const btn = (href: string, label: string, color = "#2457C5") => `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;margin:4px 6px 4px 0;font-size:14px">${esc(label)}</a>`;
export const kv = (rows: [string, string][]) => `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 12px">${rows.map(([k, v]) => `<tr><td style="padding:5px 8px;border:1px solid #E0E6EC;color:#5A6876;width:40%">${esc(k)}</td><td style="padding:5px 8px;border:1px solid #E0E6EC">${v}</td></tr>`).join("")}</table>`;

// ---------- Case data ----------
// deno-lint-ignore no-explicit-any
export async function loadCase(sb: any, caseId: string) {
  const { data: c } = await sb.from("cases").select("*").eq("id", caseId).maybeSingle();
  const { data: grants } = await sb.from("case_grants").select("*, grants(*)").eq("case_id", caseId);
  return { c, grants: grants ?? [] };
}
export const bizName = (c: any) => c?.company?.name || c?.profile?.name || "your business";

// deno-lint-ignore no-explicit-any
export async function docStatus(sb: any, c: any, grants: any[]) {
  const ids = grants.map((x) => x.grant_id);
  const { data: gd } = await sb.from("grant_documents").select("*, document_types(*)").in("grant_id", ids.length ? ids : ["-"]);
  const company = (c.profile?.entity ?? "") !== "autonomo";
  const prep = new Set<string>(c.profile?.prepareForMe ?? []);
  const { data: rows } = await sb.from("case_documents").select("*, document_types(name, sort_order)").eq("case_id", c.id);
  const files: { name: string; doc: string; url: string; type: string | null }[] = [];
  const uploaded = new Set<string>();
  for (const r of rows ?? []) {
    const { data: s } = await sb.storage.from("case-documents").createSignedUrl(r.storage_path, 7 * 86400);
    if (s?.signedUrl) { files.push({ name: r.file_name, doc: r.document_types?.name ?? "Other", url: s.signedUrl, type: r.doc_type_id }); if (r.doc_type_id) uploaded.add(r.doc_type_id); }
  }
  // deno-lint-ignore no-explicit-any
  const needed = new Map<string, any>();
  for (const r of gd ?? []) {
    const d = r.document_types;
    if (!d || !r.required || d.kind === "credential" || d.kind === "online" || d.stage !== "apply") continue;
    if (r.tier === "dfy" && c.tier !== "dfy") continue;
    if (r.applies_to === "company" && !company) continue;
    if (r.applies_to === "autonomo" && company) continue;
    needed.set(d.id, d);
  }
  const all = [...needed.values()].sort((a, b) => a.sort_order - b.sort_order);
  return { files, missing: all.filter((d) => !uploaded.has(d.id) && !prep.has(d.id)), prepared: all.filter((d) => prep.has(d.id)) };
}
