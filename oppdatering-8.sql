-- Oppdatering 8: valfrie push-varsel per innlogga brukar.
-- Køyr i Supabase → SQL Editor etter dei tidlegare oppdateringane. Trygt å køyre fleire gonger.
-- Denne fila legg ikkje inn nøklar og sender ingen varsel aleine.
-- Utsending skjer i edge-funksjonen «varsel» (sjå README). Planlagd køyring: kvart minutt.
-- Påminning blir lagd i køen berre kl. 18 Europe/Oslo dagen før samlinga (oppfølging kl. 19).
-- Tidssona blir rekna i funksjonen, så sommar- og vintertid ikkje er eit fast UTC-klokkeslett.
--
-- Varselteksten blir laga på serveren ut frå typen. Køen lagrar ikkje innlegg, notat,
-- adresser eller kalendernøkkel. Abonnement høyrer til auth.uid(), ikkje eit delt gruppeakonto.
-- Felles passord betyr likevel at den som kan namnet og passordet kan logge inn som den brukaren.

-- Kø. Ingen tilgangsreglar: berre service role (edge-funksjonen) og trigger-funksjonane når ho.
create table if not exists public.push_queue (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'group', 'wiki', 'forum', 'forum_reply',
    'meeting_new', 'meeting_changed', 'meeting_cancelled', 'meeting_reminder'
  )),
  dedupe_key text not null unique,
  actor uuid references public.profiles(id) on delete set null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.push_queue enable row level security;
revoke all on public.push_queue from anon, authenticated;

-- Kven som alt har fått eit gitt varsel. Stoppar dobbelsending ved retry.
create table if not exists public.push_delivery (
  dedupe_key text not null,
  subscription_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (dedupe_key, subscription_id)
);
alter table public.push_delivery enable row level security;
revoke all on public.push_delivery from anon, authenticated;

create table if not exists public.push_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  meeting boolean not null default true,
  wiki boolean not null default true,
  forum boolean not null default true,
  site boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.push_prefs enable row level security;
revoke all on public.push_prefs from anon, authenticated;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 2000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 200),
  label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create index if not exists push_queue_unsent on public.push_queue (id) where sent_at is null;
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

