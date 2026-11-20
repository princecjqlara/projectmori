-- Each Page has a single owner to avoid duplicate automated replies across tenants.
create unique index if not exists mori_one_workspace_per_page on public.mori_resources(id) where type='page';

-- Authenticated clients cannot spoof inbound messages, attribution, or encrypted tokens.
revoke insert,update on public.mori_messages from authenticated;
revoke update,insert on public.mori_contacts from authenticated;
grant insert (tenant_id,name,email,phone,page_id,notes,assigned_to) on public.mori_contacts to authenticated;
grant update (name,email,phone,stage,bot_state,notes,objections,form_answers,timezone,opted_out,assigned_to) on public.mori_contacts to authenticated;
revoke update on public.mori_tenants from authenticated;
grant update (name,timezone,expense_percent,expense_threshold_minor,automation_enabled,bot_enabled,aov_spend_multiplier,intake_fields,followup_templates) on public.mori_tenants to authenticated;
revoke update on public.mori_ads from authenticated;
grant update (automation_enabled) on public.mori_ads to authenticated;

create or replace function public.mori_sync_order_contact() returns trigger language plpgsql security definer set search_path=public
as $$
declare tid uuid; cid uuid; first_paid timestamptz;
begin
  if TG_OP='DELETE' then tid=OLD.tenant_id;cid=OLD.contact_id;else tid=NEW.tenant_id;cid=NEW.contact_id;end if;
  select min(paid_at) into first_paid from public.mori_orders where tenant_id=tid and contact_id=cid and status='paid';
  update public.mori_contacts set converted_at=first_paid,
    stage=case when first_paid is not null then 'converted' when stage='converted' then 'qualified' else stage end
    where tenant_id=tid and id=cid;
  if first_paid is not null then
    update public.mori_touchpoints set status='cancelled',reason='Contact converted' where tenant_id=tid and contact_id=cid and status in ('scheduled','blocked','needs_human');
  end if;
  return null;
end $$;
revoke all on function public.mori_sync_order_contact() from public;
create trigger mori_order_contact_sync after insert or update or delete on public.mori_orders for each row execute function public.mori_sync_order_contact();

create or replace function public.mori_order_validate() returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if TG_OP='UPDATE' and (NEW.tenant_id<>OLD.tenant_id or NEW.contact_id<>OLD.contact_id) then raise exception 'An order cannot move between contacts or workspaces';end if;
  if NEW.currency<>(select currency from public.mori_tenants where id=NEW.tenant_id) then raise exception 'Order currency must match workspace currency';end if;
  if NEW.status='paid' and (TG_OP='INSERT' or OLD.status<>'paid') then NEW.paid_at=coalesce(NEW.paid_at,now());end if;
  return NEW;
end $$;
revoke all on function public.mori_order_validate() from public;
create trigger mori_order_validation before insert or update on public.mori_orders for each row execute function public.mori_order_validate();

create or replace function public.mori_contact_stage_validate() returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if NEW.stage='converted' and not exists(select 1 from public.mori_orders where tenant_id=NEW.tenant_id and contact_id=NEW.id and status='paid') then raise exception 'A converted contact needs a paid order';end if;
  if NEW.stage<>'converted' and exists(select 1 from public.mori_orders where tenant_id=NEW.tenant_id and contact_id=NEW.id and status='paid') then raise exception 'Contacts with paid orders remain converted';end if;
  return NEW;
end $$;
revoke all on function public.mori_contact_stage_validate() from public;
create trigger mori_contact_stage_check before update of stage on public.mori_contacts for each row execute function public.mori_contact_stage_validate();
