import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CATCHUP_HOUR, SEND_HOUR, categoryOf, deliverQueueItem, groupContentChanged, inReminderWindow,
  meetingChangeKind, meetingDedupeKey, osloToday, osloTomorrow, payloadFor, recipients, reminderItems,
  requestKind,
} from './logic.mjs';

const user = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';

test('påminning kl. 18 og 19 i Oslo, både vinter og sommar', () => {
  assert.equal(SEND_HOUR, 18);
  assert.equal(CATCHUP_HOUR, 19);
  // 15. januar 2026 17:00 UTC = 18:00 CET
  const winter = new Date('2026-01-15T17:00:00Z');
  assert.equal(osloToday(winter), '2026-01-15');
  assert.equal(osloTomorrow(winter), '2026-01-16');
  assert.equal(inReminderWindow(winter), true);
  assert.equal(inReminderWindow(new Date('2026-01-15T16:00:00Z')), false);
  // 15. juli 2026 16:00 UTC = 18:00 CEST
  const summer = new Date('2026-07-15T16:00:00Z');
  assert.equal(osloToday(summer), '2026-07-15');
  assert.equal(osloTomorrow(summer), '2026-07-16');
  assert.equal(inReminderWindow(summer), true);
  assert.equal(inReminderWindow(new Date('2026-07-15T17:00:00Z')), true);
  // Sommartid startar 29. mars 2026 kl. 01:00 UTC. 16:00 UTC er 18:00 CEST.
  const spring = new Date('2026-03-29T16:00:00Z');
  assert.equal(osloToday(spring), '2026-03-29');
  assert.equal(inReminderWindow(spring), true);
  assert.equal(osloTomorrow(spring), '2026-03-30');
  // Vintertid startar 25. oktober 2026 kl. 01:00 UTC. 17:00 UTC er 18:00 CET.
  const autumn = new Date('2026-10-25T17:00:00Z');
  assert.equal(osloToday(autumn), '2026-10-25');
  assert.equal(inReminderWindow(autumn), true);
  assert.equal(osloTomorrow(autumn), '2026-10-26');
});

test('påminning berre for planlagd samling i morgon', () => {
  const now = new Date('2026-01-15T17:30:00Z');
  const meetings = [
    { id: 'a', date: '2026-01-16', status: 'planned', host: 'Olav', note: 'hemmeleg' },
    { id: 'b', date: '2026-01-16', status: 'cancelled' },
    { id: 'c', date: '2026-01-16', status: 'postponed' },
    { id: 'd', date: '2026-01-17', status: 'planned' },
    { id: 'e', date: '2026-01-16' },
  ];
  const items = reminderItems(meetings, now);
  assert.deepEqual(items.map((i) => i.dedupeKey), ['meeting-eve:a:2026-01-16', 'meeting-eve:e:2026-01-16']);
  assert.equal(reminderItems(meetings, new Date('2026-01-15T12:00:00Z')).length, 0);
  const moved = meetingDedupeKey('meeting_reminder', { id: 'a', date: '2026-01-18' });
  assert.notEqual(moved, items[0].dedupeKey);
});

test('endring, avlysing og utsetting', () => {
  const today = '2026-01-15';
  const base = { id: 'a', date: '2026-01-16', time: '19:30', status: 'planned', host: 'Olav' };
  assert.equal(meetingChangeKind(null, base, today), 'meeting_new');
  assert.equal(meetingChangeKind(null, { ...base, date: '2026-01-01' }, today), null);
  assert.equal(meetingChangeKind(base, { ...base, note: 'nytt notat' }, today), null);
  assert.equal(meetingChangeKind(base, { ...base, time: '20:00' }, today), 'meeting_changed');
  assert.equal(meetingChangeKind(base, { ...base, status: 'cancelled' }, today), 'meeting_cancelled');
  assert.equal(meetingChangeKind(base, { ...base, status: 'postponed' }, today), null);
  assert.equal(meetingChangeKind({ ...base, status: 'cancelled' }, { ...base, status: 'cancelled', time: '20:00' }, today), null);
  const key = meetingDedupeKey('meeting_changed', { ...base, time: '20:00' });
  assert.equal(key, 'meeting-changed:a:2026-01-16:20:00:planned');
  assert.notEqual(key, meetingDedupeKey('meeting_changed', base));
});

test('gruppa: berre synleg innhald, ikkje kalendernøkkel', () => {
  const before = { name: 'Dirdal', when_text: 'torsdag', about: '', notice: '', calendar_token: 'a' };
  assert.equal(groupContentChanged(before, { ...before, calendar_token: 'b' }), false);
  assert.equal(groupContentChanged(before, { ...before, notice: 'Sommerfest' }), true);
});

