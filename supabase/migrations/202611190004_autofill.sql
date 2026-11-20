alter table public.mori_tenants add column if not exists autofill_enabled boolean not null default true;
alter table public.mori_contacts add column if not exists autofill_evidence jsonb not null default '{}';
grant update (autofill_enabled) on public.mori_tenants to authenticated;
-- Evidence is written only by the server after Jev selects and verifies literal customer text.
