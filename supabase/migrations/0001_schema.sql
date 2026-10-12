create extension if not exists pgcrypto;

create table profiles(id uuid primary key references auth.users(id) on delete cascade,
 display_name text check (char_length(display_name)<=60), created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table relationships(id uuid primary key default gen_random_uuid(),
 admin_user_id uuid not null references profiles(id),
 recipient_user_id uuid references profiles(id),
 status text not null default 'pending' check (status in ('pending','active','paused','revoked')),
 max_devices int not null default 2 check (max_devices between 1 and 5),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revoked_at timestamptz,
 check (recipient_user_id is null or recipient_user_id<>admin_user_id));
create index on relationships(admin_user_id); create index on relationships(recipient_user_id);

create table invitations(id uuid primary key default gen_random_uuid(),
 relationship_id uuid not null references relationships(id) on delete cascade,
 token_hash text not null unique, created_by uuid not null references profiles(id),
 expires_at timestamptz not null, redeemed_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now());
create index on invitations(relationship_id);

create table messages(id uuid primary key default gen_random_uuid(),
 relationship_id uuid not null references relationships(id), created_by uuid not null references profiles(id),
 title text check (char_length(title)<=100), body text not null check (char_length(body) between 1 and 1000),
 category text not null check (category in ('romance','encouragement','self_care')),
 status text not null default 'active' check (status in ('draft','active','archived','deleted')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);
create index on messages(relationship_id,status);

create table schedules(id uuid primary key default gen_random_uuid(),
 relationship_id uuid not null references relationships(id), message_id uuid not null references messages(id),
 created_by uuid not null references profiles(id),
 schedule_type text not null check (schedule_type in ('once','recurring')),
 timezone text not null, local_time time, weekdays int[] check (weekdays is null or weekdays <@ array[1,2,3,4,5,6,7]),
 starts_at timestamptz, ends_at timestamptz, next_run_at timestamptz,
 status text not null default 'active' check (status in ('active','paused','cancelled','completed')),
 recurrence_config jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (schedule_type='once' and starts_at is not null or schedule_type='recurring' and local_time is not null),
 check (ends_at is null or starts_at is null or ends_at>starts_at));
create index on schedules(status,next_run_at); create index on schedules(relationship_id); create index on schedules(message_id);

create table device_installations(id uuid primary key default gen_random_uuid(),
 relationship_id uuid not null references relationships(id) on delete cascade,
 recipient_user_id uuid not null references profiles(id), installation_id uuid not null,
 status text not null default 'active' check (status in ('active','revoked','disconnected')),
 last_seen_at timestamptz, created_at timestamptz not null default now(), revoked_at timestamptz,
 unique(relationship_id,installation_id));

create table inbox_items(id uuid primary key default gen_random_uuid(),
 relationship_id uuid not null references relationships(id), message_id uuid references messages(id) on delete set null,
 recipient_user_id uuid not null references profiles(id), scheduled_occurrence_key text not null,
 title_snapshot text, body_snapshot text not null, category_snapshot text not null,
 available_at timestamptz not null default now(), expires_at timestamptz,
 status text not null default 'available' check (status in ('available','dismissed','expired','unavailable')),
 created_at timestamptz not null default now(),
 unique(relationship_id,recipient_user_id,scheduled_occurrence_key));
create index on inbox_items(recipient_user_id,status,available_at desc);

create table delivery_events(id uuid primary key default gen_random_uuid(),
 relationship_id uuid not null references relationships(id) on delete cascade,
 inbox_item_id uuid references inbox_items(id) on delete set null, schedule_id uuid references schedules(id) on delete set null,
 installation_id uuid,
 event_type text not null check (event_type in ('queued','sent_to_extension','notification_requested','failed','expired')),
 occurred_at timestamptz not null default now(), idempotency_key text unique, details jsonb);
create index on delivery_events(occurred_at); create index on delivery_events(relationship_id,occurred_at desc);

create table preferences(id uuid primary key default gen_random_uuid(),
 recipient_user_id uuid not null references profiles(id), relationship_id uuid not null references relationships(id) on delete cascade,
 timezone text not null default 'UTC', quiet_hours_start time, quiet_hours_end time,
 max_reminders_per_shift int not null default 3 check (max_reminders_per_shift between 0 and 3),
 shift_start time, shift_end time, notifications_enabled boolean not null default true,
 show_message_content_in_notifications boolean not null default false,
 companion_enabled boolean not null default true, sound_enabled boolean not null default false,
 reduced_motion boolean not null default false, updated_at timestamptz not null default now(),
 unique(recipient_user_id,relationship_id));

create table deletion_requests(id uuid primary key default gen_random_uuid(),
 requester_user_id uuid not null references profiles(id), relationship_id uuid,
 scope text not null check (scope in ('inbox','account','relationship')),
 status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
 created_at timestamptz not null default now(), completed_at timestamptz);

-- profile bootstrap
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,display_name) values(new.id, left(coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)),60)); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- helpers
create function is_admin_of(r uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from relationships where id=r and admin_user_id=auth.uid()) $$;
create function is_recipient_of(r uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from relationships where id=r and recipient_user_id=auth.uid()) $$;

