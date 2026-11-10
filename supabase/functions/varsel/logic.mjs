// Rein logikk for varsel. Ingen nettverk, ingen nøklar.
// Påminning blir send dagen før, kl. 18 Europe/Oslo (oppfølging kl. 19 om køyringa kl. 18 ikkje gjekk).
// Tidspunktet blir rekna i tidssona, så sommar- og vintertid ikkje krev eit fast UTC-klokkeslett.

export const SEND_HOUR = 18;
export const CATCHUP_HOUR = 19;
export const OSLO = 'Europe/Oslo';

const COPY = {
  group: ['Dirdal UMF', 'Det er ein ny beskjed på sida.', '#oversikt'],
  wiki: ['Dirdal UMF', 'Ny side på wikien.', '#wiki'],
  forum: ['Dirdal UMF', 'Nytt innlegg i forumet.', '#forum'],
  forum_reply: ['Dirdal UMF', 'Nytt svar i forumet.', '#forum'],
  meeting_new: ['Dirdal UMF', 'Ny samling er lagd inn.', '#oversikt'],
  meeting_changed: ['Dirdal UMF', 'Neste samling er endra.', '#oversikt'],
  meeting_cancelled: ['Dirdal UMF', 'Ei samling er avlyst.', '#oversikt'],
  meeting_reminder: ['Dirdal UMF', 'Påminning: samling i morgon.', '#oversikt'],
};

export function osloParts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: OSLO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    date: parts.year + '-' + parts.month + '-' + parts.day,
  };
}

export function osloToday(date) {
  return osloParts(date).date;
}

export function osloTomorrow(date) {
  const p = osloParts(date);
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
  utc.setUTCDate(utc.getUTCDate() + 1);
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return utc.getUTCFullYear() + '-' + m + '-' + d;
}

export function inReminderWindow(date) {
  const hour = osloParts(date).hour;
  return hour === SEND_HOUR || hour === CATCHUP_HOUR;
}

export function categoryOf(kind) {
  if (kind === 'wiki') return 'wiki';
  if (kind === 'forum' || kind === 'forum_reply') return 'forum';
  if (kind === 'group') return 'site';
  if (typeof kind === 'string' && kind.startsWith('meeting')) return 'meeting';
  return null;
}

export function payloadFor(kind, tag) {
  const row = COPY[kind];
  if (!row) return null;
  const safeTag = String(tag || kind).replace(/[^\w:.-]/g, '').slice(0, 64) || kind;
  return { title: row[0], body: row[1], hash: row[2], tag: safeTag };
}

export function recipients(subscriptions, prefs, kind, actor) {
  const cat = categoryOf(kind);
  if (!cat) return [];
  const map = prefs instanceof Map ? prefs : new Map((prefs || []).map((p) => [p.user_id, p]));
  return (subscriptions || []).filter((s) => {
    const pref = map.get(s.user_id);
    if (!pref || !pref.enabled || !pref[cat]) return false;
    if (actor && s.user_id === actor) return false;
    return true;
  });
}

export function meetingChangeKind(before, after, today) {
  if (!after || !after.date || after.date < today) return null;
  const status = after.status || 'planned';
  if (!before) return status === 'planned' ? 'meeting_new' : null;
  const prev = before.status || 'planned';
  if (status === 'cancelled' && prev !== 'cancelled') return 'meeting_cancelled';
  if (status !== 'planned') return null;
  const changed = before.date !== after.date
    || (before.time || '') !== (after.time || '')
    || prev !== status
    || (before.host || '') !== (after.host || '');
  return changed ? 'meeting_changed' : null;
}

export function meetingDedupeKey(kind, meeting) {
  if (!meeting || !meeting.id) return null;
  if (kind === 'meeting_new') return 'meeting-new:' + meeting.id;
  if (kind === 'meeting_cancelled') return 'meeting-cancel:' + meeting.id + ':' + meeting.date;
  if (kind === 'meeting_changed') return 'meeting-changed:' + meeting.id + ':' + meeting.date + ':' + (meeting.time || '') + ':' + (meeting.status || 'planned');
  if (kind === 'meeting_reminder') return 'meeting-eve:' + meeting.id + ':' + meeting.date;
  return null;
}

export function groupContentChanged(before, after) {
  if (!before || !after) return false;
  return ['name', 'when_text', 'about', 'notice'].some((key) => (before[key] || '') !== (after[key] || ''));
}

export function reminderItems(meetings, now) {
  if (!inReminderWindow(now)) return [];
  const tomorrow = osloTomorrow(now);
  const out = [];
  for (const meeting of meetings || []) {
    if (!meeting || meeting.date !== tomorrow) continue;
    if (meeting.status && meeting.status !== 'planned') continue;
    const dedupeKey = meetingDedupeKey('meeting_reminder', meeting);
    if (dedupeKey) out.push({ kind: 'meeting_reminder', dedupeKey, actor: null });
  }
  return out;
}

export async function deliverQueueItem({ row, subscriptions, prefs, already, send }) {
  const payload = payloadFor(row.kind, row.dedupe_key);
  if (!payload) return { done: true, results: [] };
  const targets = recipients(subscriptions, prefs, row.kind, row.actor);
  const seen = already || new Set();
  const results = [];
  let pending = false;
  for (const sub of targets) {
    if (seen.has(sub.id)) continue;
    try {
      await send(sub, payload);
      results.push({ id: sub.id, ok: true });
    } catch (err) {
      const code = err && (err.statusCode || err.status);
      if (code === 404 || code === 410) results.push({ id: sub.id, gone: true });
      else pending = true;
    }
  }
  return { done: !pending, results };
}

export function requestKind(method, authorization, serviceRoleKey) {
  if (method === 'OPTIONS') return 'options';
  if (method === 'GET') return 'public-key';
  if (method === 'POST') {
    const bearer = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (serviceRoleKey && bearer && bearer === serviceRoleKey) return 'drain';
    return 'forbidden';
  }
  return 'method';
}
