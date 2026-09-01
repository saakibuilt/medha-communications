-- ============================================================
-- PREREQUISITE — do this FIRST, or these policies lock everyone out.
--
-- These policies identify the caller from a verified Firebase JWT.
-- Supabase only verifies that JWT once Firebase is registered as a
-- third-party auth provider:
--   Supabase dashboard > Authentication > Sign In / Providers
--     > Third Party Auth > Add provider > Firebase
--     > project id: medhaclockin
-- Then set USE_FIREBASE_JWT = true in app.js and redeploy.
--
-- Until BOTH steps are done, medha_current_uid() returns null, every
-- policy below denies, and the app shows no conversations. Run this
-- file only when you are ready to complete both steps together.
--
-- To roll back to the previous open behaviour, see the bottom of this file.
-- ============================================================

-- ============================================================
-- Medha Space — conversation privacy and integrity.
-- Run AFTER supabase-communications.sql, in the shared Supabase project.
-- ============================================================

-- Presence keyed by Firebase uid (text), matching every other table.
-- The old uuid column silently rejected every write.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='medha_communications_presence'
               and column_name='user_id' and data_type='uuid') then
    drop table public.medha_communications_presence;
  end if;
end $$;
create table if not exists public.medha_communications_presence (
  user_id text primary key,
  is_open boolean not null default false,
  last_seen timestamptz not null default now()
);
alter table public.medha_communications_presence enable row level security;

-- The signed-in Firebase uid, taken from the verified JWT.
create or replace function public.medha_current_uid() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'user_id',''),
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')
  );
$$;

create or replace function public.medha_is_participant(conversation bigint) returns boolean
language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.medha_communications_user_conversations uc
    where uc.cid = conversation
      and uc.user_id = public.medha_current_uid()
  );
$$;

-- ---------- conversations: only your own ----------
drop policy if exists "communications conversations all" on public.medha_communications_conversations;
drop policy if exists "conversations select own" on public.medha_communications_conversations;
create policy "conversations select own" on public.medha_communications_conversations
  for select using (public.medha_current_uid() = any (participant_ids));
drop policy if exists "conversations insert own" on public.medha_communications_conversations;
create policy "conversations insert own" on public.medha_communications_conversations
  for insert with check (public.medha_current_uid() = any (participant_ids));
drop policy if exists "conversations update own" on public.medha_communications_conversations;
create policy "conversations update own" on public.medha_communications_conversations
  for update using (public.medha_current_uid() = any (participant_ids))
         with check (public.medha_current_uid() = any (participant_ids));

-- ---------- messages: only in your conversations, only as yourself ----------
drop policy if exists "communications messages all" on public.medha_communications_messages;
drop policy if exists "messages select own" on public.medha_communications_messages;
create policy "messages select own" on public.medha_communications_messages
  for select using (public.medha_is_participant(cid));
drop policy if exists "messages insert own" on public.medha_communications_messages;
create policy "messages insert own" on public.medha_communications_messages
  for insert with check (
    sender_id = public.medha_current_uid()
    and public.medha_is_participant(cid)
  );
-- Reactions are the only field a participant may change on someone else's message.
drop policy if exists "messages update reactions" on public.medha_communications_messages;
create policy "messages update reactions" on public.medha_communications_messages
  for update using (public.medha_is_participant(cid))
         with check (public.medha_is_participant(cid));
drop policy if exists "messages delete own" on public.medha_communications_messages;
create policy "messages delete own" on public.medha_communications_messages
  for delete using (sender_id = public.medha_current_uid());

-- Nobody may rewrite the author or move a message between conversations.
create or replace function public.medha_communications_message_immutable() returns trigger
language plpgsql as $$
begin
  if new.sender_id <> old.sender_id or new.cid <> old.cid
     or new.body <> old.body or new.created_at <> old.created_at then
    raise exception 'Only reactions may be updated on a message';
  end if;
  return new;
end; $$;
drop trigger if exists medha_communications_message_immutable_trigger on public.medha_communications_messages;
create trigger medha_communications_message_immutable_trigger
  before update on public.medha_communications_messages
  for each row execute function public.medha_communications_message_immutable();

-- ---------- per-user conversation list: only your own rows ----------
drop policy if exists "user conversations own" on public.medha_communications_user_conversations;
create policy "user conversations own" on public.medha_communications_user_conversations
  for all using (user_id = public.medha_current_uid())
          with check (user_id = public.medha_current_uid());

-- The sidebar view runs with the caller's rights, so it inherits the
-- policies above rather than bypassing them.
alter view public.medha_communications_my_conversations set (security_invoker = true);

-- ---------- presence: read all, write only yourself ----------
drop policy if exists "communications presence all" on public.medha_communications_presence;
drop policy if exists "presence read" on public.medha_communications_presence;
create policy "presence read" on public.medha_communications_presence for select using (true);
drop policy if exists "presence write own" on public.medha_communications_presence;
create policy "presence write own" on public.medha_communications_presence
  for all using (user_id = public.medha_current_uid())
          with check (user_id = public.medha_current_uid());
create index if not exists medha_communications_presence_seen_idx
  on public.medha_communications_presence(last_seen);

-- ---------- meetings: only ones you created or were invited to ----------
drop policy if exists "communications meetings all" on public.medha_communications_meetings;
drop policy if exists "meetings select involved" on public.medha_communications_meetings;
create policy "meetings select involved" on public.medha_communications_meetings
  for select using (
    created_by = public.medha_current_uid()
    or public.medha_current_uid() = any (invitee_ids)
  );
drop policy if exists "meetings insert own" on public.medha_communications_meetings;
create policy "meetings insert own" on public.medha_communications_meetings
  for insert with check (created_by = public.medha_current_uid());
drop policy if exists "meetings modify own" on public.medha_communications_meetings;
create policy "meetings modify own" on public.medha_communications_meetings
  for update using (created_by = public.medha_current_uid())
         with check (created_by = public.medha_current_uid());
drop policy if exists "meetings delete own" on public.medha_communications_meetings;
create policy "meetings delete own" on public.medha_communications_meetings
  for delete using (created_by = public.medha_current_uid());

-- ---------- storage: signed-in users only, own folder for writes ----------
drop policy if exists "communications files read" on storage.objects;
create policy "communications files read" on storage.objects
  for select using (bucket_id='medha-communications-files' and public.medha_current_uid() is not null);
drop policy if exists "communications files insert" on storage.objects;
create policy "communications files insert" on storage.objects
  for insert with check (
    bucket_id='medha-communications-files'
    and (storage.foldername(name))[1] = public.medha_current_uid()
  );
drop policy if exists "communications files delete" on storage.objects;
create policy "communications files delete" on storage.objects
  for delete using (
    bucket_id='medha-communications-files'
    and (storage.foldername(name))[1] = public.medha_current_uid()
  );
-- Leave the bucket public until step 1 (Firebase third-party auth) is done;
-- flipping it early makes every existing attachment 404 for all users.
-- After step 1, uncomment:
-- update storage.buckets set public=false where id='medha-communications-files';

-- ============================================================
-- ROLLBACK — restores the previous permissive behaviour.
-- ============================================================
-- create policy "communications conversations all" on public.medha_communications_conversations for all using (true) with check (true);
-- create policy "communications messages all"      on public.medha_communications_messages      for all using (true) with check (true);
-- create policy "communications user chats all"    on public.medha_communications_user_chats    for all using (true) with check (true);
-- create policy "communications presence all"      on public.medha_communications_presence      for all using (true) with check (true);
-- create policy "communications meetings all"      on public.medha_communications_meetings      for all using (true) with check (true);