-- next occurrence: local wall time in tz. DST: nonexistent local times shift forward (Postgres rule); ambiguous times use first occurrence.
create function next_occurrence(tz text,lt time,wd int[],after timestamptz) returns timestamptz language plpgsql stable as $$
declare d date; ts timestamptz; i int; begin
 for i in 0..14 loop d:=((after at time zone tz)::date)+i;
  if wd is null or extract(isodow from d)::int=any(wd) then ts:=(d+lt) at time zone tz; if ts>after then return ts; end if; end if; end loop; return null; end $$;

create function schedules_before() returns trigger language plpgsql as $$
begin
 if not exists(select 1 from pg_timezone_names where name=new.timezone) then raise exception 'invalid timezone'; end if;
 new.updated_at=now();
 if new.status='active' and (tg_op='INSERT' or new.next_run_at is null or old.status<>'active' or
    (new.local_time,new.weekdays,new.timezone,new.starts_at) is distinct from (old.local_time,old.weekdays,old.timezone,old.starts_at)) then
  if new.schedule_type='once' then new.next_run_at:=new.starts_at;
  else new.next_run_at:=next_occurrence(new.timezone,new.local_time,new.weekdays,greatest(now(),coalesce(new.starts_at,now()))); end if;
 end if;
 if new.status in ('cancelled','completed') then new.next_run_at:=null; end if;
 return new; end $$;
create trigger schedules_bi before insert or update on schedules for each row execute function schedules_before();

-- message withdrawn/deleted => cancel future schedules
create function messages_deleted() returns trigger language plpgsql security definer set search_path=public as $$
begin if new.status in ('deleted','archived') and old.status<>new.status then
 update schedules set status='cancelled' where message_id=new.id and status in ('active','paused'); end if; return new; end $$;
create trigger messages_au after update on messages for each row execute function messages_deleted();

-- ===== RPCs =====
create function create_invitation() returns text language plpgsql security definer set search_path=public as $$
declare rid uuid; tok text; begin
 if auth.uid() is null then raise exception 'auth required'; end if;
 if (select count(*) from invitations where created_by=auth.uid() and created_at>now()-interval '1 hour')>=5 then raise exception 'rate limited'; end if;
 select id into rid from relationships where admin_user_id=auth.uid() and status in ('pending') order by created_at desc limit 1;
 if rid is null then
  if exists(select 1 from relationships where admin_user_id=auth.uid() and status in ('active','paused')) then raise exception 'relationship exists'; end if;
  insert into relationships(admin_user_id) values(auth.uid()) returning id into rid; end if;
 update invitations set revoked_at=now() where relationship_id=rid and redeemed_at is null and revoked_at is null;
 tok:=encode(gen_random_bytes(24),'hex');
 insert into invitations(relationship_id,token_hash,created_by,expires_at) values(rid,encode(digest(tok,'sha256'),'hex'),auth.uid(),now()+interval '24 hours');
 return tok; end $$;

