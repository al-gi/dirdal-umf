// Sender varsel som alt ligg i push_queue, og legg inn påminning dagen før samling.
// POST er berre for service role (planlagd køyring i Supabase). GET gjev den offentlege
// VAPID-nøkkelen til ein innlogga brukar. Ingen varseltekst kjem frå klienten.
//
// Verify JWT må vere PÅ. Porten sjekkar signaturen. Funksjonen les berre role-claimet
// og godtek role=service_role, i tillegg til nøkkelen i SUPABASE_SERVICE_ROLE_KEY og
// verdiane i SUPABASE_SECRET_KEYS. anon og authenticated blir avviste. Slår du av
// Verify JWT, kan nokon sende eit usignert JWT med role=service_role.
//
// Hemmelegheiter: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… eller https://…).
// SUPABASE_SERVICE_ROLE_KEY blir sett av Supabase og skal aldri til nettlesaren.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { deliverQueueItem, reminderItems, requestKind, validVapidSubject } from './logic.mjs';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const kind = requestKind(
    req.method,
    req.headers.get('Authorization'),
    serviceKey,
    Deno.env.get('SUPABASE_SECRET_KEYS') || '',
  );
  if (kind === 'options') return new Response(null, { headers: cors });
  if (kind === 'method') return json({ error: 'method' }, 405);
  if (kind === 'forbidden') return json({ error: 'forbidden' }, 403);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const publicKey = (Deno.env.get('VAPID_PUBLIC_KEY') || '').trim();
  const privateKey = (Deno.env.get('VAPID_PRIVATE_KEY') || '').trim();
  const subject = (Deno.env.get('VAPID_SUBJECT') || '').trim();
  const configured = !!(publicKey && privateKey && validVapidSubject(subject));

  if (kind === 'public-key') {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
      auth: { persistSession: false },
    });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data.user) return json({ error: 'unauthorized' }, 401);
    return json({ configured, publicKey: configured ? publicKey : null });
  }

  if (!configured) return json({ configured: false, sent: 0, reason: 'missing_vapid' });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const now = new Date();

  const { data: meetings, error: meetingError } = await admin.from('meetings').select('id,date,status');
  if (meetingError) return json({ error: 'meetings' }, 500);
  for (const item of reminderItems(meetings || [], now)) {
    await admin.from('push_queue').upsert(
      { kind: item.kind, dedupe_key: item.dedupeKey, actor: null },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    );
  }

  const { data: queue, error: queueError } = await admin.from('push_queue')
    .select('id,kind,dedupe_key,actor,attempts')
    .is('sent_at', null)
    .lt('attempts', 5)
    .order('id')
    .limit(50);
  if (queueError) return json({ error: 'queue' }, 500);

  const [{ data: subs }, { data: prefs }] = await Promise.all([
    admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth'),
    admin.from('push_prefs').select('user_id,enabled,meeting,wiki,forum,site'),
  ]);

  let sent = 0;
  for (const row of queue || []) {
    const { data: doneRows } = await admin.from('push_delivery').select('subscription_id').eq('dedupe_key', row.dedupe_key);
    const already = new Set((doneRows || []).map((d: { subscription_id: string }) => d.subscription_id));
    const result = await deliverQueueItem({
      row,
      subscriptions: subs || [],
      prefs: prefs || [],
      already,
      send: async (sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: unknown) => {
        const claim = await admin.from('push_delivery').insert({ dedupe_key: row.dedupe_key, subscription_id: sub.id });
        if (claim.error) {
          if (claim.error.code === '23505') return;
          throw claim.error;
        }
        try {
          const ttl = row.kind === 'meeting_reminder' ? 12 * 3600 : 6 * 3600;
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
            { TTL: ttl, urgency: 'normal' },
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code !== 404 && code !== 410) {
            await admin.from('push_delivery').delete().eq('dedupe_key', row.dedupe_key).eq('subscription_id', sub.id);
          }
          throw err;
        }
      },
    });
    for (const item of result.results) {
      if (item.ok || item.gone) {
        await admin.from('push_delivery').upsert(
          { dedupe_key: row.dedupe_key, subscription_id: item.id },
          { onConflict: 'dedupe_key,subscription_id', ignoreDuplicates: true },
        );
        if (item.ok) sent += 1;
      }
      if (item.gone) await admin.from('push_subscriptions').delete().eq('id', item.id);
    }
    if (result.done) await admin.from('push_queue').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
    else await admin.from('push_queue').update({ attempts: (row.attempts || 0) + 1 }).eq('id', row.id);
  }

  return json({ configured: true, sent, queued: (queue || []).length });
});