create or replace function private.enqueue_push(p_kind text, p_key text, p_actor uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_queue (kind, dedupe_key, actor)
  values (p_kind, p_key, p_actor)
  on conflict (dedupe_key) do nothing;
end $$;
revoke all on function private.enqueue_push(text, text, uuid) from public, anon, authenticated;

-- Gruppa: namn, tid, om-tekst og beskjed. Ikkje kalendernøkkelen.
create or replace function private.push_on_group()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name
     or new.when_text is distinct from old.when_text
     or new.about is distinct from old.about
     or new.notice is distinct from old.notice then
    perform private.enqueue_push(
      'group',
      'group:' || md5(concat_ws(E'\n', coalesce(new.name, ''), coalesce(new.when_text, ''), coalesce(new.about, ''), coalesce(new.notice, ''))),
      null
    );
  end if;
  return new;
end $$;
drop trigger if exists push_on_group on public.group_info;
create trigger push_on_group after update on public.group_info
  for each row execute function private.push_on_group();

create or replace function private.push_on_wiki()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_push('wiki', 'wiki:' || new.id::text, new.author);
  return new;
end $$;
drop trigger if exists push_on_wiki on public.wiki;
create trigger push_on_wiki after insert on public.wiki
  for each row execute function private.push_on_wiki();

create or replace function private.push_on_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_push('forum', 'thread:' || new.id::text, new.author);
  return new;
end $$;
drop trigger if exists push_on_thread on public.threads;
create trigger push_on_thread after insert on public.threads
  for each row execute function private.push_on_thread();

create or replace function private.push_on_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_push('forum_reply', 'reply:' || new.id::text, new.author);
  return new;
end $$;
drop trigger if exists push_on_reply on public.replies;
create trigger push_on_reply after insert on public.replies
  for each row execute function private.push_on_reply();

-- Samling: ny, endra dato/tid/stad/status, eller avlyst. Ikkje notat eller tekstendring.
-- Utsett samling utan ny dato gir ikkje varsel. Påminning dagen før blir lagd av edge-funksjonen.
create or replace function private.push_on_meeting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := (timezone('Europe/Oslo', now()))::date;
  status text := coalesce(new.status, 'planned');
  prev text := case when tg_op = 'UPDATE' then coalesce(old.status, 'planned') else '' end;
begin
  if new.date < today then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if status = 'planned' then
      perform private.enqueue_push('meeting_new', 'meeting-new:' || new.id::text, new.created_by);
    end if;
    return new;
  end if;
  if status = 'cancelled' and prev <> 'cancelled' then
    perform private.enqueue_push('meeting_cancelled', 'meeting-cancel:' || new.id::text || ':' || new.date::text, null);
    return new;
  end if;
  if status = 'planned' and (
       new.date is distinct from old.date
       or new.time is distinct from old.time
       or new.status is distinct from old.status
       or new.host is distinct from old.host
     ) then
    perform private.enqueue_push(
      'meeting_changed',
      'meeting-changed:' || new.id::text || ':' || new.date::text || ':' || coalesce(new.time, '') || ':' || status,
      null
    );
  end if;
  return new;
end $$;
drop trigger if exists push_on_meeting on public.meetings;
create trigger push_on_meeting after insert or update on public.meetings
  for each row execute function private.push_on_meeting();

create or replace function public.my_push_settings()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  pref public.push_prefs%rowtype;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select * into pref from public.push_prefs where user_id = uid;
  return jsonb_build_object(
    'prefs', jsonb_build_object(
      'enabled', coalesce(pref.enabled, false),
      'meeting', coalesce(pref.meeting, true),
      'wiki', coalesce(pref.wiki, true),
      'forum', coalesce(pref.forum, true),
      'site', coalesce(pref.site, true)
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'label', s.label, 'created_at', s.created_at, 'endpoint', s.endpoint
      ) order by s.created_at desc)
      from public.push_subscriptions s where s.user_id = uid
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.my_push_settings() from public, anon;
grant execute on function public.my_push_settings() to authenticated;

create or replace function public.save_push_prefs(
  p_enabled boolean, p_meeting boolean, p_wiki boolean, p_forum boolean, p_site boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.push_prefs (user_id, enabled, meeting, wiki, forum, site)
  values (uid, coalesce(p_enabled, false), coalesce(p_meeting, true), coalesce(p_wiki, true), coalesce(p_forum, true), coalesce(p_site, true))
  on conflict (user_id) do update set
    enabled = excluded.enabled,
    meeting = excluded.meeting,
    wiki = excluded.wiki,
    forum = excluded.forum,
    site = excluded.site,
    updated_at = now();
end $$;
revoke all on function public.save_push_prefs(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.save_push_prefs(boolean, boolean, boolean, boolean, boolean) to authenticated;

-- Endpoint kan flyttast til den som er innlogga no, fordi nettlesaren nettopp gav oss abonnementet.
-- Ingen kan lese andre sine endpoint gjennom API-et.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_label text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  label text := left(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]]', '', 'g'), 40);
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_endpoint is null or length(p_endpoint) < 20 or length(p_endpoint) > 2000 then raise exception 'bad endpoint'; end if;
  if p_p256dh is null or length(p_p256dh) < 1 or length(p_p256dh) > 200 then raise exception 'bad key'; end if;
  if p_auth is null or length(p_auth) < 1 or length(p_auth) > 200 then raise exception 'bad key'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (uid, p_endpoint, p_p256dh, p_auth, label)
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    label = excluded.label,
    updated_at = now()
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from public.push_subscriptions where user_id = uid and endpoint = p_endpoint;
end $$;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

create or replace function public.delete_all_push_subscriptions()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from public.push_subscriptions where user_id = uid;
end $$;
revoke all on function public.delete_all_push_subscriptions() from public, anon;
grant execute on function public.delete_all_push_subscriptions() to authenticated;