create function redeem_invitation(token text) returns table(relationship_id uuid,admin_name text) language plpgsql security definer set search_path=public as $$
declare inv invitations; rel relationships; begin
 if auth.uid() is null then raise exception 'auth required'; end if;
 select * into inv from invitations where token_hash=encode(digest(token,'sha256'),'hex') for update;
 if not found or inv.redeemed_at is not null or inv.revoked_at is not null or inv.expires_at<now() then raise exception 'invalid invitation'; end if;
 select * into rel from relationships where id=inv.relationship_id for update;
 if rel.admin_user_id=auth.uid() or rel.status<>'pending' then raise exception 'invalid invitation'; end if;
 update invitations set redeemed_at=now() where id=inv.id;
 update relationships set recipient_user_id=auth.uid(),updated_at=now() where id=rel.id;
 return query select rel.id,(select display_name from profiles where id=rel.admin_user_id); end $$;

create function approve_pairing(rid uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update relationships set status='active',updated_at=now() where id=rid and recipient_user_id=auth.uid() and status='pending';
 if not found then raise exception 'cannot approve'; end if;
 insert into preferences(recipient_user_id,relationship_id) values(auth.uid(),rid) on conflict do nothing; end $$;

-- status transitions: admin may revoke only; recipient may pause/resume/revoke
create function set_relationship_status(rid uuid,s text) returns void language plpgsql security definer set search_path=public as $$
declare r relationships; begin
 select * into r from relationships where id=rid for update;
 if r.status='revoked' then raise exception 'revoked'; end if;
 if r.recipient_user_id=auth.uid() and s in ('paused','active','revoked') and not (s='active' and r.status='pending') then null;
 elsif r.admin_user_id=auth.uid() and s='revoked' then null;
 else raise exception 'not allowed'; end if;
 update relationships set status=s,updated_at=now(),revoked_at=case when s='revoked' then now() end where id=rid;
 if s='revoked' then
  update device_installations set status='revoked',revoked_at=now() where relationship_id=rid and status='active';
  update schedules set status='cancelled' where relationship_id=rid and status in ('active','paused'); end if; end $$;

create function register_installation(rid uuid,inst uuid) returns void language plpgsql security definer set search_path=public as $$
declare r relationships; begin
 select * into r from relationships where id=rid and recipient_user_id=auth.uid() and status in ('active','paused');
 if not found then raise exception 'not authorized'; end if;
 if exists(select 1 from device_installations where relationship_id=rid and installation_id=inst and status='revoked') then raise exception 'device revoked'; end if;
 if not exists(select 1 from device_installations where relationship_id=rid and installation_id=inst and status='active')
    and (select count(*) from device_installations where relationship_id=rid and status='active')>=r.max_devices then raise exception 'device limit'; end if;
 insert into device_installations(relationship_id,recipient_user_id,installation_id,status,last_seen_at) values(rid,auth.uid(),inst,'active',now())
 on conflict(relationship_id,installation_id) do update set last_seen_at=now(),status=case when device_installations.status='disconnected' then 'active' else device_installations.status end; end $$;

create function revoke_device(did uuid) returns void language plpgsql security definer set search_path=public as $$
begin update device_installations d set status='revoked',revoked_at=now() from relationships r
 where d.id=did and r.id=d.relationship_id and (r.admin_user_id=auth.uid() or d.recipient_user_id=auth.uid());
 if not found then raise exception 'not allowed'; end if; end $$;

-- Materialize due occurrences into recipient inboxes. Stale (>1h late) occurrences are skipped: no backlog burst.
create function process_due_schedules(rid uuid default null) returns int language plpgsql security definer set search_path=public as $$
declare s schedules; r relationships; m messages; n int:=0; occ timestamptz; begin
 for s in select * from schedules where status='active' and next_run_at<=now() and (rid is null or relationship_id=rid) for update skip locked loop
  occ:=s.next_run_at; select * into r from relationships where id=s.relationship_id; select * into m from messages where id=s.message_id;
  if r.status='active' and m.status='active' and (s.ends_at is null or occ<=s.ends_at) and now()-occ<=interval '1 hour' then
   insert into inbox_items(relationship_id,message_id,recipient_user_id,scheduled_occurrence_key,title_snapshot,body_snapshot,category_snapshot,available_at,expires_at)
   values(r.id,m.id,r.recipient_user_id,s.id||':'||extract(epoch from occ)::bigint,m.title,m.body,m.category,occ,occ+interval '7 days') on conflict do nothing;
   if found then n:=n+1; insert into delivery_events(relationship_id,schedule_id,event_type,idempotency_key) values(r.id,s.id,'queued',s.id||':'||extract(epoch from occ)::bigint||':q') on conflict do nothing; end if;
  end if;
  if s.schedule_type='once' then update schedules set status='completed',next_run_at=null where id=s.id;
  else update schedules set next_run_at=next_occurrence(s.timezone,s.local_time,s.weekdays,greatest(now(),occ)) where id=s.id;
   if s.ends_at is not null then update schedules set status='completed',next_run_at=null where id=s.id and next_run_at>s.ends_at; end if; end if;
 end loop; return n; end $$;

create function sync_inbox() returns int language plpgsql security definer set search_path=public as $$
declare n int; begin
 n:=process_due_schedules(null) ; update inbox_items set status='expired' where recipient_user_id=auth.uid() and status='available' and expires_at<now(); return n; end $$;

create function record_delivery_event(inbox uuid,inst uuid,et text,idem text) returns void language plpgsql security definer set search_path=public as $$
declare i inbox_items; begin
 select * into i from inbox_items where id=inbox and recipient_user_id=auth.uid();
 if not found then raise exception 'not allowed'; end if;
 if et not in ('sent_to_extension','notification_requested','failed') then raise exception 'bad event'; end if;
 insert into delivery_events(relationship_id,inbox_item_id,installation_id,event_type,idempotency_key) values(i.relationship_id,inbox,inst,et,idem) on conflict do nothing; end $$;

create function export_my_data() returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('profile',(select to_jsonb(p) from profiles p where id=auth.uid()),
  'inbox',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from inbox_items i where recipient_user_id=auth.uid()),
  'preferences',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from preferences x where recipient_user_id=auth.uid()),
  'messages_authored',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from messages m where created_by=auth.uid())) $$;

