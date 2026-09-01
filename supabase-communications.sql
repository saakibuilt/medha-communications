-- Run in the shared Medha Supabase project.
create table if not exists public.medha_communications_conversations (
  id text primary key,
  title text not null check (char_length(title) between 1 and 160),
  kind text not null default 'direct' check (kind in ('direct','group','channel')),
  participant_ids text[] not null default '{}',
  last_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.medha_communications_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.medha_communications_conversations(id) on delete cascade,
  sender_id text not null,
  body text not null check (char_length(body) between 1 and 4000),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.medha_communications_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.medha_communications_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
create or replace function public.medha_communications_single_reaction() returns trigger language plpgsql as $$ declare reaction_key text; begin select key into reaction_key from jsonb_object_keys(coalesce(new.reactions,'{}'::jsonb)) key order by key desc limit 1; if reaction_key is null then new.reactions='{}'::jsonb; else new.reactions=jsonb_build_object(reaction_key,coalesce(new.reactions->reaction_key,'[]'::jsonb)); end if; return new; end; $$;
drop trigger if exists medha_communications_single_reaction_trigger on public.medha_communications_messages;
create trigger medha_communications_single_reaction_trigger before insert or update of reactions on public.medha_communications_messages for each row execute function public.medha_communications_single_reaction();
create index if not exists medha_communications_messages_conversation_idx on public.medha_communications_messages(conversation_id, created_at);
create table if not exists public.medha_communications_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text,
  invitee_ids text[] not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists medha_communications_meetings_start_idx on public.medha_communications_meetings(start_at);
alter table public.medha_communications_meetings enable row level security;
alter table public.medha_communications_meetings add column if not exists location text;
drop policy if exists "communications meetings all" on public.medha_communications_meetings;
create policy "communications meetings all" on public.medha_communications_meetings for all using (true) with check (true);
insert into storage.buckets (id, name, public) values ('medha-communications-files', 'medha-communications-files', true) on conflict (id) do update set public = true;
drop policy if exists "communications files read" on storage.objects;
create policy "communications files read" on storage.objects for select using (bucket_id = 'medha-communications-files');
drop policy if exists "communications files insert" on storage.objects;
create policy "communications files insert" on storage.objects for insert with check (bucket_id = 'medha-communications-files');
drop policy if exists "communications files delete" on storage.objects;
create policy "communications files delete" on storage.objects for delete using (bucket_id = 'medha-communications-files');
alter table public.medha_communications_conversations enable row level security;
alter table public.medha_communications_messages enable row level security;
create table if not exists public.medha_communications_presence (
  user_id uuid primary key,
  is_open boolean not null default false,
  last_seen timestamptz not null default now()
);
alter table public.medha_communications_presence enable row level security;
drop policy if exists "communications presence all" on public.medha_communications_presence;
create policy "communications presence all" on public.medha_communications_presence for all using (true) with check (true);
create index if not exists medha_communications_presence_seen_idx on public.medha_communications_presence(last_seen);
create table if not exists public.medha_communications_user_chats (
  user_id text not null,
  conversation_id text not null references public.medha_communications_conversations(id) on delete cascade,
  display_name text not null,
  last_message text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.medha_communications_user_chats enable row level security;
drop policy if exists "communications user chats all" on public.medha_communications_user_chats;
create policy "communications user chats all" on public.medha_communications_user_chats for all using (true) with check (true);
create index if not exists medha_communications_user_chats_user_idx on public.medha_communications_user_chats(user_id, updated_at desc);
create or replace function public.medha_communications_sync_user_chats() returns trigger language plpgsql as $$ begin delete from public.medha_communications_user_chats where conversation_id=new.id and not (user_id=any(new.participant_ids)); insert into public.medha_communications_user_chats(user_id,conversation_id,display_name,last_message,updated_at) select participant,new.id,new.title,new.last_message,new.updated_at from unnest(new.participant_ids) participant on conflict (user_id,conversation_id) do update set display_name=excluded.display_name,last_message=excluded.last_message,updated_at=excluded.updated_at; return new; end; $$;
drop trigger if exists medha_communications_sync_user_chats_trigger on public.medha_communications_conversations;
create trigger medha_communications_sync_user_chats_trigger after insert or update of participant_ids,last_message,updated_at on public.medha_communications_conversations for each row execute function public.medha_communications_sync_user_chats();
insert into public.medha_communications_user_chats(user_id,conversation_id,display_name,last_message,updated_at) select participant,c.id,c.title,c.last_message,c.updated_at from public.medha_communications_conversations c cross join lateral unnest(c.participant_ids) participant on conflict (user_id,conversation_id) do update set display_name=excluded.display_name,last_message=excluded.last_message,updated_at=excluded.updated_at;
create or replace function public.medha_communications_message_notification_trigger() returns trigger language plpgsql security definer set search_path = public, extensions as $$ declare recipient text; recipients text[]; sender_name text; normalized_words text[]; notification_text text; begin select participant_ids into recipients from public.medha_communications_conversations where id=new.conversation_id; select coalesce(full_name,'New message') into sender_name from public.users where id=new.sender_id limit 1; normalized_words:=regexp_split_to_array(regexp_replace(trim(new.body),'\s+',' ','g'),' '); notification_text:=array_to_string(normalized_words[1:10],' ')||case when coalesce(array_length(normalized_words,1),0)>10 then ' …' else '' end; foreach recipient in array coalesce(recipients,array[]::text[]) loop if recipient is not null and recipient<>'' and recipient<>new.sender_id then insert into public.medha_notification_events (activity_id,recipient_uid,event_type,notification_title,notification_body,target_url,tag,dedupe_key) values (new.id,recipient,'space_message',sender_name,coalesce(notification_text,'New message'),'https://medha-hub.web.app/','space-message-'||new.id::text||'-'||recipient,'space-message-'||new.id::text||'-'||recipient) on conflict (dedupe_key) where dedupe_key is not null do nothing; end if; end loop; perform net.http_post(url := 'https://medha-activities.vercel.app/api/process-notifications', headers := jsonb_build_object('Content-Type','application/json'), body := jsonb_build_object('source','space-message','message_id',new.id)); return new; end; $$;
drop trigger if exists medha_communications_message_notifications on public.medha_communications_messages;
create trigger medha_communications_message_notifications after insert on public.medha_communications_messages for each row execute function public.medha_communications_message_notification_trigger();
drop policy if exists "communications conversations all" on public.medha_communications_conversations;
create policy "communications conversations all" on public.medha_communications_conversations for all using (true) with check (true);
drop policy if exists "communications messages all" on public.medha_communications_messages;
create policy "communications messages all" on public.medha_communications_messages for all using (true) with check (true);
