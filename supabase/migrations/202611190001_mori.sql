-- Mori CRM. All application tables are namespaced and tenant isolated.
create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

create table if not exists public.mori_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Manila',
  currency text not null default 'PHP',
  expense_percent numeric not null default 0 check (expense_percent between 0 and 100),
  expense_threshold_minor bigint not null default 0 check (expense_threshold_minor >= 0),
  automation_enabled boolean not null default false,
  bot_enabled boolean not null default false,
  aov_spend_multiplier numeric not null default 1.5 check (aov_spend_multiplier >= 0.5),
  min_ad_days int not null default 3 check (min_ad_days = 3),
  intake_fields jsonb not null default '[]',
  followup_templates jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists public.mori_memberships (
  tenant_id uuid not null references public.mori_tenants(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('head', 'admin', 'member')),
  name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create table if not exists public.mori_resources (
  tenant_id uuid not null references public.mori_tenants(id),
  id text not null,
  name text not null,
  type text not null check (type in ('page','ad_account')),
  status text not null default 'connected',
  currency text,
  timezone text,
  token_encrypted text not null,
  connected_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);
create table if not exists public.mori_assignments (
  tenant_id uuid not null,
  user_id uuid not null,
  resource_id text not null,
  primary key (tenant_id, user_id, resource_id),
  foreign key (tenant_id,user_id) references public.mori_memberships(tenant_id,user_id) on delete cascade,
  foreign key (tenant_id,resource_id) references public.mori_resources(tenant_id,id) on delete cascade
);
create table if not exists public.mori_ads (
  tenant_id uuid not null references public.mori_tenants(id),
  id text not null,
  account_id text not null,
  name text not null,
  creative_name text not null default '',
  thumbnail_url text,
  status text not null default 'PAUSED',
  daily_budget_minor bigint,
  automation_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,id),
  foreign key (tenant_id,account_id) references public.mori_resources(tenant_id,id)
);
create table if not exists public.mori_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.mori_tenants(id),
  page_id text,
  external_id text,
  name text not null default 'Messenger contact',
  email text,
  phone text,
  stage text not null default 'not_qualified' check (stage in ('qualified','not_qualified','converted')),
  bot_state text not null default 'intake' check (bot_state in ('intake','faq','human','stopped')),
  first_inquiry_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  converted_at timestamptz,
  ad_window_opened_at timestamptz,
  source_ad_id text,
  source text not null default 'manual',
  timezone text,
  form_answers jsonb not null default '{}',
  objections jsonb not null default '[]',
  notes text not null default '',
  opted_out boolean not null default false,
  assigned_to uuid,
  unique (tenant_id,id),
  unique (tenant_id,page_id,external_id),
  foreign key (tenant_id,page_id) references public.mori_resources(tenant_id,id),
  foreign key (tenant_id,assigned_to) references public.mori_memberships(tenant_id,user_id)
);
create index if not exists mori_contact_cohort on public.mori_contacts (tenant_id,first_inquiry_at);
create table if not exists public.mori_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contact_id uuid not null,
  direction text not null check (direction in ('inbound','outbound')),
  sender text not null check (sender in ('contact','bot','agent')),
  text text not null default '',
  sent_at timestamptz not null default now(),
  media_url text,
  media_type text,
  status text not null default 'received',
  external_id text,
  unique (tenant_id, external_id),
  foreign key (tenant_id,contact_id) references public.mori_contacts(tenant_id,id)
);
create index if not exists mori_messages_contact on public.mori_messages (tenant_id,contact_id,sent_at);
create table if not exists public.mori_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contact_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  currency text not null default 'PHP',
  status text not null default 'pending' check (status in ('pending','paid','cancelled','refunded')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  foreign key (tenant_id,contact_id) references public.mori_contacts(tenant_id,id),
  check ((status = 'paid' and paid_at is not null) or status <> 'paid')
);
create table if not exists public.mori_spend (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  ad_id text not null,
  day date not null,
  spend_minor bigint not null default 0 check (spend_minor >= 0),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id,ad_id,day),
  foreign key (tenant_id,ad_id) references public.mori_ads(tenant_id,id)
);
create table if not exists public.mori_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.mori_tenants(id),
  name text not null,
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  chunk_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  unique (tenant_id,id)
);
create table if not exists public.mori_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null,
  chunk_index int not null,
  content text not null,
  embedding extensions.vector(1536),
  search tsvector generated always as (to_tsvector('simple',content)) stored,
  unique (tenant_id,document_id,chunk_index),
  foreign key (tenant_id,document_id) references public.mori_documents(tenant_id,id) on delete cascade
);
create index if not exists mori_chunk_search on public.mori_chunks using gin(search);
create table if not exists public.mori_faqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.mori_tenants(id),
  question text not null,
  answer text not null,
  active boolean not null default true,
  media_url text,
  media_type text
);
create table if not exists public.mori_touchpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contact_id uuid not null,
  day_number int not null check (day_number between 1 and 7),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','sending','sent','needs_human','blocked','cancelled','failed')),
  reason text,
  template text not null,
  unique (tenant_id,contact_id,day_number),
  foreign key (tenant_id,contact_id) references public.mori_contacts(tenant_id,id)
);
create index if not exists mori_touchpoint_due on public.mori_touchpoints(status,scheduled_at);
create table if not exists public.mori_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.mori_tenants(id),
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.mori_webhook_events (
  id text primary key,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.mori_role(t uuid) returns text language sql stable security definer set search_path = public
as $$ select role from public.mori_memberships where tenant_id=t and user_id=auth.uid() $$;
create or replace function public.mori_access(t uuid,r text) returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.mori_role(t) in ('head','admin') or (public.mori_role(t)='member' and exists(select 1 from public.mori_assignments where tenant_id=t and user_id=auth.uid() and resource_id=r)),false) $$;
create or replace function public.mori_contact_access(t uuid,c uuid) returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(exists(select 1 from public.mori_contacts where tenant_id=t and id=c and public.mori_access(t,page_id)),false) $$;
revoke all on function public.mori_role(uuid), public.mori_access(uuid,text), public.mori_contact_access(uuid,uuid) from public;
grant execute on function public.mori_role(uuid), public.mori_access(uuid,text), public.mori_contact_access(uuid,uuid) to authenticated;

