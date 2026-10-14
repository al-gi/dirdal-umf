-- Oppdatering 2: registrere lesing utan samling, wiki med taggar, «Anna info» og medlemstekst.
-- Køyr i Supabase → SQL Editor etter schema.sql. Trygt å køyre fleire gonger.

alter table public.group_info add column if not exists notice text;
alter table public.members    add column if not exists bio text;

-- Lesing registrert direkte (t.d. det de las før sida fanst)
create table if not exists public.readings (
  id uuid primary key default gen_random_uuid(),
  book text not null,
  ch_from int not null,
  ch_to int not null,
  read_on date,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Wiki
create table if not exists public.wiki (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 50000),
  tags text[] not null default '{}',
  author uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.readings enable row level security;
alter table public.wiki     enable row level security;

drop policy if exists "medlemer les lesing"      on public.readings;
drop policy if exists "medlemer legg til lesing" on public.readings;
drop policy if exists "medlemer endrar lesing"   on public.readings;
drop policy if exists "medlemer slettar lesing"  on public.readings;
create policy "medlemer les lesing"      on public.readings for select to authenticated using (true);
create policy "medlemer legg til lesing" on public.readings for insert to authenticated with check (true);
create policy "medlemer endrar lesing"   on public.readings for update to authenticated using (true) with check (true);
create policy "medlemer slettar lesing"  on public.readings for delete to authenticated using (true);

drop policy if exists "medlemer les wiki"       on public.wiki;
drop policy if exists "medlemer skriv wiki"     on public.wiki;
drop policy if exists "medlemer endrar wiki"    on public.wiki;
drop policy if exists "medlemer slettar wiki"   on public.wiki;
create policy "medlemer les wiki"       on public.wiki for select to authenticated using (true);
create policy "medlemer skriv wiki"     on public.wiki for insert to authenticated with check (true);
create policy "medlemer endrar wiki"    on public.wiki for update to authenticated using (true) with check (true);
create policy "medlemer slettar wiki"   on public.wiki for delete to authenticated using (true);

do $$ begin
  alter publication supabase_realtime add table public.readings;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.wiki;
exception when duplicate_object then null; end $$;
