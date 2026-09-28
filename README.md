# Solicita

Grant finder and application service for small businesses in Andalucía (pilot: Málaga province).
Enter a NIF/CIF → answer a few adaptive questions → see verified grants with eligibility ticks → get an exact document checklist with pre-filled templates → do it yourself, or have us apply for a 3% success fee (min €150 + IVA), charged only when the grant money arrives.

- **Stack:** static site (`site/`, Vercel) + Supabase (Postgres, Storage, Edge Functions, pg_cron) + Stripe + Gmail SMTP.
- **Full context, decisions and setup:** see [`CLAUDE.md`](CLAUDE.md).
- **Grant sources and verification status:** see [`docs/grants-audit.md`](docs/grants-audit.md).

## Quick start
1. Create a Supabase project (EU) → `supabase link --project-ref <ref>` → `supabase db push`. Create the two Vault secrets described in `supabase/migrations/20260924000005_cron.sql` before that migration runs.
2. `cp .env.example .env`, fill it in, then `supabase secrets set --env-file .env` and `supabase functions deploy`.
3. Put the project URL and anon key in `site/config.js`.
4. Deploy `site/` to Vercel (Root Directory `site`, no build). Set `SITE_URL` to the Vercel URL.
5. Add the Stripe webhook → `https://<ref>.supabase.co/functions/v1/stripe-webhook`.

Operated by Easy Beans Coffee, San Pedro de Alcántara (Málaga).