alter table public.mori_tenants enable row level security;
create policy tenant_read on public.mori_tenants for select to authenticated using (public.mori_role(id) is not null);
create policy tenant_update on public.mori_tenants for update to authenticated using (public.mori_role(id) in ('head','admin')) with check (public.mori_role(id) in ('head','admin'));
alter table public.mori_memberships enable row level security;
create policy membership_read on public.mori_memberships for select to authenticated using (public.mori_role(tenant_id) is not null);
-- Memberships and resource tokens can only be changed by explicit server operations.
alter table public.mori_resources enable row level security;
create policy resources_read on public.mori_resources for select to authenticated using (public.mori_access(tenant_id,id));
alter table public.mori_assignments enable row level security;
create policy assignments_read on public.mori_assignments for select to authenticated using (public.mori_role(tenant_id) in ('head','admin') or user_id=auth.uid());
alter table public.mori_contacts enable row level security;
create policy contact_read on public.mori_contacts for select to authenticated using (public.mori_access(tenant_id,page_id));
create policy contact_write on public.mori_contacts for insert to authenticated with check (public.mori_access(tenant_id,page_id));
create policy contact_update on public.mori_contacts for update to authenticated using (public.mori_access(tenant_id,page_id)) with check (public.mori_access(tenant_id,page_id));
alter table public.mori_messages enable row level security;
create policy message_read on public.mori_messages for select to authenticated using (public.mori_contact_access(tenant_id,contact_id));
create policy message_insert on public.mori_messages for insert to authenticated with check (public.mori_contact_access(tenant_id,contact_id));
create policy message_update on public.mori_messages for update to authenticated using (public.mori_contact_access(tenant_id,contact_id)) with check (public.mori_contact_access(tenant_id,contact_id));
alter table public.mori_orders enable row level security;
create policy order_all on public.mori_orders for all to authenticated using (public.mori_contact_access(tenant_id,contact_id)) with check (public.mori_contact_access(tenant_id,contact_id));
alter table public.mori_ads enable row level security;
create policy ads_read on public.mori_ads for select to authenticated using (public.mori_access(tenant_id,account_id));
create policy ads_update on public.mori_ads for update to authenticated using (public.mori_role(tenant_id) in ('head','admin')) with check (public.mori_role(tenant_id) in ('head','admin'));
alter table public.mori_spend enable row level security;
create policy spend_read on public.mori_spend for select to authenticated using (exists(select 1 from public.mori_ads a where a.tenant_id=mori_spend.tenant_id and a.id=mori_spend.ad_id and public.mori_access(a.tenant_id,a.account_id)));
alter table public.mori_documents enable row level security;
create policy document_read on public.mori_documents for select to authenticated using (public.mori_role(tenant_id) is not null);
create policy document_write on public.mori_documents for all to authenticated using (public.mori_role(tenant_id) in ('head','admin')) with check (public.mori_role(tenant_id) in ('head','admin'));
alter table public.mori_chunks enable row level security;
create policy chunk_read on public.mori_chunks for select to authenticated using (public.mori_role(tenant_id) is not null);
create policy chunk_write on public.mori_chunks for all to authenticated using (public.mori_role(tenant_id) in ('head','admin')) with check (public.mori_role(tenant_id) in ('head','admin'));
alter table public.mori_faqs enable row level security;
create policy faq_read on public.mori_faqs for select to authenticated using (public.mori_role(tenant_id) is not null);
create policy faq_write on public.mori_faqs for all to authenticated using (public.mori_role(tenant_id) in ('head','admin')) with check (public.mori_role(tenant_id) in ('head','admin'));
alter table public.mori_touchpoints enable row level security;
create policy touchpoint_read on public.mori_touchpoints for select to authenticated using (public.mori_contact_access(tenant_id,contact_id));
create policy touchpoint_update on public.mori_touchpoints for update to authenticated using (public.mori_contact_access(tenant_id,contact_id)) with check (public.mori_contact_access(tenant_id,contact_id));
alter table public.mori_audit enable row level security;
create policy audit_read on public.mori_audit for select to authenticated using (public.mori_role(tenant_id) in ('head','admin'));
create policy audit_insert on public.mori_audit for insert to authenticated with check (public.mori_role(tenant_id) is not null and actor_id=auth.uid());
alter table public.mori_webhook_events enable row level security;

grant usage on schema public,extensions to authenticated;
grant select,update on public.mori_tenants to authenticated;
grant select on public.mori_memberships,public.mori_assignments to authenticated;
revoke all on public.mori_resources from anon,authenticated;
grant select (tenant_id,id,name,type,status,currency,timezone,connected_by,updated_at) on public.mori_resources to authenticated;
grant select,insert,update on public.mori_contacts,public.mori_messages to authenticated;
grant select,insert,update,delete on public.mori_orders,public.mori_documents,public.mori_chunks,public.mori_faqs to authenticated;
grant select,update on public.mori_ads,public.mori_touchpoints to authenticated;
grant select on public.mori_spend to authenticated;
grant select,insert on public.mori_audit to authenticated;
-- Do not expose internal deliveries to browser roles, including service API defaults.
revoke all on public.mori_webhook_events from anon,authenticated;
