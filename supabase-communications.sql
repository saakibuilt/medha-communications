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
drop policy if exists "communications conversations all" on public.medha_communications_conversations;
create policy "communications conversations all" on public.medha_communications_conversations for all using (true) with check (true);
drop policy if exists "communications messages all" on public.medha_communications_messages;
create policy "communications messages all" on public.medha_communications_messages for all using (true) with check (true);
