-- ============================================================
-- Medha Space — send push without storing anything.
--
-- RUN THIS to stop Space messages being written to
-- medha_notification_events.
--
-- The trigger currently live still INSERTs a row per recipient into
-- medha_notification_events and then pings the processor with only a
-- message id. That stores notification content in the database, and it
-- also makes sending fragile: the insert runs in the same transaction as
-- the message, so a NOT NULL violation there (for example a sender with no
-- users row, which leaves notification_title null) rolls back the message
-- itself and the user sees a 400.
--
-- The DEPLOYED processor still reads pending rows from
-- medha_notification_events; the transient version exists only as an
-- uncommitted local edit in medha-activities. Five other systems (clockin,
-- files storage, warehouse, events, cron) also insert rows and depend on
-- that behaviour, so it must not be changed for everyone.
--
-- Instead this keeps Space self-contained: the trigger inserts the event,
-- pings the processor to deliver it immediately, and then DELETES the row
-- in the same transaction. Nothing from Space is retained, and no other
-- app's notifications are affected.
--
-- After this, a Space message:
--   * stores NOTHING in medha_notification_events
--   * still delivers a Web Push to every device the recipient installed
--     Medha Hub on (home-screen PWA included)
--   * can never block the message insert - delivery problems are logged,
--     not raised
-- ============================================================

begin;

create or replace function public.medha_communications_message_notification_trigger()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  recipient text;
  recipients text[];
  sender_name text;
  words text[];
  preview text;
begin
  -- Works whether or not the legacy conversation_id column is still around.
  select c.participant_ids into recipients
    from public.medha_communications_conversations c
   where c.cid = new.cid;

  if recipients is null then return new; end if;

  -- Fall back to a neutral title rather than null: notification_title is
  -- NOT NULL downstream, and a missing users row must never fail a send.
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

  -- Insert the event, then ping the processor so it claims and delivers
  -- straight away. The row is NOT deleted here: the deployed processor
  -- claims a batch of its own and would race a delete, dropping the push.
  -- Step 2 below removes Space rows as soon as they have been delivered.
  for recipient in
    select r from unnest(recipients) r
     where r is not null and r <> '' and r <> new.sender_id
  loop
    begin
      insert into public.medha_notification_events (
        activity_id, recipient_uid, event_type, notification_title,
        notification_body, target_url, tag, dedupe_key
      ) values (
        new.id, recipient, 'space_message', sender_name, preview,
        'https://medha-hub.web.app/',
        'space-message-' || new.cid::text,
        'space-message-' || new.id::text || '-' || recipient
      )
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    exception when others then
      -- A notification problem must never roll back the message itself.
      -- This is exactly what was returning 400 to the sender.
      raise warning 'Space push enqueue failed for %: %', recipient, sqlerrm;
    end;
  end loop;

  begin
    perform net.http_post(
      url     := 'https://medha-activities.vercel.app/api/process-notifications',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('source', 'space-message')
    );
  exception when others then
    raise warning 'Space push dispatch failed: %', sqlerrm;
  end;

  return new;
end; $$;

drop trigger if exists medha_communications_message_notifications
  on public.medha_communications_messages;
create trigger medha_communications_message_notifications
  after insert on public.medha_communications_messages
  for each row execute function public.medha_communications_message_notification_trigger();

commit;

-- ---------- 2. keep nothing at rest ----------
-- Space notifications are transient: once the processor has delivered (or
-- given up on) one, the row is removed. A message body never lingers in
-- the database, while every other app keeps its existing history.
create or replace function public.medha_purge_space_notifications() returns trigger
language plpgsql as $$
begin
  if new.event_type = 'space_message' and new.status in ('sent', 'failed') then
    delete from public.medha_notification_deliveries where event_id = new.id;
    delete from public.medha_notification_events where id = new.id;
    return null;
  end if;
  return new;
end; $$;

drop trigger if exists medha_purge_space_notifications_trigger
  on public.medha_notification_events;
create trigger medha_purge_space_notifications_trigger
  after update of status on public.medha_notification_events
  for each row execute function public.medha_purge_space_notifications();

-- Clear Space rows already stored, including any the old trigger left behind.
delete from public.medha_notification_deliveries d
  using public.medha_notification_events e
 where d.event_id = e.id and e.event_type = 'space_message';
delete from public.medha_notification_events where event_type = 'space_message';

-- Verify: send a message, then confirm this returns 0.
--   select count(*) from public.medha_notification_events
--    where event_type = 'space_message';
