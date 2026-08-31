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
  created_at timestamptz not null default now()
);
create index if not exists medha_communications_messages_conversation_idx on public.medha_communications_messages(conversation_id, created_at);
alter table public.medha_communications_conversations enable row level security;
alter table public.medha_communications_messages enable row level security;
drop policy if exists "communications conversations all" on public.medha_communications_conversations;
create policy "communications conversations all" on public.medha_communications_conversations for all using (true) with check (true);
drop policy if exists "communications messages all" on public.medha_communications_messages;
create policy "communications messages all" on public.medha_communications_messages for all using (true) with check (true);