create function delete_my_inbox() returns void language plpgsql security definer set search_path=public as $$
declare d uuid; begin insert into deletion_requests(requester_user_id,scope,status) values(auth.uid(),'inbox','processing') returning id into d;
 delete from inbox_items where recipient_user_id=auth.uid();
 update deletion_requests set status='completed',completed_at=now() where id=d; end $$;

create function request_account_deletion(s text default 'account', rid uuid default null) returns uuid language plpgsql security definer set search_path=public as $$
declare d uuid; begin
 if auth.uid() is null then raise exception 'auth required'; end if;
 if s not in ('inbox','account','relationship') then raise exception 'invalid scope'; end if;
 insert into deletion_requests(requester_user_id,relationship_id,scope,status) values(auth.uid(),rid,s,'pending') returning id into d;
 return d; end $$;

create function cleanup_delivery_events() returns int language plpgsql security definer set search_path=public as $$
declare n int; begin delete from delivery_events where occurred_at<now()-interval '90 days'; get diagnostics n=row_count; return n; end $$;
revoke execute on function cleanup_delivery_events() from public,anon,authenticated;
revoke execute on function process_due_schedules(uuid) from public,anon,authenticated;
revoke execute on function handle_new_user() from public,anon,authenticated;
revoke execute on function create_invitation(),redeem_invitation(text),approve_pairing(uuid),set_relationship_status(uuid,text),register_installation(uuid,uuid),revoke_device(uuid),sync_inbox(),record_delivery_event(uuid,uuid,text,text),export_my_data(),delete_my_inbox(),request_account_deletion(text,uuid) from public,anon;

