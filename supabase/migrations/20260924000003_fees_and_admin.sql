-- Fee becomes due when the grant money is paid out, or at award for grants that never pay the client cash (Kit Digital).
create or replace function public.set_fee_due() returns trigger language plpgsql set search_path = public as $$
declare trig text;
begin
  select fee_trigger into trig from public.grants where id = new.grant_id;
  if new.fee_status = 'not_due'
     and exists (select 1 from public.cases c where c.id = new.case_id and c.tier = 'dfy')
     and ( (new.status = 'paid' and old.status is distinct from 'paid')
        or (trig = 'award' and new.status in ('awarded','paid') and old.status not in ('awarded','paid')) )
  then new.fee_status := 'due';
  end if;
  return new;
end $$;
create trigger case_grants_fee_due before update on public.case_grants
  for each row execute function public.set_fee_due();

-- Owner tools (SQL editor). Day-to-day, use the one-click buttons in the emails instead.
create schema if not exists admin;
revoke all on schema admin from anon, authenticated;

create or replace function admin.mark_awarded(p_ref text, p_grant text, p_amount numeric) returns text
language plpgsql set search_path = public as $$
declare n int;
begin
  update public.case_grants cg set status = 'awarded', amount_awarded = p_amount, awarded_at = now()
  from public.cases c where c.id = cg.case_id and c.ref = upper(p_ref) and cg.grant_id = p_grant;
  get diagnostics n = row_count;
  return case when n = 0 then 'Not found: check the reference and grant id' else 'Marked as awarded' end;
end $$;

create or replace function admin.mark_paid(p_ref text, p_grant text, p_amount numeric default null) returns text
language plpgsql set search_path = public as $$
declare n int;
begin
  update public.case_grants cg set status = 'paid', paid_at = now(), amount_awarded = coalesce(p_amount, cg.amount_awarded)
  from public.cases c where c.id = cg.case_id and c.ref = upper(p_ref) and cg.grant_id = p_grant
    and coalesce(p_amount, cg.amount_awarded) is not null;
  get diagnostics n = row_count;
  return case when n = 0 then 'Not found, or no awarded amount yet: pass the amount' else 'Marked as paid: the fee will be charged within 10 minutes' end;
end $$;

create or replace function admin.charge_now(p_ref text, p_grant text) returns text
language plpgsql set search_path = public as $$
declare n int;
begin
  update public.case_grants cg set fee_status = 'due', fee_error = null
  from public.cases c where c.id = cg.case_id and c.ref = upper(p_ref) and cg.grant_id = p_grant
    and cg.amount_awarded is not null and cg.fee_status in ('not_due','failed','awaiting_method');
  get diagnostics n = row_count;
  return case when n = 0 then 'Nothing to charge: needs an awarded amount and no fee already charged' else 'Fee will be charged within 10 minutes' end;
end $$;
revoke all on all functions in schema admin from anon, authenticated;

create or replace view admin.case_overview as
select c.ref, c.created_at, c.status, c.tier, c.contact_name, c.contact_email, c.contact_phone,
       coalesce(c.company->>'name', c.profile->>'name') as business, c.nif,
       string_agg(g.name, '; ' order by g.sort_order) as grants,
       sum(cg.fee_estimate) as fee_estimate_total,
       (select count(*) from public.case_documents d where d.case_id = c.id) as documents
from public.cases c
left join public.case_grants cg on cg.case_id = c.id
left join public.grants g on g.id = cg.grant_id
group by c.id order by c.created_at desc;

create or replace view admin.case_documents_overview as
select c.ref, c.contact_name, dt.name as document, d.file_name, d.size_bytes, d.storage_path, d.created_at
from public.case_documents d join public.cases c on c.id = d.case_id left join public.document_types dt on dt.id = d.doc_type_id
order by c.created_at desc, dt.sort_order;

create or replace view admin.fees_overview as
select c.ref, coalesce(c.company->>'name', c.profile->>'name') as business, c.contact_email,
       g.name as grant, g.fee_trigger, cg.status as grant_status, cg.amount_awarded,
       cg.fee_status, cg.fee_charged, cg.stripe_invoice_id, cg.fee_error,
       c.payment_method_type, c.payment_setup_at
from public.case_grants cg join public.cases c on c.id = cg.case_id join public.grants g on g.id = cg.grant_id
where c.tier = 'dfy' order by c.created_at desc;

create or replace view admin.grants_verification as
select id, name, active, window_state, closes, verified_at, official_ref, source_url, hidden_reason, verification_note
from public.grants order by active desc, verified_at nulls first;
