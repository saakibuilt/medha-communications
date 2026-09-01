-- ============================================================
-- Medha Space — fix "null value in column conversation_id".
--
-- RUN THIS NOW. Sending is broken until you do.
--
-- supabase-communications-compact.sql added the compact `cid` key and
-- backfilled it, but left the old text `conversation_id` column in place
-- and still NOT NULL. The client writes only `cid`, so every insert fails:
--
--   null value in column "conversation_id" of relation
--   "medha_communications_messages" violates not-null constraint
--
-- This retires the old column safely: backfill anything still missing,
-- keep both columns in step for existing rows, then drop the old one.
-- ============================================================

begin;

-- 1. Safety net: make sure every row has a cid before the old column goes.
update public.medha_communications_messages m
   set cid = c.cid
  from public.medha_communications_conversations c
 where c.id = m.conversation_id
   and m.cid is null;

-- 2. Anything still without a cid has no conversation to belong to.
delete from public.medha_communications_messages where cid is null;

-- 3. cid is now the real key.
alter table public.medha_communications_messages
  alter column cid set not null;

-- 4. Retire the old text key. `cid` fully replaces it, and dropping it is
--    what actually unblocks sending.
alter table public.medha_communications_messages
  drop column if exists conversation_id;

-- 5. The old notification trigger read new.conversation_id, which no
--    longer exists. Rebuild it against cid so message pushes keep working.
create or replace function public.medha_communications_message_notification_trigger()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  recipient text;
  recipients text[];
  sender_name text;
  normalized_words text[];
  notification_text text;
begin
  select participant_ids into recipients
    from public.medha_communications_conversations
   where cid = new.cid;

  select coalesce(full_name, 'New message') into sender_name
    from public.users where id = new.sender_id limit 1;

  normalized_words := regexp_split_to_array(regexp_replace(trim(new.body), '\s+', ' ', 'g'), ' ');
  notification_text := array_to_string(normalized_words[1:10], ' ')
    || case when coalesce(array_length(normalized_words, 1), 0) > 10 then ' …' else '' end;

  foreach recipient in array coalesce(recipients, array[]::text[]) loop
    if recipient is not null and recipient <> '' and recipient <> new.sender_id then
      perform net.http_post(
        url := 'https://medha-activities.vercel.app/api/process-notifications',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('source', 'space-message', 'event', jsonb_build_object(
          'activity_id', new.id,
          'recipient_uid', recipient,
          'event_type', 'space_message',
          'notification_title', sender_name,
          'notification_body', coalesce(notification_text, 'New message'),
          'target_url', 'https://medha-hub.web.app/',
          'tag', 'space-message-' || new.id::text || '-' || recipient
        ))
      );
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists medha_communications_message_notifications
  on public.medha_communications_messages;
create trigger medha_communications_message_notifications
  after insert on public.medha_communications_messages
  for each row execute function public.medha_communications_message_notification_trigger();

commit;

-- Verify: this should list cid but NOT conversation_id.
--   select column_name, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'medha_communications_messages'
--    order by ordinal_position;
