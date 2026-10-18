-- Oppdatering 4: versbank (vers medlemene likar, brukt som «dagens vers»).
-- Køyr i Supabase → SQL Editor. Trygt å køyre fleire gonger.

create table if not exists public.verses (
  id uuid primary key default gen_random_uuid(),
  book text not null,
  chapter int not null,
  verses text not null default '',
  body text not null default '' check (length(body) <= 2000),
  comment text check (length(comment) <= 1000),
  added_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.verses enable row level security;

drop policy if exists "les vers"        on public.verses;
drop policy if exists "legg til vers"   on public.verses;
drop policy if exists "endre eige vers" on public.verses;
drop policy if exists "slett eige vers" on public.verses;
create policy "les vers"        on public.verses for select to authenticated using (true);
create policy "legg til vers"   on public.verses for insert to authenticated with check (added_by = auth.uid());
create policy "endre eige vers" on public.verses for update to authenticated using (added_by = auth.uid()) with check (added_by = auth.uid());
create policy "slett eige vers" on public.verses for delete to authenticated using (added_by = auth.uid());

do $$ begin alter publication supabase_realtime add table public.verses; exception when duplicate_object then null; end $$;
