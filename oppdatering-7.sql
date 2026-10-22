-- Oppdatering 7: tel kor ofte medlemene er innom sida. Berre administratorar ser tala.
-- Køyr i Supabase → SQL Editor. Trygt å køyre fleire gonger.

-- Administratorar (blir lagde til med SQL, ikkje frå sida)
create table if not exists public.admins (
  user_id uuid primary key references public.profiles(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "sjå om eg er admin" on public.admins;
create policy "sjå om eg er admin" on public.admins for select to authenticated using (user_id = auth.uid());

-- Besøk per person per dag. Ingen tilgangsreglar: tabellen blir berre nådd gjennom funksjonane under.
create table if not exists public.visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default (now() at time zone 'Europe/Oslo')::date,
  count int not null default 1,
  last_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.visits enable row level security;

-- Registrer eit besøk for den som er innlogga
create or replace function public.log_visit() returns void
language sql security definer set search_path = '' as $$
  insert into public.visits (user_id) values (auth.uid())
  on conflict (user_id, day) do update set count = public.visits.count + 1, last_at = now();
$$;
revoke execute on function public.log_visit() from public, anon;
grant execute on function public.log_visit() to authenticated;

-- Oversikt, berre for administratorar (andre får ingen rader)
create or replace function public.visit_stats()
returns table (user_id uuid, name text, total int, last_30 int, days int, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name,
         coalesce(sum(v.count), 0)::int,
         coalesce(sum(v.count) filter (where v.day > (now() at time zone 'Europe/Oslo')::date - 30), 0)::int,
         count(v.day)::int,
         max(v.last_at)
  from public.profiles p
  left join public.visits v on v.user_id = p.id
  where exists (select 1 from public.admins a where a.user_id = auth.uid())
  group by p.id, p.name
  order by max(v.last_at) desc nulls last;
$$;
revoke execute on function public.visit_stats() from public, anon;
grant execute on function public.visit_stats() to authenticated;

-- Formannen er administrator (alle brukarane hans, både e-post og fornamn)
insert into public.admins (user_id)
  select id from public.profiles where name ilike 'alexander%'
  on conflict do nothing;
