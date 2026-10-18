-- Oppdatering 6: eiga lesing (avkryssing i leseplanen), lagra på brukaren.
-- Berre personen sjølv kan lese, leggje til eller slette sine eigne rader.
-- Køyr i Supabase → SQL Editor. Trygt å køyre fleire gonger.

create table if not exists public.personal_reading (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  item text not null check (length(item) <= 60),   -- t.d. 'MAT.4.1-4.18' (bok.kapittel.vers-kapittel.vers)
  created_at timestamptz not null default now(),
  primary key (user_id, item)
);

alter table public.personal_reading enable row level security;

drop policy if exists "les eiga lesing"    on public.personal_reading;
drop policy if exists "lagre eiga lesing"  on public.personal_reading;
drop policy if exists "slett eiga lesing"  on public.personal_reading;
create policy "les eiga lesing"   on public.personal_reading for select to authenticated using (user_id = auth.uid());
create policy "lagre eiga lesing" on public.personal_reading for insert to authenticated with check (user_id = auth.uid());
create policy "slett eiga lesing" on public.personal_reading for delete to authenticated using (user_id = auth.uid());
