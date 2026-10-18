-- Oppdatering 5: samlingar kan vere planlagde, utsette (ny dato ikkje bestemt) eller avlyste.
-- Køyr i Supabase → SQL Editor. Trygt å køyre fleire gonger.

alter table public.meetings add column if not exists status text not null default 'planned';
alter table public.meetings add column if not exists status_note text;

do $$ begin
  alter table public.meetings add constraint meetings_status_check check (status in ('planned', 'postponed', 'cancelled'));
exception when duplicate_object then null; end $$;