test('låseskjermen får berre faste, korte tekstar', () => {
  for (const kind of Object.keys({ group: 1, wiki: 1, forum: 1, forum_reply: 1, meeting_new: 1, meeting_changed: 1, meeting_cancelled: 1, meeting_reminder: 1 })) {
    const payload = payloadFor(kind, kind + ':hemmelig-notat Olav Dirdalsvegen');
    const visible = payload.title + '\n' + payload.body;
    assert.equal(payload.title, 'Dirdal UMF');
    assert.match(payload.hash, /^#(oversikt|wiki|forum)$/);
    assert.equal(/Olav|Dirdalsvegen|hemmelig|notat|adresse/i.test(visible), false);
    assert.equal(/\s/.test(payload.tag), false);
  }
  assert.equal(payloadFor('ukjend', 'x'), null);
  assert.equal(payloadFor('wiki', 'wiki:1', 'LEKKASJE').body, payloadFor('wiki', 'wiki:1').body);
});

test('berre dei som har slått på kategorien, ikkje avsendaren', () => {
  const prefs = [
    { user_id: user, enabled: true, meeting: true, wiki: true, forum: false, site: true },
    { user_id: other, enabled: true, meeting: false, wiki: true, forum: true, site: false },
    { user_id: '33333333-3333-3333-3333-333333333333', enabled: false, meeting: true, wiki: true, forum: true, site: true },
  ];
  const subs = [
    { id: 's1', user_id: user },
    { id: 's2', user_id: other },
    { id: 's3', user_id: '33333333-3333-3333-3333-333333333333' },
  ];
  assert.deepEqual(recipients(subs, prefs, 'wiki', user).map((s) => s.id), ['s2']);
  assert.deepEqual(recipients(subs, prefs, 'forum', null).map((s) => s.id), ['s2']);
  assert.deepEqual(recipients(subs, prefs, 'meeting_reminder', null).map((s) => s.id), ['s1']);
  assert.deepEqual(recipients(subs, prefs, 'group', null).map((s) => s.id), ['s1']);
  assert.equal(categoryOf('forum_reply'), 'forum');
  assert.equal(categoryOf('oops'), null);
});

test('sending er idempotent og fjernar daude abonnement', async () => {
  const row = { kind: 'wiki', dedupe_key: 'wiki:1', actor: null };
  const subscriptions = [{ id: 's1', user_id: user }, { id: 's2', user_id: other }];
  const prefs = [
    { user_id: user, enabled: true, wiki: true },
    { user_id: other, enabled: true, wiki: true },
  ];
  const calls = [];
  const first = await deliverQueueItem({
    row, subscriptions, prefs, already: new Set(),
    send: async (sub) => {
      calls.push(sub.id);
      if (sub.id === 's2') { const err = new Error('gone'); err.statusCode = 410; throw err; }
    },
  });
  assert.deepEqual(calls, ['s1', 's2']);
  assert.equal(first.done, true);
  assert.equal(first.results.find((r) => r.id === 's2').gone, true);
  calls.length = 0;
  const second = await deliverQueueItem({
    row, subscriptions, prefs, already: new Set(['s1', 's2']),
    send: async (sub) => { calls.push(sub.id); },
  });
  assert.deepEqual(calls, []);
  assert.equal(second.done, true);
  let pending = false;
  const third = await deliverQueueItem({
    row, subscriptions, prefs, already: new Set(),
    send: async () => { pending = true; throw new Error('nett'); },
  });
  assert.equal(third.done, false);
  assert.equal(third.results.length, 0);
  assert.equal(pending, true);
});

test('berre service role får tømme køen', () => {
  assert.equal(requestKind('POST', 'Bearer service-role-key', 'service-role-key'), 'drain');
  assert.equal(requestKind('POST', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.user', 'service-role-key'), 'forbidden');
  assert.equal(requestKind('POST', 'Bearer service-role-key', ''), 'forbidden');
  assert.equal(requestKind('GET', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.user', 'service-role-key'), 'public-key');
  assert.equal(requestKind('PUT', '', 'service-role-key'), 'method');
});

test('sql stengjer køen og tek ikkje med kalendernøkkel eller service role', () => {
  const sql = readFileSync(new URL('../../../oppdatering-8.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.push_queue from anon, authenticated/);
  assert.match(sql, /meeting_cancelled/);
  assert.match(sql, /Europe\/Oslo/);
  assert.equal(sql.includes('calendar_token'), false);
  assert.equal(/service_role|VAPID_PRIVATE|eyJ/.test(sql), false);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /user_id = uid/);
});
