-- Live RPC function: send_now (admin-only instant send)
-- Inserts an inbox item immediately, rate limited to 10 per hour.
create or replace function public.send_now(mid uuid) returns void language plpgsql security definer set search_path=public,extensions as $$
declare
  m messages;
  r relationships;
  iid uuid;
  k text;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  -- Verify message is active and exists
  select * into m from messages where id = mid and status = 'active';
  if not found then raise exception 'message not found or inactive'; end if;

  -- Verify current user is the admin of this relationship
  if not is_admin_of(m.relationship_id) then raise exception 'not allowed'; end if;

  -- Verify relationship is active with an approved recipient
  select * into r from relationships where id = m.relationship_id;
  if not found or r.status <> 'active' or r.recipient_user_id is null then
    raise exception 'relationship not active';
  end if;

  -- Rate limit: maximum 10 instant sends per hour per relationship
  if (select count(*) from inbox_items where relationship_id = r.id and scheduled_occurrence_key like 'now:%' and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate limited';
  end if;

  -- Insert inbox item immediately (available now, expires in 7 days)
  k := 'now:' || gen_random_uuid();
  insert into inbox_items(relationship_id, message_id, recipient_user_id, scheduled_occurrence_key, title_snapshot, body_snapshot, category_snapshot, available_at, expires_at)
  values(r.id, m.id, r.recipient_user_id, k, m.title, m.body, m.category, now(), now() + interval '7 days')
  returning id into iid;

  -- Insert initial delivery event ('queued')
  insert into delivery_events(relationship_id, inbox_item_id, event_type, idempotency_key)
  values(r.id, iid, 'queued', k || ':q')
  on conflict do nothing;
end $$;

revoke execute on function public.send_now(uuid) from public, anon;
grant execute on function public.send_now(uuid) to authenticated;
