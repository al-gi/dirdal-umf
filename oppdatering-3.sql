-- Oppdatering 3: påmelding, samtale/forslag om ny dag per samling, og kalenderabonnement.
-- Køyr i Supabase → SQL Editor. Trygt å køyre fleire gonger.

-- Påmelding: kvar person svarar for seg sjølv
create table if not exists public.attendance (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status text not null check (status in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

-- Kommentarar og datoforslag på ei samling
create table if not exists public.meeting_comments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  author uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null default '' check (length(body) <= 4000),
  proposed_date date,
  proposed_time text,
  created_at timestamptz not null default now()
);

-- «Passar for meg» på eit datoforslag
create table if not exists public.proposal_votes (
  comment_id uuid not null references public.meeting_comments(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  primary key (comment_id, user_id)
);

alter table public.attendance       enable row level security;
alter table public.meeting_comments enable row level security;
alter table public.proposal_votes   enable row level security;

drop policy if exists "les påmelding"     on public.attendance;
drop policy if exists "eiga påmelding"    on public.attendance;
drop policy if exists "endre påmelding"   on public.attendance;
drop policy if exists "slett påmelding"   on public.attendance;
create policy "les påmelding"   on public.attendance for select to authenticated using (true);
create policy "eiga påmelding"  on public.attendance for insert to authenticated with check (user_id = auth.uid());
create policy "endre påmelding" on public.attendance for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "slett påmelding" on public.attendance for delete to authenticated using (user_id = auth.uid());

drop policy if exists "les kommentarar"    on public.meeting_comments;
drop policy if exists "skriv kommentar"    on public.meeting_comments;
drop policy if exists "slett eigen kommentar" on public.meeting_comments;
create policy "les kommentarar"       on public.meeting_comments for select to authenticated using (true);
create policy "skriv kommentar"       on public.meeting_comments for insert to authenticated with check (author = auth.uid());
create policy "slett eigen kommentar" on public.meeting_comments for delete to authenticated using (author = auth.uid());

drop policy if exists "les stemmer"   on public.proposal_votes;
drop policy if exists "eiga stemme"   on public.proposal_votes;
drop policy if exists "fjern stemme"  on public.proposal_votes;
create policy "les stemmer"  on public.proposal_votes for select to authenticated using (true);
create policy "eiga stemme"  on public.proposal_votes for insert to authenticated with check (user_id = auth.uid());
create policy "fjern stemme" on public.proposal_votes for delete to authenticated using (user_id = auth.uid());

-- Hemmeleg nøkkel i kalenderlenkja (berre innlogga medlemer ser han)
alter table public.group_info add column if not exists calendar_token text;
update public.group_info set calendar_token = replace(gen_random_uuid()::text, '-', '') where id = 1 and calendar_token is null;

do $$ begin alter publication supabase_realtime add table public.attendance;       exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.meeting_comments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.proposal_votes;   exception when duplicate_object then null; end $$;
