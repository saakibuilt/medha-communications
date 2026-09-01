-- ============================================================
-- THE ACTUAL FIX. Run this whole file in the Supabase SQL editor.
--
-- Diagnosed from the live database: every notification is failing with
--
--   Could not find the table 'public.medha_notification_deliveries'
--
-- That table does not exist. The notification processor records each
-- successful push in it, so the push IS sent and then the write throws,
-- the event is marked failed, and delivery never completes. This affects
-- EVERY app that uses the queue - clockin, files, warehouse, news and
-- events - not just Space. It has been broken independently of any
-- recent change.
--
-- The migration that created it (20260731161000_recurring_notification_
-- reminders.sql) was never applied to this project.
-- ============================================================

-- ---------- 1. create the missing table ----------
create table if not exists public.medha_notification_deliveries (
  event_id uuid not null
    references public.medha_notification_events(id) on delete cascade,
  subscription_id text not null,
  delivered boolean not null default false,
  delivered_at timestamptz,
  last_error text,
  primary key (event_id, subscription_id)
);

alter table public.medha_notification_deliveries enable row level security;
revoke all on public.medha_notification_deliveries from anon, authenticated;

-- PostgREST caches the schema; tell it to reload or the API keeps 404ing.
notify pgrst, 'reload schema';

-- ---------- 2. retry everything the missing table stranded ----------
update public.medha_notification_events
   set status = 'pending',
       attempts = 0,
       next_attempt_at = now(),
       last_error = null
 where status in ('failed', 'pending')
   and last_error like '%medha_notification_deliveries%';

-- ---------- 3. Space sends direct and stores nothing ----------
-- With the table restored the queue works for every other app. Space still
-- should not persist anything, so its trigger posts straight to
-- /api/space-push (already deployed) and writes no rows.
create or replace function public.medha_communications_message_notification_trigger()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  recipients text[];
  targets    text[];
  sender_name text;
  words      text[];
  preview    text;
begin
  select c.participant_ids into recipients
    from public.medha_communications_conversations c
   where c.cid = new.cid;
  if recipients is null then return new; end if;

  select array_agg(r) into targets
    from unnest(recipients) r
   where r is not null and r <> '' and r <> new.sender_id;
  if targets is null or array_length(targets, 1) = 0 then return new; end if;

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

  begin
    perform net.http_post(
      url     := 'https://medha-activities.vercel.app/api/space-push',
      headers := jsonb_build_object('Content-Type', 'application/json'),
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

-- ---------- 4. clear stored Space notifications ----------
delete from public.medha_notification_deliveries d
  using public.medha_notification_events e
 where d.event_id = e.id and e.event_type = 'space_message';
delete from public.medha_notification_events where event_type = 'space_message';

-- ---------- verify ----------
-- Should return 0 rows once the queue has run:
--   select status, count(*) from public.medha_notification_events
--    where last_error like '%deliveries%' group by status;
