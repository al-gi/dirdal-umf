-- Dirdal Unge Mannsforening – databaseoppsett for Supabase.
-- Lim inn heile fila i Supabase → SQL Editor → Run.
-- BYT UT gruppekoden nedanfor før du køyrer (sjå linja med 'byt-meg').

-- ---------- Gruppekode (berre databasen kan lese han) ----------
create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to supabase_auth_admin;

create table if not exists private.settings (
  id int primary key default 1 check (id = 1),
  invite_code text not null
);
insert into private.settings (id, invite_code) values (1, 'byt-meg')
  on conflict (id) do update set invite_code = excluded.invite_code;

-- ---------- Profilar ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);

-- Ny brukar: sjekk gruppekoden og lag profil. Feil kode stoppar registreringa.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')))
     <> lower(trim((select invite_code from private.settings where id = 1))) then
    raise exception 'Feil gruppekode';
  end if;
  insert into public.profiles (id, name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- Gruppa ----------
create table if not exists public.group_info (
  id int primary key default 1 check (id = 1),
  name text,
  when_text text,
  about text,
  updated_at timestamptz not null default now()
);
insert into public.group_info (id, name) values (1, 'Dirdal Unge Mannsforening') on conflict (id) do nothing;

-- ---------- Samlingar og lesing ----------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time text,
  book text,          -- bokkode, t.d. 'JHN' (sjå bible.js)
  ch_from int,
  ch_to int,
  verses text,        -- valfritt, t.d. '1–21'
  topic text,         -- tema eller anna lesestoff
  host text,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ---------- Forum ----------
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 10000),
  author uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);

create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  body text not null check (length(body) between 1 and 10000),
  author uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function private.bump_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.threads set last_at = new.created_at where id = new.thread_id;
  return new;
end $$;

drop trigger if exists on_reply_created on public.replies;
create trigger on_reply_created after insert on public.replies
  for each row execute function private.bump_thread();

-- ---------- Medlemsliste (adresser og kontaktinfo, berre for innlogga) ----------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  address text,
  postcode text,
  place text,
  phone text,
  email text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Tilgang: berre innlogga medlemer ----------
alter table public.members    enable row level security;
create policy "medlemer les medlemsliste" on public.members for select to authenticated using (true);
create policy "medlemer legg til medlem"  on public.members for insert to authenticated with check (true);
create policy "medlemer endrar medlem"    on public.members for update to authenticated using (true) with check (true);
create policy "medlemer slettar medlem"   on public.members for delete to authenticated using (true);

alter table public.profiles   enable row level security;
alter table public.group_info enable row level security;
alter table public.meetings   enable row level security;
alter table public.threads    enable row level security;
alter table public.replies    enable row level security;

create policy "medlemer les profilar"  on public.profiles for select to authenticated using (true);
create policy "endre eigen profil"     on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "medlemer les gruppa"    on public.group_info for select to authenticated using (true);
create policy "medlemer endrar gruppa" on public.group_info for update to authenticated using (true) with check (true);

create policy "medlemer les samlingar"    on public.meetings for select to authenticated using (true);
create policy "medlemer legg til samling" on public.meetings for insert to authenticated with check (true);
create policy "medlemer endrar samling"   on public.meetings for update to authenticated using (true) with check (true);
create policy "medlemer slettar samling"  on public.meetings for delete to authenticated using (true);

create policy "medlemer les tråder"   on public.threads for select to authenticated using (true);
create policy "skriv eigen tråd"      on public.threads for insert to authenticated with check (author = auth.uid());
create policy "endre eigen tråd"      on public.threads for update to authenticated using (author = auth.uid()) with check (author = auth.uid());
create policy "slett eigen tråd"      on public.threads for delete to authenticated using (author = auth.uid());

create policy "medlemer les svar"     on public.replies for select to authenticated using (true);
create policy "skriv eige svar"       on public.replies for insert to authenticated with check (author = auth.uid());
create policy "slett eige svar"       on public.replies for delete to authenticated using (author = auth.uid());

-- ---------- Sanntid: sida oppdaterer seg når andre skriv ----------
alter publication supabase_realtime add table
  public.meetings, public.threads, public.replies, public.group_info, public.profiles, public.members;
