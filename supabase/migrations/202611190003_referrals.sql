-- Referral clicks supply attribution only. They never count as inquiries or open windows.
create table if not exists public.mori_referrals (
  tenant_id uuid not null,
  page_id text not null,
  external_id text not null,
  occurred_at timestamptz not null,
  source_ad_id text,
  source text not null,
  primary key (tenant_id,page_id,external_id,occurred_at),
  foreign key (tenant_id,page_id) references public.mori_resources(tenant_id,id)
);
alter table public.mori_referrals enable row level security;
revoke all on public.mori_referrals from anon,authenticated;
