-- Solicita: core schema (final state as of 24 Sep 2026).
create extension if not exists pgcrypto with schema extensions;

-- ---------- Grants catalogue (public, read-only to visitors) ----------
create table public.grants (
  id text primary key,
  rule_key text not null,                 -- maps to RULES[rule_key] in site/index.html
  name text not null,
  body text not null,                     -- the public body running the grant
  level text not null check (level in ('national','regional','provincial','local','chamber')),
  category text not null,                 -- hiring|training|energy|digital|innovation|autonomo|startup|modernisation
  amount_text text not null,
  max_amount numeric not null default 0,  -- used for fee estimates
  window_state text not null check (window_state in ('open','closed','permanent','upcoming')),
  opens date,
  closes date,
  next_call text,
  paid text,                              -- "How you get paid"
  summary text,
  covers text[] not null default '{}',    -- "What it pays for"
  obligations text[] not null default '{}',
  docs text[] not null default '{}',      -- legacy plain list; the real list is grant_documents
  steps text[] not null default '{}',
  source_url text not null,               -- MUST be an official source (BOE/BOJA/BOP/BDNS/e-office)
  official_ref text,                      -- e.g. "BOP Málaga nº 79, 27 Apr 2026"
  verified_at date,                       -- last checked against the official source
  verification_note text,
  hidden_reason text,                     -- why active=false
  fee_trigger text not null default 'payment' check (fee_trigger in ('payment','award')),
  selectable boolean not null default true,
  active boolean not null default true,   -- only active grants are shown on the site
  sort_order int not null default 100,
  updated_at timestamptz not null default now()
);
alter table public.grants enable row level security;
create policy "Anyone can read active grants" on public.grants for select to anon, authenticated using (active);

-- ---------- Document catalogue ----------
create table public.document_types (
  id text primary key,
  name text not null,
  how_to_get text,
  kind text not null check (kind in ('credential','online','upload','form')),
  stage text not null default 'apply' check (stage in ('apply','after')),
  template_key text,                      -- key into TEMPLATES in site/index.html (pre-filled RTF)
  official_url text,
  we_can_prepare boolean not null default false,
  sort_order int not null default 100
);
alter table public.document_types enable row level security;
create policy "Anyone can read document types" on public.document_types for select to anon, authenticated using (true);

create table public.grant_documents (
  grant_id text not null references public.grants(id) on delete cascade,
  doc_id text not null references public.document_types(id),
  required boolean not null default true,
  applies_to text not null default 'all' check (applies_to in ('all','company','autonomo')),
  tier text not null default 'all' check (tier in ('all','dfy')),
  note text,
  official_url text,                      -- per-grant override (e.g. Cámara forms page)
  primary key (grant_id, doc_id)
);
alter table public.grant_documents enable row level security;
create policy "Anyone can read grant documents" on public.grant_documents for select to anon, authenticated using (true);

-- ---------- Client cases (private: service role only, via edge functions) ----------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,               -- e.g. SOL-AB12
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in
    ('new','agreement_sent','authorised','documents_complete','submitted','awarded','paid','rejected','withdrawn')),
  tier text not null check (tier in ('diy','dfy')),
  nif text,
  company jsonb not null default '{}',
  profile jsonb not null default '{}',    -- all questionnaire answers (+ prepareForMe list)
  contact_name text,
  contact_email text,
  contact_phone text,
  consent_data boolean not null default false,
  consent_fee boolean not null default false,
  consent_at timestamptz,
  internal_notes text,
  stripe_customer_id text,
  stripe_payment_method_id text,
  payment_method_type text,
  payment_setup_at timestamptz,
  confirmation_sent_at timestamptz
);
alter table public.cases enable row level security;

create table public.case_grants (
  case_id uuid not null references public.cases(id) on delete cascade,
  grant_id text not null references public.grants(id),
  status text not null default 'selected' check (status in ('selected','preparing','submitted','awarded','rejected','paid','withdrawn')),
  amount_estimate numeric,
  fee_estimate numeric,
  amount_awarded numeric,
  fee_charged numeric,
  registration_no text,
  submitted_at timestamptz,
  awarded_at timestamptz,
  paid_at timestamptz,
  fee_status text not null default 'not_due' check (fee_status in ('not_due','due','invoicing','awaiting_method','invoiced','paid','failed','waived')),
  stripe_invoice_id text,
  fee_paid_at timestamptz,
  fee_error text,
  primary key (case_id, grant_id)
);
alter table public.case_grants enable row level security;

create table public.case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  doc_type_id text references public.document_types(id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
alter table public.case_documents enable row level security;

-- ---------- Support tables (service role only) ----------
create table public.company_cache (
  nif text primary key,
  provider text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.company_cache enable row level security;

create table public.request_log (
  id bigint generated always as identity primary key,
  kind text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index request_log_lookup on public.request_log (kind, ip_hash, created_at desc);
alter table public.request_log enable row level security;

create table public.email_log (
  id bigint generated always as identity primary key,
  case_id uuid references public.cases(id) on delete cascade,
  kind text not null,
  dedupe_key text unique,                 -- prevents the same email being sent twice
  to_email text,
  subject text,
  status text not null check (status in ('sent','failed')),
  error text,
  created_at timestamptz not null default now()
);
alter table public.email_log enable row level security;

-- Server-only settings (no policies: only the service role can read)
create table public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('action_secret', encode(extensions.gen_random_bytes(32), 'hex'));
