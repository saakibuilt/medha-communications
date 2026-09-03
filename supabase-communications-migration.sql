-- ============================================================
-- Medha Space — conversation integrity migration.
-- SAFE TO RUN NOW. Does not change any RLS policy.
-- Run this BEFORE deploying the new app.js.
--
-- Merges the duplicate direct threads created by the old
-- random-UUID client onto one deterministic id per pair, so
-- both people finally read and write the same conversation.
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


-- ---------- one direct conversation per pair ----------
-- Every direct thread moves to the deterministic id dm_<lowId>__<highId>,
-- and duplicates for the same pair are merged into it. Messages and the
-- per-user chat list follow the rename.
--
-- user_chats.conversation_id references conversations(id). Recreate that FK
-- as ON UPDATE CASCADE first so the rename carries through instead of failing.
alter table public.medha_communications_user_chats
  drop constraint if exists medha_communications_user_chats_conversation_id_fkey;
alter table public.medha_communications_user_chats
  add constraint medha_communications_user_chats_conversation_id_fkey
  foreign key (conversation_id) references public.medha_communications_conversations(id)
  on delete cascade on update cascade;

alter table public.medha_communications_messages
  drop constraint if exists medha_communications_messages_conversation_id_fkey;
alter table public.medha_communications_messages
  add constraint medha_communications_messages_conversation_id_fkey
  foreign key (conversation_id) references public.medha_communications_conversations(id)
  on delete cascade on update cascade;

do $$
declare grp record; canonical text; survivor text; other text;
begin
  for grp in
    select (select array_agg(p order by p) from unnest(participant_ids) p) as pair,
           array_agg(id order by created_at) as ids
    from public.medha_communications_conversations
    where kind='direct' and array_length(participant_ids,1)=2
    group by 1
  loop
    canonical := 'dm_'||grp.pair[1]||'__'||grp.pair[2];

    -- pick the row that will carry the canonical id
    if canonical = any(grp.ids) then
      survivor := canonical;
    else
      survivor := grp.ids[1];
      update public.medha_communications_conversations
        set id = canonical where id = survivor;   -- cascades to children
      survivor := canonical;
    end if;

    -- fold every other row for this pair into the survivor
    foreach other in array grp.ids loop
      if other <> survivor and other <> canonical then
        update public.medha_communications_messages
          set conversation_id = survivor where conversation_id = other;
        delete from public.medha_communications_user_chats where conversation_id = other;
        delete from public.medha_communications_conversations where id = other;
      end if;
    end loop;

    -- keep the newest preview/timestamp on the survivor
    update public.medha_communications_conversations c
      set last_message = coalesce(m.body, c.last_message),
          updated_at   = coalesce(m.created_at, c.updated_at)
      from (select body, created_at from public.medha_communications_messages
            where conversation_id = survivor order by created_at desc limit 1) m
      where c.id = survivor;
  end loop;
end $$;

-- Rebuild the per-user chat list from the merged conversations.
delete from public.medha_communications_user_chats uc
  where not exists (select 1 from public.medha_communications_conversations c
                    where c.id = uc.conversation_id and uc.user_id = any(c.participant_ids));
insert into public.medha_communications_user_chats(user_id,conversation_id,display_name,last_message,updated_at)
  select participant, c.id, c.title, c.last_message, c.updated_at
  from public.medha_communications_conversations c
  cross join lateral unnest(c.participant_ids) participant
  on conflict (user_id,conversation_id) do update
    set display_name=excluded.display_name,
        last_message=excluded.last_message,
        updated_at=excluded.updated_at;

-- Keep participant_ids canonical so the pair index is reliable.
create or replace function public.medha_communications_sort_participants() returns trigger
language plpgsql as $$
begin
  select array_agg(distinct p order by p) into new.participant_ids
  from unnest(coalesce(new.participant_ids,'{}')) p;
  return new;
end; $$;
drop trigger if exists medha_communications_sort_participants_trigger on public.medha_communications_conversations;
create trigger medha_communications_sort_participants_trigger
  before insert or update of participant_ids on public.medha_communications_conversations
  for each row execute function public.medha_communications_sort_participants();

create unique index if not exists medha_communications_direct_pair_idx
  on public.medha_communications_conversations (participant_ids)
  where kind='direct';

create index if not exists medha_communications_messages_conv_created_idx
  on public.medha_communications_messages(conversation_id, created_at, id);


