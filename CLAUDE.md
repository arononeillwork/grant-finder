# Solicita: context for Claude Code

Read this first. It captures everything decided and built so far (Sept 2026), so you don't need the original chat.

## 1. What this is

**Solicita** is a grant finder and application service for small businesses in Spain, piloting in **Andalucía / Málaga province**.

A visitor enters their **NIF, NIE or CIF**. The site:
1. validates the number and, for companies, auto-fills details from the Registro Mercantil (APIEmpresas);
2. asks only the questions that still decide eligibility (adaptive questionnaire);
3. matches them against a hand-verified grants database and shows, for each grant: eligibility ticks, amount, deadline, what it pays for, how it's paid, obligations, documents and steps;
4. lets them pick grants and choose a tier:
   - **Do it yourself (DIY):** a de-duplicated document checklist, pre-filled templates, steps and official links. Free during beta, then €29.
   - **We apply for you (done-for-you, "DFY"):** they upload each document into its own slot (matched by document type), authorise a card or SEPA debit via Stripe, and the operator submits as their legal representative.

**Operator:** Easy Beans Coffee SL (a café in San Pedro de Alcántara, Marbella), which also funds and invoices the service. Contact: easybeanscafe@gmail.com. The owner is non-technical and prefers concise, practical answers.

**Business model:** a DFY success fee of **3% of each grant awarded, minimum €150 per grant, plus 21% IVA**, charged automatically **when the grant money reaches the client**. For grants that never pay the client cash (e.g. Kit Digital, a voucher), it's charged **at award** (`grants.fee_trigger = 'award'`). For the equipment grant, application-management costs are an eligible expense (up to 4%), so the fee can be covered by the grant itself.

## 2. Owner decisions: do not change without asking

- **Official sources only.** Every grant shown must trace to an official source: BOE, BOJA, BOP, BDNS, or the public body's own e-office or site. No blogs, gestorías or installers. Anything unverifiable is hidden (`active=false`, with `hidden_reason`) until verified. Show "Checked on {date}" plus the official reference on each card.
- **No back-office portal.** Everything runs through **emails with one-click signed buttons** (see §7). Don't build an admin UI unless asked.
- **The site does not submit applications automatically.** Spanish portals have no submission APIs and need a certificate signature (AutoFirma/Cl@ve). The planned approach (not built yet): the site prepares everything, **Claude in Chrome fills the portal form while the owner watches, and the owner signs and submits**. Never auto-submit.
- **Payments:** the client chooses card or SEPA Direct Debit. All money goes into the **Easy Beans Coffee Stripe account**. No Stripe Connect.
- **Email:** Gmail (app password) now; move to a domain + provider later, which is only a config change.
- **UI:** light theme only. Quick filters on the results page (All default; Staff & training; Equipment & energy; Digital & innovation; Starting up; Premises & tourism). "How it works" shows requirement ticks against the user's answers.
- **Language:** the UI is English, but official terms stay in Spanish (autónomo, tarifa plana, padrón, IAE, CNAE…). Templates and the documents for the administration are in Spanish.
- **Honesty over optimism.** Say when something is unverified. Earlier AI answers overstated grants, and the owner cares about correctness.

## 3. Architecture

```
Browser (site/: static HTML/JS, no build step, hosted on Vercel)
   │  reads grants/document_types/grant_documents directly (RLS: public read of active rows)
   │  calls Edge Functions with the anon key
   ▼
Supabase (EU region)
   ├─ Postgres: grants catalogue, cases, documents, email log, fees (RLS on everything)
   ├─ Storage: private bucket `case-documents` (signed upload URLs only)
   ├─ Edge Functions (Deno):
   │    company-lookup   NIF check + APIEmpresas lookup (30-day cache, rate limited)
   │    create-case      saves case + returns one signed upload URL per document
   │    payment-setup    Stripe Checkout (mode=setup): client saves card/SEPA; nothing charged
   │    stripe-webhook   (no JWT; Stripe signature verified) setup completed / invoice paid / failed
   │    process-fees     cron */10: 3% (min €150) + IVA invoice, charged to the saved method
   │    email-jobs       cron */10: confirmations, reminders, "money arrived?", weekly owner digest
   │    case-action      one-click signed links from emails (submitted/awarded/paid/rejected/verify)
   └─ pg_cron: process-fees, email-jobs (every 10 min), close-expired-grants (daily)
Stripe (Easy Beans account) · Gmail SMTP · APIEmpresas · BDNS (weekly digest, best effort)
```

## 4. Repo map

