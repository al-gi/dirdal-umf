-- Oppdatering 8: bønneemne. Medlemene legg inn bønneemne, merkjer «Eg ber for dette»,
-- og den som skreiv emnet kan merkje det som svara.
-- Køyr i Supabase → SQL Editor. Trygt å køyre fleire gonger.

create table if not exists public.prayers (
  id uuid primary key default gen_random_uuid(),
  body text not null check (length(body) between 1 and 2000),
  author uuid references public.profiles(id) on delete cascade default auth.uid(),
  answered_at timestamptz,
  answer text check (length(answer) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.prayer_marks (
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (prayer_id, user_id)
);

alter table public.prayers enable row level security;
alter table public.prayer_marks enable row level security;

drop policy if exists "les bønneemne"         on public.prayers;
drop policy if exists "legg til bønneemne"    on public.prayers;
drop policy if exists "endre eige bønneemne"  on public.prayers;
drop policy if exists "slett eige bønneemne"  on public.prayers;
create policy "les bønneemne"        on public.prayers for select to authenticated using (true);
create policy "legg til bønneemne"   on public.prayers for insert to authenticated with check (author = auth.uid());
create policy "endre eige bønneemne" on public.prayers for update to authenticated using (author = auth.uid()) with check (author = auth.uid());
create policy "slett eige bønneemne" on public.prayers for delete to authenticated using (author = auth.uid());

drop policy if exists "les forbøn"   on public.prayer_marks;
drop policy if exists "ber for"      on public.prayer_marks;
drop policy if exists "sluttar å be" on public.prayer_marks;
create policy "les forbøn"   on public.prayer_marks for select to authenticated using (true);
create policy "ber for"      on public.prayer_marks for insert to authenticated with check (user_id = auth.uid());
create policy "sluttar å be" on public.prayer_marks for delete to authenticated using (user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table public.prayers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.prayer_marks; exception when duplicate_object then null; end $$;
