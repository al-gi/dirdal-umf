// Innlogging med fornamn for dei som har brukar med e-post.
// Finn e-postbrukaren ut frå fornamnet og loggar inn med passordet dei skriv. E-postadressa blir aldri sendt til nettlesaren.
// Supabase → Edge Functions → «namn-login», lim inn denne fila, og slå AV «Verify JWT».
//
// Svar: { session: { access_token, refresh_token } }  – innlogga
//       { match: false }                              – ingen e-postbrukar med dette fornamnet
//       { match: true, error: 'wrong_password' }      – fornamnet høyrer til ein e-postbrukar, men passordet var feil
//       { match: true, error: 'ambiguous' }           – fleire e-postbrukarar passar til namnet
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// Domenet fornamnsbrukarane får (sjå nameToEmail i app.js). Dei skal ikkje bli funne her.
const NAME_DOMAIN = '@al-gi.github.io';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let name = '', password = '';
  try { ({ name = '', password = '' } = await req.json()); } catch { return json({ error: 'bad_request' }, 400); }
  const typed = norm(String(name));
  if (!typed || !password || typed.length > 60) return json({ error: 'bad_request' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Profilnamn frå databasen, e-post frå innloggingssystemet
  const [{ data: profiles }, { data: list, error }] = await Promise.all([
    admin.from('profiles').select('id, name'),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (error) return json({ error: 'server' }, 500);
  const emailById = new Map(list.users.map((u) => [u.id, u.email ?? '']));

  // Treff når det skrivne namnet er starten på profilnamnet, heile ord («Olav» og «Olav Erik» passar «Olav Erik Dahl»)
  const hits = (profiles ?? []).filter((p) => {
    const full = norm(p.name ?? '');
    const email = emailById.get(p.id) ?? '';
    return email && !email.endsWith(NAME_DOMAIN) && (full === typed || full.startsWith(typed + ' '));
  });
  if (!hits.length) return json({ match: false });
  if (hits.length > 1) return json({ match: true, error: 'ambiguous' });

  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
  const { data, error: signInError } = await anon.auth.signInWithPassword({ email: emailById.get(hits[0].id)!, password });
  if (signInError || !data.session) return json({ match: true, error: 'wrong_password' });
  return json({ session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
});