```
site/
  index.html      the whole app (vanilla JS). Eligibility RULES, questionnaire, results, apply flow, RTF templates
  action.html     one-click confirmation page opened from email buttons (calls case-action)
  privacy.html    privacy notice (draft, needs legal review)
  config.js       PUBLIC config: Supabase URL + anon key, operator details, fee settings
  vercel.json     security headers
supabase/
  config.toml                 CLI config (stripe-webhook has verify_jwt=false)
  migrations/0001..0005       schema, storage, fees/admin, seed data, cron. Final clean state
  seed/*.json                 source of truth for grant data → scripts/build_seed.py regenerates the seed SQL
  functions/_shared/          http.ts, nif.ts, stripe.ts, mail.ts (email, signed tokens, case helpers)
  functions/<name>/index.ts   the seven functions above
scripts/build_seed.py
.env.example                  every Edge Function secret, with notes
docs/                         grant audit, email and payment flows
```

## 5. Data model (key points)

- `grants`: one row per programme. `rule_key` links to a JS function in `site/index.html` (`RULES`), which returns conditions with `pass|fail|unknown`. Other fields:
  - window: `window_state` (`open|closed|permanent|upcoming`), `closes`;
  - content: `summary`, `covers[]`, `paid`, `obligations[]`, `steps[]`;
  - verification: `source_url` (official), `official_ref`, `verified_at`, `hidden_reason`;
  - money: `fee_trigger`, `max_amount` (for fee estimates).
- `document_types`: 32 types.
  - `kind`: `credential` (e.g. digital certificate; not uploaded), `online` (e.g. Acelera Pyme test), `upload`, or `form` (fill and sign).
  - `stage`: `apply` or `after` (post-award justification).
  - Other fields: `template_key` (RTF template in index.html), `official_url`, `we_can_prepare`.
- `grant_documents`: 106 links.
  - `required`, `applies_to` (`all|company|autonomo`), `tier` (`all|dfy`; e.g. the representation form is DFY only), `note`, a per-grant `official_url` override.
- `cases` / `case_grants` / `case_documents`: private.
  - `case_grants.status`: `selected → submitted → awarded → paid` (or `rejected`).
  - `fee_status`: `not_due → due → invoicing → invoiced → paid` (plus `awaiting_method`, `failed`, `waived`).
  - The trigger `set_fee_due` sets `due` on paid (or on award when `fee_trigger='award'`), DFY only.
- `email_log.dedupe_key` stops duplicate emails. `app_settings.action_secret` is the HMAC key for email links.
- `admin` schema (SQL editor only): `mark_awarded`, `mark_paid`, `charge_now`, plus the views `case_overview`, `case_documents_overview`, `fees_overview`, `grants_verification`.

## 6. Eligibility engine

