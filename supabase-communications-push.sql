-- ============================================================
-- Medha Space — push is SENT, never SAVED.
--
-- RUN THIS. It replaces the live trigger.
--
-- Before: the trigger INSERTed one row per recipient into
-- medha_notification_events so a queue processor could pick it up later.
-- That stored the message preview in the database, and because the insert
-- ran inside the message's own transaction, any failure there (a sender
-- with no users row leaves notification_title null) rolled the message
-- back and the sender got a 400.
--
-- After: the trigger POSTs the notification straight to
-- /api/space-push, which delivers it to the recipient's devices and keeps
-- nothing. No row is written to medha_notification_events or
-- medha_notification_deliveries at any point.
--
--   * NOTHING about a Space message is stored for notification purposes
--   * Web Push still reaches every device the recipient installed Medha
--     Hub on, home-screen PWA included
--   * a delivery problem can never block or roll back a message
--
-- Other apps are untouched: clockin, files storage, warehouse and events
-- keep using /api/process-notifications and its stored-event queue.
--
-- Prerequisite: deploy medha-activities first, so /api/space-push exists.
-- If SPACE_PUSH_SECRET is set there, set it here too:
--   alter database postgres set app.space_push_secret = '<same value>';
-- ============================================================

begin;

create or replace function public.medha_communications_message_notification_trigger()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  recipients text[];
  targets    text[];
  sender_name text;
  words      text[];
  preview    text;
  secret     text;
  auth_header jsonb;
begin
  select c.participant_ids into recipients
    from public.medha_communications_conversations c
   where c.cid = new.cid;
  if recipients is null then return new; end if;

  -- Everyone in the thread except whoever sent it.
  select array_agg(r) into targets
    from unnest(recipients) r
   where r is not null and r <> '' and r <> new.sender_id;
  if targets is null or array_length(targets, 1) = 0 then return new; end if;

  -- Never null: a missing users row must not break the notification.
  select coalesce(nullif(trim(u.full_name), ''), 'New message')
    into sender_name
    from public.users u
   where u.id = new.sender_id
   limit 1;
  sender_name := coalesce(sender_name, 'New message');

  words   := regexp_split_to_array(regexp_replace(trim(coalesce(new.body, '')), '\s+', ' ', 'g'), ' ');
  preview := array_to_string(words[1:10], ' ')
             || case when coalesce(array_length(words, 1), 0) > 10 then ' …' else '' end;
  preview := coalesce(nullif(trim(preview), ''), 'New message');

  secret := current_setting('app.space_push_secret', true);
  auth_header := case
    when secret is null or secret = '' then jsonb_build_object('Content-Type', 'application/json')
    else jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret)
  end;

  -- Fire and forget. Nothing is written down.
  begin
    perform net.http_post(
      url     := 'https://medha-activities.vercel.app/api/space-push',
      headers := auth_header,
      body    := jsonb_build_object(
        'recipients', to_jsonb(targets),
        'title',      sender_name,
        'body',       preview,
        'url',        'https://medha-hub.web.app/',
        'tag',        'space-message-' || new.cid::text
      )
    );
  exception when others then
    raise warning 'Space push failed: %', sqlerrm;
  end;

  return new;
end; $$;

drop trigger if exists medha_communications_message_notifications
  on public.medha_communications_messages;
create trigger medha_communications_message_notifications
  after insert on public.medha_communications_messages
  for each row execute function public.medha_communications_message_notification_trigger();

commit;

-- Delete every Space notification the old trigger stored.
delete from public.medha_notification_deliveries d
  using public.medha_notification_events e
 where d.event_id = e.id and e.event_type = 'space_message';
delete from public.medha_notification_events where event_type = 'space_message';

-- Verify: send a message, then confirm this stays 0.
--   select count(*) from public.medha_notification_events
--    where event_type = 'space_message';