-- optional scheduling (enable pg_cron in dashboard first)
do $$ begin if exists(select 1 from pg_available_extensions where name='pg_cron') then
 begin
  create extension if not exists pg_cron;
  perform cron.schedule('smeal-cleanup','17 3 * * *','select public.cleanup_delivery_events()');
  perform cron.schedule('smeal-schedules','* * * * *','select public.process_due_schedules(null)');
 exception when others then
  raise notice 'pg_cron could not be configured: %', sqlerrm;
 end;
end if; end $$;

-- ===== RLS =====
alter table profiles enable row level security; alter table relationships enable row level security; alter table invitations enable row level security;
alter table messages enable row level security; alter table schedules enable row level security; alter table device_installations enable row level security;
alter table inbox_items enable row level security; alter table delivery_events enable row level security; alter table preferences enable row level security;
alter table deletion_requests enable row level security;

revoke select on invitations from authenticated, anon, public;

create policy p_sel on profiles for select using (id=auth.uid() or exists(select 1 from relationships r where (r.admin_user_id=auth.uid() and r.recipient_user_id=profiles.id) or (r.recipient_user_id=auth.uid() and r.admin_user_id=profiles.id)));
create policy p_upd on profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy rel_sel on relationships for select using (admin_user_id=auth.uid() or recipient_user_id=auth.uid());
-- invitations: admin may view metadata/revoke via RPC only; hashes not exposed -> no select policy.
create policy msg_sel on messages for select using (is_admin_of(relationship_id));
create policy msg_ins on messages for insert with check (is_admin_of(relationship_id) and created_by=auth.uid());
create policy msg_upd on messages for update using (is_admin_of(relationship_id)) with check (is_admin_of(relationship_id));
create policy sch_sel on schedules for select using (is_admin_of(relationship_id));
create policy sch_ins on schedules for insert with check (is_admin_of(relationship_id) and created_by=auth.uid()
  and exists(select 1 from messages m where m.id=message_id and m.relationship_id=schedules.relationship_id));
create policy sch_upd on schedules for update using (is_admin_of(relationship_id)) with check (is_admin_of(relationship_id));
create policy dev_sel on device_installations for select using (is_admin_of(relationship_id) or recipient_user_id=auth.uid());
create policy inbox_sel on inbox_items for select using (recipient_user_id=auth.uid());
create policy inbox_upd on inbox_items for update using (recipient_user_id=auth.uid()) with check (recipient_user_id=auth.uid() and status in ('available','dismissed'));
create policy ev_sel on delivery_events for select using (is_admin_of(relationship_id) or is_recipient_of(relationship_id));
create policy pref_sel on preferences for select using (recipient_user_id=auth.uid());
create policy pref_upd on preferences for update using (recipient_user_id=auth.uid()) with check (recipient_user_id=auth.uid());
create policy del_sel on deletion_requests for select using (requester_user_id=auth.uid());

-- column-level hardening: admins can't change ownership fields
revoke update on profiles,relationships,invitations,messages,schedules,device_installations,inbox_items,delivery_events,preferences from authenticated;
revoke insert,delete on all tables in schema public from authenticated,anon;
grant update(display_name) on profiles to authenticated;
grant update(title,body,category,status,updated_at,deleted_at) on messages to authenticated;
grant update(status,timezone,local_time,weekdays,starts_at,ends_at) on schedules to authenticated;
grant update(status) on inbox_items to authenticated;
grant update(timezone,quiet_hours_start,quiet_hours_end,max_reminders_per_shift,shift_start,shift_end,notifications_enabled,show_message_content_in_notifications,companion_enabled,sound_enabled,reduced_motion,updated_at) on preferences to authenticated;
grant insert on messages,schedules to authenticated;
revoke all on all tables in schema public from anon;