- Grant data lives in the DB; eligibility logic lives in `RULES` in `site/index.html`, keyed by `rule_key`.
- Status per grant: any `fail` → **Not eligible**; closed, upcoming, past its deadline, or the timing lands later → **Next call**; any `unknown` → **Confirm first**; all `pass` → **Eligible**; `active` → **Yours** (e.g. FUNDAE, tarifa plana).
- **Adaptive questions:** a question shows only if at least one affected grant isn't already ruled out when that answer is unknown (`questionRelevant`).
- `debtCond` (debts with Hacienda/SS) applies to almost every grant.
- **To add a grant:**
  1. Add a row to `seed/grants.json` (official source required).
  2. Add document links in `seed/grant_documents.json`.
  3. Add a `RULES[rule_key]` function (or reuse one).
  4. If it needs a new answer, add it to `blank()` and `QUESTIONS` with its `rules` list.
  5. Ship the data as a **new** migration (don't edit applied ones).

## 7. Emails (no portal)

All sent by `email-jobs` / `case-action` via Gmail SMTP (port 465, `nodemailer`). **Nothing sends until `GMAIL_USER` and `GMAIL_APP_PASSWORD` are set.**

- **Client emails:**
  - confirmation (~10 min after submitting): documents received and missing, next steps, payment link;
  - missing-documents reminder at 3 days;
  - DIY deadline reminders at 7 days and 1 day;
  - status emails (submitted with registration no. / awarded / rejected / paid);
  - "Has your grant money arrived?" with a one-click **Yes, it's arrived** button (in the award email, then monthly up to 6×). That click triggers the fee;
  - Stripe sends the invoice (customer emails are enabled in Stripe).
- **Owner emails:**
  - new-case alert with all answers, 7-day signed document links and buttons **Submitted / Awarded / Money arrived / Rejected**;
  - "client confirmed payment";
  - **weekly check (Mondays):** stale grants with "Open official source" and "Checked: no change" buttons, deadlines within 14 days, new BDNS calls, hidden grants, failed fees.
- **Links** are HMAC-signed (`makeToken`/`readToken` in `_shared/mail.ts`), expire, and statuses can't go backwards. Tampered and forged tokens were tested and rejected.
- **Official notices** from administrations go to the representative's **DEHú** inbox, not email. The owner must enable DEHú email alerts once Easy Beans has its FNMT representative certificate. A notice unopened for 10 days counts as delivered.

## 8. Payments (Stripe, Easy Beans account)

1. After a DFY request, the site calls `payment-setup`, which runs Stripe Checkout in `mode=setup` with `card` + `sepa_debit`. A Stripe customer is created with the client's NIF as `es_cif` tax ID. Nothing is charged.
2. `stripe-webhook` on `checkout.session.completed` saves the payment method as the customer default.
3. When a grant becomes due (see §5), `process-fees` creates an invoice with an IVA 21% tax rate (created if missing) and a line "3% of €X awarded (minimum €150)", then finalises and pays it. Idempotency keys and a row claim prevent double charges.
4. `invoice.paid` → `fee_status='paid'`; `invoice.payment_failed` → `failed`.
5. Money settles into Easy Beans' bank on Stripe's payout schedule. The IVA must be declared by Easy Beans (Modelo 303).

## 9. Setup from scratch

1. **Supabase:** create project **solicita** (EU region, e.g. eu-west-3 Paris) in the owner's org ("arononeill's org").
   - `supabase link --project-ref <ref>`, then `supabase db push` to apply migrations 0001–0004.
   - **Before 0005 (cron),** run in the SQL editor:
     `select vault.create_secret('https://<ref>.supabase.co','project_url'); select vault.create_secret('<anon key>','anon_key');`
     Then push 0005.
2. **Secrets:** copy `.env.example` to `.env`, fill it in, then `supabase secrets set --env-file .env`.
3. **Functions:** `supabase functions deploy` (all). `stripe-webhook` must be deployed with JWT verification off (it's set in config.toml; or use `--no-verify-jwt`).
4. **Site:** fill `site/config.js` with the project URL and the **legacy anon JWT key** (the functions use `verify_jwt`; the new `sb_publishable_` keys are not JWTs).
   - Vercel: new project from the GitHub repo, **Root Directory = `site`**, no framework, no build command.
   - Set `SITE_URL` (the Supabase secret) to the Vercel URL.
   - **Vercel Hobby is non-commercial:** upgrade to Pro before charging clients.
5. **Stripe (test mode first):**
   - add a webhook to `https://<ref>.supabase.co/functions/v1/stripe-webhook` with events `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`;
   - enable SEPA Direct Debit;
   - customer emails are already on.
6. **Gmail:** create an app password at myaccount.google.com/apppasswords (2-Step Verification is already on) and put it in the secrets.
7. **APIEmpresas:** sign up (100 free lookups) and set `APIEMPRESAS_KEY`. Without it the site asks users to type their details.

## 10. Test checklist

- [ ] Site loads grants (12 active of 16); "Try it with Easy Beans Coffee" demo works; filters work; templates download and open in Word/Pages.
- [ ] A company CIF auto-fills (needs `APIEMPRESAS_KEY`); a DNI shows "not in a public register".
- [ ] DIY case → confirmation email within 10 min; owner alert arrives.
- [ ] DFY case with 2 uploads → files land in `case-documents/<case>/<doc_type>/`; owner email links download them.
- [ ] Payment setup with test card `4242 4242 4242 4242` or test IBAN `ES0700120345030000067890` → `cases.stripe_payment_method_id` set.
- [ ] Owner email "Awarded" (amount) → client email with "Yes, it's arrived" → click → fee invoice in Stripe within 10 min → `invoice.paid` updates `fee_status`.
- [ ] Kit Digital-style grant (`fee_trigger='award'`) charges at award.
- [ ] Forged or expired action links are rejected.
- [ ] A grant with `closes` in the past shows as "Next call", and the daily job sets it to closed.

## 11. Grant data status (audited 24 Sep 2026)

See `docs/grants-audit.md`. Summary:
- **Verified and shown:**
  - Equipment renewal RD 638/2026 (**closes 30 Sep 2026, 15:00**, first-come);
  - Cuota Cero and Línea 2 (**close 30 Sep 2026**);
  - Talento Joven / Talento 45+ (to 31 Dec 2026, only 10 each);
  - Pyme Digital / Pyme Sostenible (closed; next ~Mar 2027);
  - Innovactiva (closed);
  - Diputación €6,000 (closed; BOP Málaga nº 79);
  - PYMETUR (draft rules only, BOJA nº 109, not open);
  - FUNDAE and tarifa plana (permanent).
- **Hidden until verified:**
  - Kit Digital: no open call; Orden TDF/39/2026 only extends the programme;
  - INEA energy: figures came from installers;
  - Pyme Innova: rules taken from other Cámaras;
  - Pago único: not checked against SEPE.
- **Known rule gaps in `RULES`:**
  - `diputacion_6000` doesn't yet check the 2026 condition "RETA registration between 1 Jan 2022 and 1 Jan 2026" (it's shown in obligations);
  - `inea` still mentions €11,000 (the grant is hidden anyway).

## 12. Open work (priority order)

1. ~~Deploy to the new Supabase project + Vercel from this repo~~ Done 28 Sep 2026 (see §15). Still needed: the Edge Function secrets.
2. ~~Verify email delivery from Edge Functions~~ Works. Gmail SMTP (port 465, `nodemailer`) from Supabase Edge sent the first email on 28 Sep 2026 at 23:00 Madrid time (the weekly digest). `GMAIL_APP_PASSWORD` must be a Google app password; the account password fails with `534`.
3. **Verify APIEmpresas response field names** with a real key and adjust `normalise()` in `company-lookup`. The API takes the key in an `X-API-KEY` header (confirmed 28 Sep from its 401 response and fixed in code). The saved key was rejected as `API_KEY_INVALID`, so field names are still unverified.
4. **Verify the BDNS API query** in `email-jobs` (`bdnsNew`); the parameter names are unconfirmed and it currently degrades gracefully.
5. Add the Easy Beans CIF to `site/config.js` (`operatorNif`); it's used in the representation template and should appear on invoices.
6. Update `RULES.diputacion_6000` for the 2022–2026 RETA-date condition; re-verify hidden grants against official sources.
7. Application packs + **Claude in Chrome** assisted filling (owner signs); attach packs to the owner's new-case email.
8. **Legal:** service agreement (fee, SEPA mandate, revocation clause), privacy review, Easy Beans IAE activity for consultancy, invoices compliant with Spanish rules (check VeriFactu timing with the gestor).
9. Custom domain + email provider; Vercel Pro.
10. Consider moving eligibility rules into data (JSON) so non-developers can edit them.

## 13. Legacy deployments (retire after migrating)

- **Vercel:** project `solicita` on the arononeillwork Hobby account; URL `https://solicita-arononeillworks-projects.vercel.app`. Its manual uploads from 23–24 Sep pointed at the old Supabase project. It now deploys from GitHub (§15).
- **Supabase (old):** project ref `rapzydlruzcrdnussvrf` in an org named **"Shopa"** whose login the owner can't identify. Its cron jobs are unscheduled and it holds no client data (0 cases). Delete it if the login is ever found.
- **Stripe:** "Easy Beans Coffee" account, live mode. Build and test in **test mode** first.

## 14. Useful SQL

```sql
select * from admin.case_overview;            -- all cases
select * from admin.case_documents_overview;  -- every uploaded file by document type
select * from admin.fees_overview;            -- fee status per grant
select * from admin.grants_verification;      -- what's shown/hidden and when it was checked
select admin.mark_paid('SOL-XXXX','equipos-hosteleria', 8000);  -- manual fallback to the email buttons
select admin.charge_now('SOL-XXXX','grant-id');                -- charge on the awarded amount if the client won't confirm
```

## 15. Deployment status (28 Sep 2026)

- **Live:** https://solicita-arononeillworks-projects.vercel.app (also https://solicita-two.vercel.app), deployed by Vercel from `main` of `arononeillwork/grant-finder` (Vercel project `solicita`, Root Directory `site`). Every push to `main` goes live; other branches get preview deployments behind Vercel login. GitHub's default branch is `main`.
- **Supabase:** project **"Grant Finder"**, ref `hjmfbknjeewgckllgbnp`, arononeill's org (Pro plan), eu-west-1. `site/config.js` points at it with the legacy anon JWT key.
  - Migrations 0001–0005 are applied (loaded from GitHub and checked against each file's md5). `supabase_migrations.schema_migrations` uses the repo file versions, so after `supabase link` the CLI sees them as applied.
  - All 7 functions are deployed with the `verify_jwt` settings from `config.toml`. They match the repo byte for byte, except line 8 of `company-lookup/index.ts`: its accent regex was uploaded with literal characters instead of `\u` escapes (same behaviour). The next `supabase functions deploy` restores the exact file.
  - Vault secrets `project_url` and `anon_key` are set. Cron jobs `process-fees` and `email-jobs` (every 10 min) and `close-expired-grants` (daily) are scheduled.
  - **Edge Function secrets** were set by the owner on 28 Sep: `SITE_URL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` and `OWNER_EMAIL` (owner alerts go to arononeillwork@gmail.com), plus `APIEMPRESAS_KEY`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
    - Email works.
    - `APIEMPRESAS_KEY` was rejected by APIEmpresas as invalid and needs re-copying.
    - `STRIPE_SECRET_KEY` is a **test** key, but the first webhook endpoint was created in **live** mode (`we_1UKlRiC0kB9V6qqsrB9bFljT`). While testing, `STRIPE_WEBHOOK_SECRET` must come from an identical endpoint in the Stripe sandbox. Keep the live one for go-live, with `sk_live_` and its own `whsec_`.
- The live site no longer uses the old Supabase project (§13).
