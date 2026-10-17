(() => {
'use strict';

const cfg = window.DUMF_CONFIG || {};
// ?demo i adressa viser eksempeldata utan å røre databasen
const DEMO = new URLSearchParams(location.search).has('demo') || !(cfg.supabaseUrl && cfg.supabaseAnonKey);
const BOOKS = window.BIBLE;
const BY = Object.fromEntries(BOOKS.map(b => [b.id, b]));
const TOTAL_CH = BOOKS.reduce((s, b) => s + b.ch, 0);
const DEFAULT_NAME = 'Dirdal Unge Mannsforening';

const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* =====================================================================
   Lagring: Supabase når config.js er fylt ut, elles demo i nettlesaren
   ===================================================================== */
function supabaseStore() {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  const here = location.origin + location.pathname;
  const now = () => new Date().toISOString();
  return {
    async session() { return ok(await sb.auth.getSession()).session; },
    onAuth(fn) { sb.auth.onAuthStateChange((ev, s) => fn(ev, s)); },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, name, code) {
      return ok(await sb.auth.signUp({ email, password, options: { data: { name, invite_code: code }, emailRedirectTo: here } }));
    },
    async reset(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: here })); },
    async setPassword(password) { ok(await sb.auth.updateUser({ password })); },
    async signOut() { await sb.auth.signOut(); },
    async loadAll() {
      const [m, t, p, i, mb, r, w, at, cm, pv] = await Promise.all([
        sb.from('meetings').select('*'),
        sb.from('threads').select('*').order('last_at', { ascending: false }),
        sb.from('profiles').select('id,name').order('name'),
        sb.from('group_info').select('*').eq('id', 1).maybeSingle(),
        sb.from('members').select('*').order('sort').order('name'),
        sb.from('readings').select('*'),
        sb.from('wiki').select('*').order('updated_at', { ascending: false }),
        sb.from('attendance').select('*'),
        sb.from('meeting_comments').select('*').order('created_at'),
        sb.from('proposal_votes').select('*'),
      ]);
      // Tabellar frå oppdatering-2/3.sql: manglar dei, går resten likevel
      const soft = x => (x.error ? [] : x.data);
      return { meetings: ok(m), threads: ok(t), profiles: ok(p), info: ok(i), members: ok(mb), readings: soft(r), wiki: soft(w),
        attendance: soft(at), comments: soft(cm), votes: soft(pv),
        needsUpdate: [r, w].some(x => x.error) ? 'oppdatering-2.sql' : [at, cm, pv].some(x => x.error) ? 'oppdatering-3.sql' : null };
    },
    async setAttendance(meetingId, status) {
      const uid = (await this.session()).user.id;
      if (!status) ok(await sb.from('attendance').delete().eq('meeting_id', meetingId).eq('user_id', uid));
      else ok(await sb.from('attendance').upsert({ meeting_id: meetingId, user_id: uid, status, updated_at: now() }, { onConflict: 'meeting_id,user_id' }));
    },
    async addComment(row) { ok(await sb.from('meeting_comments').insert(row)); },
    async deleteComment(id) { ok(await sb.from('meeting_comments').delete().eq('id', id)); },
    async vote(commentId, on) {
      const uid = (await this.session()).user.id;
      if (on) ok(await sb.from('proposal_votes').insert({ comment_id: commentId, user_id: uid }));
      else ok(await sb.from('proposal_votes').delete().eq('comment_id', commentId).eq('user_id', uid));
    },
    async addReading(row) { ok(await sb.from('readings').insert(row)); },
    async deleteReading(id) { ok(await sb.from('readings').delete().eq('id', id)); },
    async saveWiki(p) {
      const { id, ...row } = p; row.updated_at = now(); row.updated_by = (await this.session())?.user.id;
      if (id) ok(await sb.from('wiki').update(row).eq('id', id));
      else ok(await sb.from('wiki').insert(row));
    },
    async deleteWiki(id) { ok(await sb.from('wiki').delete().eq('id', id)); },
    async saveMember(m) {
      const { id, ...row } = m;
      if (id) ok(await sb.from('members').update(row).eq('id', id));
      else ok(await sb.from('members').insert(row));
    },
    async deleteMember(id) { ok(await sb.from('members').delete().eq('id', id)); },
    async saveMeeting(m) {
      const { id, ...row } = m; row.updated_at = now();
      if (id) ok(await sb.from('meetings').update(row).eq('id', id));
      else ok(await sb.from('meetings').insert(row));
    },
    async deleteMeeting(id) { ok(await sb.from('meetings').delete().eq('id', id)); },
    async saveInfo(info) { ok(await sb.from('group_info').update({ ...info, updated_at: now() }).eq('id', 1)); },
    async saveName(id, name) { ok(await sb.from('profiles').update({ name }).eq('id', id)); },
    async addThread(title, body) { ok(await sb.from('threads').insert({ title, body })); },
    async deleteThread(id) { ok(await sb.from('threads').delete().eq('id', id)); },
    async replies(threadId) { return ok(await sb.from('replies').select('*').eq('thread_id', threadId).order('created_at')); },
    async addReply(threadId, body) { ok(await sb.from('replies').insert({ thread_id: threadId, body })); },
    async deleteReply(id) { ok(await sb.from('replies').delete().eq('id', id)); },
    live(fn) { sb.channel('endringar').on('postgres_changes', { event: '*', schema: 'public' }, p => fn(p.table)).subscribe(); },
  };
}

function demoStore() {
  const KEY = 'dumf-demo-v1';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const iso = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return localDate(d); };
  const seed = () => ({
    info: { name: DEFAULT_NAME, when_text: 'Annakvar torsdag kl. 19.30 (eksempel)', about: 'Dette er eksempeltekst i demomodus. Her skriv de kort om gruppa.' },
    profiles: [{ id: 'demo', name: 'Deg (demo)' }, { id: 'demo2', name: 'Eksempel-medlem' }],
    members: [
      { id: uid(), sort: 1, name: 'Eksempel A', role: 'Formann (eksempel)', address: 'Dirdalsvegen 1', postcode: '4335', place: 'Dirdal', phone: '000 00 000', email: null },
      { id: uid(), sort: 2, name: 'Eksempel B', role: 'Nest formann (eksempel)', address: 'Kyrkjevegen 2', postcode: '4335', place: 'Dirdal', phone: null, email: 'eksempel@example.com' },
    ],
    meetings: [
      { id: uid(), date: iso(-42), time: '19:30', book: 'MRK', ch_from: 1, ch_to: 1, verses: '', topic: '', host: 'Eksempel A', note: '' },
      { id: uid(), date: iso(-28), time: '19:30', book: 'MRK', ch_from: 2, ch_to: 3, verses: '', topic: '', host: 'Eksempel B', note: 'Eksempelnotat.' },
      { id: uid(), date: iso(-14), time: '19:30', book: 'MRK', ch_from: 4, ch_to: 4, verses: '1–34', topic: 'Likningane', host: 'Eksempel A', note: '' },
      { id: uid(), date: iso(7), time: '19:30', book: 'MRK', ch_from: 5, ch_to: 5, verses: '', topic: '', host: 'Eksempel C', note: 'Eksempel: ta med kaffi.' },
    ],
    readings: [{ id: uid(), book: 'JON', ch_from: 1, ch_to: 4, read_on: null, note: 'Eksempel: lese før sida fanst' }],
    wiki: [{ id: uid(), title: 'Eksempel: Bibelleseplanar', body: 'Eksempelside i demomodus.\nTips: https://www.bibel.no', tags: ['tips', 'lesing'], author: 'demo2', updated_by: 'demo2', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
    threads: [{ id: uid(), title: 'Eksempel: Kvifor talar Jesus i likningar?', body: 'Dette er eit eksempelinnlegg i demomodus.', author: 'demo2', created_at: new Date(Date.now() - 864e5 * 3).toISOString(), last_at: new Date(Date.now() - 864e5 * 3).toISOString() }],
    replies: [],
  });
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const ts = () => new Date().toISOString();
  return {
    async session() { return { user: { id: 'demo' } }; },
    onAuth() {},
    async signIn() {}, async signUp() {}, async reset() {}, async setPassword() {},
    async signOut() { try { localStorage.removeItem(KEY); } catch {} location.reload(); },
    async loadAll() { return JSON.parse(JSON.stringify({ meetings: db.meetings, threads: [...db.threads].sort((a, b) => b.last_at.localeCompare(a.last_at)), profiles: db.profiles, info: db.info, members: [...(db.members || [])].sort((a, b) => a.sort - b.sort), readings: db.readings || [], wiki: [...(db.wiki || [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      attendance: db.attendance || [], comments: db.comments || [], votes: db.votes || [] })); },
    async setAttendance(meetingId, status) {
      db.attendance = (db.attendance || []).filter(a => !(a.meeting_id === meetingId && a.user_id === 'demo'));
      if (status) db.attendance.push({ meeting_id: meetingId, user_id: 'demo', status });
      save();
    },
    async addComment(row) { (db.comments ||= []).push({ ...row, id: uid(), author: 'demo', created_at: ts() }); save(); },
    async deleteComment(id) { db.comments = (db.comments || []).filter(c => c.id !== id); db.votes = (db.votes || []).filter(v => v.comment_id !== id); save(); },
    async vote(commentId, on) {
      db.votes = (db.votes || []).filter(v => !(v.comment_id === commentId && v.user_id === 'demo'));
      if (on) db.votes.push({ comment_id: commentId, user_id: 'demo' });
      save();
    },
    async addReading(row) { (db.readings ||= []).push({ ...row, id: uid(), created_at: ts() }); save(); },
    async deleteReading(id) { db.readings = (db.readings || []).filter(r => r.id !== id); save(); },
    async saveWiki(p) {
      db.wiki ||= [];
      const t = ts();
      if (p.id) db.wiki = db.wiki.map(x => x.id === p.id ? { ...x, ...p, updated_at: t, updated_by: 'demo' } : x);
      else db.wiki.push({ ...p, id: uid(), author: 'demo', updated_by: 'demo', created_at: t, updated_at: t });
      save();
    },
    async deleteWiki(id) { db.wiki = (db.wiki || []).filter(x => x.id !== id); save(); },
    async saveMember(m) {
      db.members ||= [];
      if (m.id) db.members = db.members.map(x => x.id === m.id ? { ...x, ...m } : x);
      else db.members.push({ ...m, id: uid() });
      save();
    },
    async deleteMember(id) { db.members = (db.members || []).filter(x => x.id !== id); save(); },
    async saveMeeting(m) {
      if (m.id) db.meetings = db.meetings.map(x => x.id === m.id ? { ...x, ...m } : x);
      else db.meetings.push({ ...m, id: uid() });
      save();
    },
    async deleteMeeting(id) { db.meetings = db.meetings.filter(x => x.id !== id); save(); },
    async saveInfo(info) { db.info = { ...db.info, ...info }; save(); },
    async saveName(id, name) { db.profiles = db.profiles.map(p => p.id === id ? { ...p, name } : p); save(); },
    async addThread(title, body) { const t = ts(); db.threads.push({ id: uid(), title, body, author: 'demo', created_at: t, last_at: t }); save(); },
    async deleteThread(id) { db.threads = db.threads.filter(x => x.id !== id); db.replies = db.replies.filter(r => r.thread_id !== id); save(); },
    async replies(threadId) { return db.replies.filter(r => r.thread_id === threadId); },
    async addReply(threadId, body) {
      const t = ts(); db.replies.push({ id: uid(), thread_id: threadId, body, author: 'demo', created_at: t });
      db.threads = db.threads.map(x => x.id === threadId ? { ...x, last_at: t } : x); save();
    },
    async deleteReply(id) { db.replies = db.replies.filter(r => r.id !== id); save(); },
    live() {},
  };
}

const store = DEMO ? demoStore() : supabaseStore();

/* =====================================================================
   Tilstand og hjelparar
   ===================================================================== */
const S = { session: null, meetings: [], threads: [], profiles: [], members: [], readings: [], wiki: [], attendance: [], comments: [], votes: [], info: null, replies: [], openThread: null, loaded: false, selBook: null,
  wikiQuery: '', wikiTag: null, openWiki: null };
const meId = () => S.session && S.session.user.id;

function localDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
const today = () => localDate(new Date());
const asDate = s => new Date(s + 'T12:00:00');
const fmt = (s, o) => { try { return new Intl.DateTimeFormat('nn-NO', o).format(asDate(s)); } catch { return s; } };
const fmtLong = s => fmt(s, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = s => fmt(s, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtStamp = t => { try { return new Intl.DateTimeFormat('nn-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(t)); } catch { return ''; } };
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function relDays(s) {
  const n = Math.round((asDate(s) - asDate(today())) / 864e5);
  if (n === 0) return 'I dag';
  if (n === 1) return 'I morgon';
  if (n < 7) return `Om ${n} dagar`;
  if (n < 14) return 'Neste veke';
  return `Om ${Math.round(n / 7)} veker`;
}
const pname = id => (S.profiles.find(p => p.id === id) || {}).name || 'Tidlegare medlem';

function chapters(m) {
  if (!m.ch_from) return '';
  return (!m.ch_to || m.ch_to === m.ch_from) ? String(m.ch_from) : `${m.ch_from}–${m.ch_to}`;
}
function ref(m, long) {
  const b = BY[m.book];
  if (!b) return '';
  let s = (long ? b.name : b.abbr) + (m.ch_from ? ' ' + chapters(m) : '');
  if (m.verses) s += ',' + m.verses;
  return s;
}

function split() {
  const t = today();
  const sorted = [...S.meetings].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return { future: sorted.filter(m => m.date >= t), past: sorted.filter(m => m.date < t).reverse() };
}

/** Per bok: kapittel → {state: 'read'|'plan', date} */
function readingMap() {
  const t = today(), map = {};
  const fromReadings = S.readings.map(r => ({ book: r.book, ch_from: r.ch_from, ch_to: r.ch_to, date: r.read_on || '0000-00-00', reading: true }));
  for (const m of [...S.meetings, ...fromReadings]) {
    const b = BY[m.book];
    if (!b || !m.ch_from) continue;
    const to = Math.min(b.ch, Math.max(m.ch_from, m.ch_to || m.ch_from));
    const state = m.reading || m.date < t ? 'read' : 'plan';
    for (let c = m.ch_from; c <= to; c++) {
      const book = (map[m.book] ||= {});
      const cur = book[c];
      if (!cur || (cur.state === 'plan' && state === 'read') || (cur.state === state && m.date > cur.date)) book[c] = { state, date: m.date };
    }
  }
  return map;
}

/** Neste kapittel etter den siste samlinga som har ein bibeltekst, med same tal kapittel (1 eller 2) som sist. */
function suggestNext() {
  const fromReadings = S.readings.map(r => ({ book: r.book, ch_from: r.ch_from, ch_to: r.ch_to, date: r.read_on || (r.created_at || '').slice(0, 10) }));
  const withBook = [...S.meetings, ...fromReadings].filter(m => BY[m.book] && m.ch_from).sort((a, b) => b.date.localeCompare(a.date));
  const last = withBook[0];
  if (!last) return null;
  const b = BY[last.book];
  const end = Math.max(last.ch_from, last.ch_to || last.ch_from);
  const span = Math.min(2, end - last.ch_from + 1);
  if (end < b.ch) return { book: b.id, ch: end + 1, span, after: last };
  const idx = BOOKS.indexOf(b);
  const nb = BOOKS[(idx + 1) % BOOKS.length];
  return { book: nb.id, ch: 1, span, after: last };
}

/* Google Maps */
const fullAddress = m => [m.address, [m.postcode, m.place].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const mapsUrl = m => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(fullAddress(m) + ', Norge');
function mapsAllUrl(list) {
  const stops = list.filter(m => m.address).map(m => fullAddress(m) + ', Norge');
  if (stops.length < 2) return stops.length ? mapsUrl(list.find(m => m.address)) : null;
  const pts = stops.slice(0, 10);
  const q = new URLSearchParams({ api: '1', origin: pts[0], destination: pts[pts.length - 1] });
  if (pts.length > 2) q.set('waypoints', pts.slice(1, -1).join('|'));
  return 'https://www.google.com/maps/dir/?' + q.toString();
}

/* =====================================================================
   Teikning
   ===================================================================== */
function setStatus(msg) { const el = $('#status'); el.hidden = !msg; el.textContent = msg || ''; }

function render() {
  const signedIn = !!S.session;
  $('#auth').hidden = signedIn;
  $('#app').hidden = !signedIn;
  $('#userBox').hidden = !signedIn;
  $('#demoBanner').hidden = !DEMO;
  const info = S.info || {};
  const name = info.name || DEFAULT_NAME;
  $('#groupName').textContent = name;
  document.title = name;
  $('#groupWhen').textContent = info.when_text || '';
  if (!signedIn) return;
  $('#profileBtn').textContent = pname(meId());
  renderOverview(); renderReading(); renderForum(); renderMembers(); renderWiki();
}

/** Tekst med klikkbare lenkjer, utan å tolke HTML. */
function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»)]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index), h('a', { href: m[0], target: '_blank', rel: 'noopener', text: m[0] }));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/* ---------- Wiki ---------- */
const normTags = s => [...new Set(String(s || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
function allWikiTags() {
  const n = {};
  for (const p of S.wiki) for (const t of p.tags || []) n[t] = (n[t] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function renderWiki() {
  const q = S.wikiQuery.trim().toLowerCase();
  const tags = allWikiTags();
  $('#wikiTags').replaceChildren(...tags.map(([t, n]) => h('button', {
    type: 'button', class: 'chip tag' + (S.wikiTag === t ? ' on' : ''), 'aria-pressed': String(S.wikiTag === t),
    onclick: () => { S.wikiTag = S.wikiTag === t ? null : t; renderWiki(); },
  }, '#' + t, h('b', { text: n }))));
  const pages = S.wiki.filter(p =>
    (!S.wikiTag || (p.tags || []).includes(S.wikiTag)) &&
    (!q || p.title.toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q) || (p.tags || []).some(t => t.includes(q))));
  const list = $('#wikiList');
  if (!S.wiki.length) list.replaceChildren(h('p', { class: 'muted', text: S.loaded ? 'Ingen wikisider enno. Lag ei side for songar, oppskrifter, turplanar, gode bøker, eller det de vil hugse.' : 'Hentar …' }));
  else if (!pages.length) list.replaceChildren(h('p', { class: 'muted', text: 'Ingen sider passar til søket.' }));
  else list.replaceChildren(...pages.map(p => h('button', { class: 'thread', onclick: () => openWikiPage(p.id) },
    h('h3', { text: p.title }),
    h('div', { class: 'meta' },
      (p.tags || []).map(t => h('span', { class: 'tagtxt', text: '#' + t })),
      h('span', { text: '· endra ' + fmtStamp(p.updated_at) + ' av ' + pname(p.updated_by || p.author) })))));

  if (!S.openWiki) return;
  const p = S.wiki.find(x => x.id === S.openWiki);
  if (!p) { if (S.loaded) closeWikiPage(); return; }
  $('#wikiArticle').replaceChildren(
    h('h2', { text: p.title }),
    h('div', { class: 'meta' },
      (p.tags || []).map(t => h('button', { type: 'button', class: 'chip tag', onclick: () => { S.wikiTag = t; closeWikiPage(); } }, '#' + t)),
      h('span', { text: 'Skriven av ' + pname(p.author) + ', sist endra ' + fmtStamp(p.updated_at) + ' av ' + pname(p.updated_by || p.author) })),
    h('div', { class: 'body' }, linkify(p.body || '')));
}
function openWikiPage(id) {
  S.openWiki = id;
  $('#wikiIndex').hidden = true; $('#wikiView').hidden = false;
  renderWiki(); window.scrollTo(0, 0);
}
function closeWikiPage() {
  S.openWiki = null;
  $('#wikiIndex').hidden = false; $('#wikiView').hidden = true;
  renderWiki();
}
$('#wikiBack').addEventListener('click', closeWikiPage);
$('#wikiSearch').addEventListener('input', e => { S.wikiQuery = e.target.value; renderWiki(); });

let editingWiki = null;
function openWikiEditor(p) {
  editingWiki = p;
  $('#wikiTitle').textContent = p ? 'Endre wikiside' : 'Ny wikiside';
  $('#wTitle').value = p ? p.title : '';
  $('#wTags').value = p ? (p.tags || []).join(', ') : (S.wikiTag || '');
  $('#wBody').value = p ? (p.body || '') : '';
  $('#wTagSuggest').replaceChildren(...allWikiTags().map(([t]) => h('button', {
    type: 'button', class: 'chip tag',
    onclick: () => { $('#wTags').value = normTags($('#wTags').value + ',' + t).join(', '); },
  }, '#' + t)));
  const del = $('#wDelete'); del.hidden = !p; del.classList.remove('armed'); del.textContent = 'Slett';
  $('#wikiDlg').showModal();
}
$('#newWiki').addEventListener('click', () => openWikiEditor(null));
$('#wikiEdit').addEventListener('click', () => openWikiEditor(S.wiki.find(x => x.id === S.openWiki)));
$('#wCancel').addEventListener('click', () => $('#wikiDlg').close());
$('#wDelete').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Trykk igjen for å slette'; return; }
  if (await run(store.deleteWiki(editingWiki.id))) { $('#wikiDlg').close(); closeWikiPage(); reload(); }
});
$('#wikiForm').addEventListener('submit', async e => {
  e.preventDefault();
  const row = { title: $('#wTitle').value.trim(), tags: normTags($('#wTags').value), body: $('#wBody').value };
  if (editingWiki) row.id = editingWiki.id;
  if (await run(store.saveWiki(row))) { $('#wikiDlg').close(); reload(); }
});

/* ---------- Påmelding ---------- */
const RSVP = { yes: 'Kjem', maybe: 'Usikker', no: 'Kjem ikkje' };
function renderRsvp(next) {
  $('#rsvpBlock').hidden = !next;
  if (!next) return;
  const rows = S.attendance.filter(a => a.meeting_id === next.id);
  const mine = (rows.find(a => a.user_id === meId()) || {}).status;
  document.querySelectorAll('[data-rsvp]').forEach(b => {
    b.classList.toggle('on', b.dataset.rsvp === mine);
    b.setAttribute('aria-pressed', String(b.dataset.rsvp === mine));
  });
  const groups = Object.keys(RSVP).map(st => {
    const ids = rows.filter(a => a.status === st).map(a => a.user_id);
    return ids.length ? h('div', { class: 'rsvp-row ' + st },
      h('span', { class: 'rsvp-k', text: `${RSVP[st]} (${ids.length})` }),
      h('span', { text: ids.map(id => pname(id) + (id === meId() ? ' (deg)' : '')).join(', ') })) : null;
  }).filter(Boolean);
  const answered = new Set(rows.map(a => a.user_id));
  const silent = S.profiles.filter(p => !answered.has(p.id));
  if (silent.length) groups.push(h('div', { class: 'rsvp-row none' },
    h('span', { class: 'rsvp-k', text: `Ikkje svart (${silent.length})` }),
    h('span', { text: silent.map(p => p.name || 'Utan namn').join(', ') })));
  $('#rsvpList').replaceChildren(...groups);
}
document.querySelectorAll('[data-rsvp]').forEach(b => b.addEventListener('click', async () => {
  const next = split().future[0];
  if (!next) return;
  const mine = (S.attendance.find(a => a.meeting_id === next.id && a.user_id === meId()) || {}).status;
  if (await run(store.setAttendance(next.id, mine === b.dataset.rsvp ? null : b.dataset.rsvp))) reload();
}));

/* ---------- Samtale og forslag om ny dag ---------- */
function renderTalk(next) {
  $('#talkBlock').hidden = !next;
  if (!next) return;
  const items = S.comments.filter(c => c.meeting_id === next.id);
  if (!items.length) {
    $('#talkList').replaceChildren(h('p', { class: 'muted', text: 'Ingen kommentarar enno. Må de byte dag, kan de foreslå ein ny her.' }));
    return;
  }
  $('#talkList').replaceChildren(...items.map(c => {
    const voters = S.votes.filter(v => v.comment_id === c.id).map(v => v.user_id);
    const iVoted = voters.includes(meId());
    const isCurrent = c.proposed_date === next.date && (c.proposed_time || '') === (next.time || '').slice(0, 5);
    return h('div', { class: 'post talk' },
      byline(c.author, c.created_at, c.author === meId() ? delBtn(() => run(store.deleteComment(c.id)).then(reload)) : null),
      c.body ? h('div', { class: 'body', text: c.body }) : null,
      c.proposed_date ? h('div', { class: 'proposal' + (isCurrent ? ' chosen' : '') },
        h('div', {},
          h('span', { class: 'label', text: isCurrent ? 'Valt dato' : 'Forslag til ny dag' }),
          h('div', { class: 'pdate', text: cap(fmtLong(c.proposed_date)) + (c.proposed_time ? ' kl. ' + c.proposed_time.replace(':', '.') : '') }),
          h('div', { class: 'hint', text: voters.length ? `Passar for ${voters.length}: ` + voters.map(pname).join(', ') : 'Ingen har svart enno' })),
        h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn small' + (iVoted ? ' on' : ''), onclick: () => run(store.vote(c.id, !iVoted)).then(reload) }, iVoted ? '✓ Passar for meg' : 'Passar for meg'),
          isCurrent ? null : moveBtn(next, c))) : null);
  }));
}
function moveBtn(next, c) {
  const b = h('button', { type: 'button', class: 'btn small' }, 'Flytt samlinga hit');
  b.addEventListener('click', async () => {
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Trykk igjen for å flytte'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Flytt samlinga hit'; }, 4000); return; }
    const { id, date, time } = next;
    const row = { ...next, date: c.proposed_date, time: c.proposed_time || time || null };
    delete row.created_by; delete row.updated_at;
    if (await run(store.saveMeeting(row))) {
      await run(store.addComment({ meeting_id: id, body: `Flytta samlinga frå ${fmtLong(date)} til ${fmtLong(c.proposed_date)}.` }));
      reload();
    }
  });
  return b;
}
$('#talkForm').addEventListener('submit', async e => {
  e.preventDefault();
  const next = split().future[0];
  const body = $('#talkBody').value.trim(), date = $('#talkDate').value, time = $('#talkTime').value;
  if (!next || (!body && !date)) return;
  if (await run(store.addComment({ meeting_id: next.id, body, proposed_date: date || null, proposed_time: date ? (time || null) : null }))) {
    e.target.reset(); $('#proposeBox').open = false; reload();
  }
});

/* ---------- Kalender (.ics) ---------- */
const ICS_TZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/Oslo',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'];
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) {
  const out = [];
  while (line.length > 72) { out.push(line.slice(0, 72)); line = ' ' + line.slice(72); }
  out.push(line);
  return out.join('\r\n');
}
const pad = n => String(n).padStart(2, '0');
const icsLocal = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
function icsEvent(m) {
  const groupName = (S.info && S.info.name) || DEFAULT_NAME;
  const r = ref(m, true);
  const member = S.members.find(x => m.host && x.name.toLowerCase() === m.host.trim().toLowerCase());
  const lines = ['BEGIN:VEVENT', `UID:${m.id}@dirdal-umf`, 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'];
  if (m.time) {
    const [hh, mm] = m.time.slice(0, 5).split(':').map(Number);
    const start = new Date(m.date + 'T00:00:00'); start.setHours(hh, mm);
    const end = new Date(start.getTime() + 2 * 36e5);
    lines.push(`DTSTART;TZID=Europe/Oslo:${icsLocal(start)}`, `DTEND;TZID=Europe/Oslo:${icsLocal(end)}`);
  } else {
    const d = new Date(m.date + 'T12:00:00'), e = new Date(d.getTime() + 864e5);
    lines.push(`DTSTART;VALUE=DATE:${icsLocal(d).slice(0, 8)}`, `DTEND;VALUE=DATE:${icsLocal(e).slice(0, 8)}`);
  }
  lines.push('SUMMARY:' + icsText(groupName + (r ? ': ' + r : '')));
  const desc = [r && 'Les: ' + r, m.topic, m.host && 'Hos ' + m.host, m.note].filter(Boolean).join('\n');
  if (desc) lines.push('DESCRIPTION:' + icsText(desc));
  if (m.host) lines.push('LOCATION:' + icsText(member && member.address ? `${m.host}, ${fullAddress(member)}` : m.host));
  lines.push('END:VEVENT');
  return lines;
}
function buildIcs(meetings) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dirdal Unge Mannsforening//Bibelgruppe//NN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + icsText((S.info && S.info.name) || DEFAULT_NAME), 'X-WR-TIMEZONE:Europe/Oslo', ...ICS_TZ, ...meetings.flatMap(icsEvent), 'END:VCALENDAR'];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
function downloadIcs(meetings, filename) {
  const blob = new Blob([buildIcs(meetings)], { type: 'text/calendar;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function calendarUrl() {
  const token = S.info && S.info.calendar_token;
  return token && !DEMO ? `${cfg.supabaseUrl}/functions/v1/kalender?token=${token}` : null;
}
function renderCalendar() {
  const url = calendarUrl();
  const sub = $('#calSubscribe');
  sub.hidden = !url; $('#calCopy').hidden = !url;
  if (url) sub.href = url.replace(/^https:/, 'webcal:');
  $('#calMsg').textContent = url ? '' : DEMO ? 'Kalenderabonnement fungerer berre på den ekte sida.' : 'Kalenderabonnementet er ikkje sett opp enno (oppdatering-3.sql og kalenderfunksjonen i Supabase).';
}
$('#calCopy').addEventListener('click', async () => {
  const url = calendarUrl(); if (!url) return;
  try { await navigator.clipboard.writeText(url); $('#calMsg').textContent = 'Lenkja er kopiert.'; }
  catch { $('#calMsg').textContent = url; }
});

/* ---------- Anna info ---------- */
$('#editNotice').addEventListener('click', () => { $('#nText').value = (S.info && S.info.notice) || ''; $('#noticeDlg').showModal(); });
$('#nCancel').addEventListener('click', () => $('#noticeDlg').close());
$('#noticeForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (await run(store.saveInfo({ notice: $('#nText').value.trim() || null }))) { $('#noticeDlg').close(); reload(); }
});

function renderMembers() {
  $('#memberCount').textContent = `Medlemer (${S.members.length})`;
  const all = mapsAllUrl(S.members);
  const a = $('#mapAll'); a.hidden = !all; if (all) a.href = all;
  const list = $('#memberList');
  if (!S.members.length) {
    list.replaceChildren(h('p', { class: 'muted', text: S.loaded ? 'Ingen medlemer lagt inn enno.' : 'Hentar medlemslista …' }));
    return;
  }
  list.replaceChildren(...S.members.map(m => h('div', { class: 'member' },
    h('div', { class: 'who' },
      h('b', { text: m.name }),
      m.role ? h('span', { class: 'role', text: m.role }) : null,
      h('div', { class: 'contact' },
        m.address ? h('a', { href: mapsUrl(m), target: '_blank', rel: 'noopener', text: fullAddress(m) + ' ↗' }) : null,
        m.phone ? h('a', { href: 'tel:' + m.phone.replace(/\s/g, ''), text: m.phone }) : null,
        m.email ? h('a', { href: 'mailto:' + m.email, text: m.email }) : null),
      m.bio ? h('p', { class: 'bio', text: m.bio }) : null),
    h('button', { class: 'btn link', onclick: () => openMember(m) }, 'Endre'))));
}

function stat(n, label) { return h('div', { class: 'stat' }, h('span', { class: 'n', text: S.loaded ? n : '–' }), h('span', { class: 'muted', text: label })); }

function readingBlock(m) {
  const r = ref(m, true);
  return [
    r ? h('span', { class: 'reading', text: r }) : null,
    m.topic ? h('span', { class: r ? 'sub' : 'reading', text: m.topic }) : null,
    !r && !m.topic ? h('span', { class: 'muted', text: 'Ikkje bestemt enno' }) : null,
  ];
}

function renderOverview() {
  const { future, past } = split();
  const next = future[0];
  const box = $('#nextBox'); box.replaceChildren();
  $('#nextActions').replaceChildren(next ? h('button', { class: 'btn link', onclick: () => openMeeting(null) }, 'Planlegg ei til') : '');
  if (!S.loaded) {
    box.append(h('div', { class: 'empty' }, h('span', { class: 'muted', text: 'Hentar planen …' })));
  } else if (!next) {
    box.append(h('div', { class: 'empty' },
      h('h3', { text: 'Ingen samling er sett opp enno' }),
      h('span', { class: 'muted', text: 'Legg inn dato, tekst og kven de skal vere hos, så ser alle det her.' }),
      h('button', { class: 'btn primary', onclick: () => openMeeting(null) }, 'Planlegg neste samling')));
  } else {
    box.append(h('article', { class: 'next' },
      h('div', { class: 'row' }, h('span', { class: 'rel', text: relDays(next.date) }),
        h('span', { class: 'btns' },
          h('button', { class: 'btn', onclick: () => downloadIcs([next], 'samling-' + next.date + '.ics') }, 'Legg i kalender'),
          h('button', { class: 'btn', onclick: () => openMeeting(next) }, 'Endre'))),
      h('div', { class: 'when', text: cap(fmtLong(next.date)) + (next.time ? ' kl. ' + next.time.slice(0, 5).replace(':', '.') : '') }),
      h('dl', {},
        h('dt', { class: 'label', text: 'Les til då' }), h('dd', {}, readingBlock(next)),
        h('dt', { class: 'label', text: 'Hos' }), h('dd', { text: next.host || 'Ikkje bestemt enno' }),
        next.note ? [h('dt', { class: 'label', text: 'Notat' }), h('dd', { class: 'prose', text: next.note })] : null)));
  }
  renderRsvp(S.loaded ? next : null);
  renderTalk(S.loaded ? next : null);
  renderCalendar();
  const later = future.slice(1);
  $('#laterBlock').hidden = !later.length;
  $('#laterList').replaceChildren(...later.map(meetingRow));

  const map = readingMap();
  const read = Object.values(map).reduce((s, b) => s + Object.values(b).filter(c => c.state === 'read').length, 0);
  const hosts = new Set(past.map(m => (m.host || '').trim().toLowerCase()).filter(Boolean)).size;
  const first = past.length ? past[past.length - 1].date : null;
  $('#stats').replaceChildren(
    stat(past.length, 'samlingar' + (first ? ' sidan ' + fmtShort(first) : '')),
    stat(read, 'kapittel lese'),
    stat(hosts, 'ulike vertar'));

  const info = S.info || {};
  $('#noticeBox').replaceChildren(info.notice
    ? h('div', { class: 'notice prose' }, linkify(info.notice))
    : h('p', { class: 'muted', text: 'Her kan de leggje beskjedar og praktisk info, til dømes om turar, fest eller dugnad.' }));
  $('#infoBox').replaceChildren(info.about
    ? h('p', { class: 'prose', text: info.about })
    : h('p', { class: 'muted', text: 'Skriv kort om gruppa, så nye medlemer finn fram.' }));
  const names = S.members.length ? S.members.map(m => m.name) : S.profiles.map(p => p.name || 'Utan namn');
  $('#membersLabel').textContent = `Medlemer (${names.length})`;
  $('#members').replaceChildren(...names.map(n => h('button', { class: 'chip', type: 'button', onclick: () => showTab('medlemer'), text: n })));
}

function meetingRow(m) {
  const r = ref(m);
  return h('div', { class: 'item' },
    h('span', { class: 'd', text: fmtShort(m.date) }),
    h('div', { class: 'main' },
      r ? h('span', { class: 'verse', text: r }) : null,
      m.topic ? h('span', { class: r ? '' : 'verse', text: m.topic }) : null,
      !r && !m.topic ? h('span', { class: 'muted', text: 'Ingen tekst registrert' }) : null,
      m.host ? h('span', { class: 'muted', text: 'Hos ' + m.host }) : null,
      m.note ? h('span', { class: 'note', text: m.note }) : null),
    h('button', { class: 'btn link', onclick: () => openMeeting(m) }, 'Endre'));
}

function renderReading() {
  const map = readingMap();
  let read = 0;
  for (const b of Object.values(map)) for (const c of Object.values(b)) if (c.state === 'read') read++;
  $('#bibleProgress').style.width = (read / TOTAL_CH * 100).toFixed(2) + '%';
  $('#bibleProgressText').textContent = `${read} av ${TOTAL_CH} kapittel`;

  // Alle 66 bøkene som fliser; dei vi har lese i er merka
  const stats = id => {
    const chs = map[id] || {};
    const vals = Object.values(chs);
    return { chs, read: vals.filter(c => c.state === 'read').length, planned: vals.filter(c => c.state === 'plan').length };
  };
  if (!S.selBook && !S.selBookManual) {
    const latest = [...S.meetings].filter(m => BY[m.book]).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (latest) S.selBook = latest.book;
  }
  const grid = [];
  for (const [t, label] of [['GT', 'Det gamle testamentet'], ['NT', 'Det nye testamentet']]) {
    grid.push(h('h3', { text: label }));
    grid.push(h('div', { class: 'tiles' }, BOOKS.filter(b => b.t === t).map(b => {
      const s = stats(b.id);
      const state = s.read === b.ch ? 'done' : s.read ? 'started' : s.planned ? 'planned' : '';
      return h('button', {
        type: 'button', class: 'tile ' + state, 'aria-pressed': String(S.selBook === b.id),
        title: `${b.name}: ${s.read} av ${b.ch} kapittel lese`,
        onclick: () => { S.selBook = S.selBook === b.id ? null : b.id; S.selBookManual = true; renderReading(); },
      },
        h('span', { class: 'tn', text: b.name }),
        h('span', { class: 'tc', text: state === 'done' ? '✓ ferdig' : `${s.read}/${b.ch}` }),
        s.read && state !== 'done' ? h('span', { class: 'tb', style: `width:${(s.read / b.ch * 100).toFixed(1)}%` }) : null);
    })));
  }
  $('#bookGrid').replaceChildren(...grid);

  const detail = $('#bookDetail');
  const sel = BY[S.selBook];
  detail.hidden = !sel;
  if (sel) {
    const s = stats(sel.id);
    const bookReadings = S.readings.filter(r => r.book === sel.id).sort((a, b) => a.ch_from - b.ch_from);
    const cells = [];
    for (let c = 1; c <= sel.ch; c++) {
      const st = s.chs[c];
      const single = bookReadings.find(r => r.ch_from === c && r.ch_to === c);
      const when = st && st.date && !st.date.startsWith('0000') ? ' ' + fmtShort(st.date) : '';
      let title = `${sel.name} ${c}`;
      if (single) title += ' – registrert som lese. Trykk for å fjerne.';
      else if (st) title += (st.state === 'read' ? ' – lese' : ' – planlagt') + when;
      else title += ' – trykk for å merkje som lese';
      cells.push(h('button', {
        type: 'button', class: 'cell' + (st ? ' ' + st.state : ''), title, text: c,
        onclick: () => {
          if (single) run(store.deleteReading(single.id)).then(reload);
          else if (!st || st.state === 'plan') run(store.addReading({ book: sel.id, ch_from: c, ch_to: c, read_on: null })).then(reload);
        },
      }));
    }
    const meetings = S.meetings.filter(m => m.book === sel.id).sort((a, b) => a.date.localeCompare(b.date));
    const rangeRows = bookReadings.filter(r => r.ch_from !== r.ch_to);

    // Registrer fleire kapittel på ein gong
    const rf = h('select', { 'aria-label': 'Frå kapittel' }), rt = h('select', { 'aria-label': 'Til kapittel' });
    const fill = (sel2, from, val) => { sel2.replaceChildren(...Array.from({ length: sel.ch - from + 1 }, (_, i) => h('option', { value: from + i, text: from + i }))); sel2.value = String(Math.max(val, from)); };
    const firstUnread = Array.from({ length: sel.ch }, (_, i) => i + 1).find(c => !s.chs[c] || s.chs[c].state !== 'read') || 1;
    fill(rf, 1, firstUnread); fill(rt, firstUnread, firstUnread);
    rf.addEventListener('change', () => fill(rt, +rf.value, +rt.value));
    const rd = h('input', { type: 'date', 'aria-label': 'Dato (valfritt)' });
    const register = h('form', { class: 'regform', onsubmit: e => {
      e.preventDefault();
      run(store.addReading({ book: sel.id, ch_from: +rf.value, ch_to: +rt.value, read_on: rd.value || null })).then(reload);
    } },
      h('span', { class: 'label', text: 'Registrer det de har lese' }),
      h('div', { class: 'regrow' },
        h('label', { class: 'f' }, 'Frå', rf), h('label', { class: 'f' }, 'Til', rt),
        h('label', { class: 'f' }, 'Dato (valfritt)', rd),
        h('button', { class: 'btn primary' }, 'Lagre')),
      s.read < sel.ch ? h('button', { type: 'button', class: 'btn link', onclick: () => run(store.addReading({ book: sel.id, ch_from: 1, ch_to: sel.ch, read_on: null })).then(reload) }, `Merk heile ${sel.name} som lese`) : null);

    detail.replaceChildren(...[
      h('div', { class: 'row' }, h('h2', { text: sel.name }), h('span', { class: 'muted', text: `${s.read} av ${sel.ch} kapittel lese` })),
      h('div', { class: 'cells' }, cells),
      h('span', { class: 'hint', text: 'Trykk på eit kapittel for å merkje det som lese, eller trykk igjen for å fjerne merket.' }),
      register,
      rangeRows.length ? h('div', { class: 'block' }, h('span', { class: 'label', text: 'Registrert utan samling' }),
        h('div', { class: 'list' }, rangeRows.map(r => h('div', { class: 'item' },
          h('span', { class: 'd', text: r.read_on ? fmtShort(r.read_on) : 'Utan dato' }),
          h('div', { class: 'main' }, h('span', { class: 'verse', text: `${sel.abbr} ${r.ch_from}–${r.ch_to}` }), r.note ? h('span', { class: 'note', text: r.note }) : null),
          delBtn(() => run(store.deleteReading(r.id)).then(reload)))))) : null,
      meetings.length ? h('div', { class: 'block' }, h('span', { class: 'label', text: 'Samlingar' }), h('div', { class: 'list' }, meetings.map(meetingRow))) : null,
    ].filter(Boolean));
  }

  const { past } = split();
  const tally = {};
  for (const m of past) {
    const k = (m.host || '').trim(); if (!k) continue;
    (tally[k.toLowerCase()] ||= { name: k, n: 0, last: m.date }).n++;
  }
  const chips = Object.values(tally).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
  $('#hostChips').replaceChildren(...(chips.length
    ? chips.map(c => h('span', { class: 'chip', title: 'Sist ' + fmtShort(c.last) }, c.name, h('b', { text: '×' + c.n })))
    : [h('span', { class: 'muted', text: 'Når ei samling er over, kjem verten her.' })]));
  $('#pastList').replaceChildren(...(past.length ? past.map(meetingRow)
    : [h('p', { class: 'muted', text: 'Ingen tidlegare samlingar enno. Legg inn dei de har hatt, så får de historikken med.' })]));
  const hostNames = [...new Set([...S.members.map(m => m.name), ...chips.map(c => c.name)])];
  $('#hostOptions').replaceChildren(...hostNames.map(n => h('option', { value: n })));
}

function byline(id, t, extra) {
  return h('div', { class: 'meta' },
    h('span', { text: pname(id) + (id === meId() ? ' (deg)' : '') }),
    t ? h('span', { text: '· ' + fmtStamp(t) }) : null, extra || null);
}
function delBtn(fn) {
  const b = h('button', { class: 'btn link danger', type: 'button' }, 'Slett');
  b.addEventListener('click', e => {
    e.stopPropagation();
    if (b.dataset.armed) { fn(); return; }
    b.dataset.armed = '1'; b.textContent = 'Trykk igjen for å slette';
    setTimeout(() => { delete b.dataset.armed; b.textContent = 'Slett'; }, 4000);
  });
  return b;
}

function renderForum() {
  const list = $('#threadList');
  list.replaceChildren(...S.threads.map(t => h('button', { class: 'thread', onclick: () => openThread(t.id) },
    h('h3', { text: t.title || '(utan tittel)' }),
    byline(t.author, t.created_at, t.last_at !== t.created_at ? h('span', { text: '· siste svar ' + fmtStamp(t.last_at) }) : null))));
  if (S.loaded && !S.threads.length) list.append(h('p', { class: 'muted', text: 'Ingen samtalar enno. Start ein om noko frå teksten de les, eller noko praktisk.' }));

  if (!S.openThread) return;
  const t = S.threads.find(x => x.id === S.openThread);
  if (!t) { if (S.loaded) closeThread(); return; }
  $('#threadHead').replaceChildren(h('article', { class: 'post op' },
    h('h2', { text: t.title }),
    byline(t.author, t.created_at, t.author === meId() ? delBtn(() => run(store.deleteThread(t.id)).then(okd => okd && closeThread())) : null),
    h('div', { class: 'body', text: t.body })));
  $('#replyList').replaceChildren(...S.replies.map(r => h('div', { class: 'post' },
    byline(r.author, r.created_at, r.author === meId() ? delBtn(() => run(store.deleteReply(r.id)).then(loadReplies)) : null),
    h('div', { class: 'body', text: r.body }))));
}

/* =====================================================================
   Lasting
   ===================================================================== */
async function run(p) {
  try { await p; setStatus(''); return true; }
  catch (err) {
    console.error(err);
    setStatus('Fekk ikkje lagra: ' + (err && err.message ? err.message : 'ukjend feil') + '. Sjekk nettet og prøv igjen.');
    return false;
  }
}
async function reload() {
  try {
    const d = await store.loadAll();
    Object.assign(S, { meetings: d.meetings || [], threads: d.threads || [], profiles: d.profiles || [], members: d.members || [], readings: d.readings || [], wiki: d.wiki || [],
      attendance: d.attendance || [], comments: d.comments || [], votes: d.votes || [], info: d.info, loaded: true });
    setStatus(d.needsUpdate ? `Databasen manglar ei oppdatering, så nokre funksjonar kan ikkje lagre noko enno. Den som styrer Supabase må køyre ${d.needsUpdate} i SQL Editor.` : '');
  } catch (err) {
    console.error(err);
    setStatus('Fekk ikkje henta data. Last sida på nytt.');
  }
  render();
}
async function loadReplies() {
  if (!S.openThread) return;
  try { S.replies = await store.replies(S.openThread); } catch (err) { console.error(err); }
  renderForum();
}
let reloadTimer;
function scheduleReload(table) {
  if (table === 'replies') { loadReplies(); return; }
  clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 250);
}

/* =====================================================================
   Faner
   ===================================================================== */
const TABS = ['oversikt', 'lesing', 'wiki', 'forum', 'medlemer'];
function showTab(name) {
  document.querySelectorAll('#app nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  TABS.forEach(n => $('#pane-' + n).hidden = n !== name);
  try { localStorage.setItem('dumf-tab', name); } catch {}
}
document.querySelectorAll('#app nav.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* =====================================================================
   Samling-dialog med bok- og kapittelval
   ===================================================================== */
const mBook = $('#mBook'), mFrom = $('#mFrom'), mTo = $('#mTo');
for (const [t, label] of [['GT', 'Det gamle testamentet'], ['NT', 'Det nye testamentet']]) {
  mBook.append(h('optgroup', { label }, BOOKS.filter(b => b.t === t).map(b => h('option', { value: b.id, text: b.name }))));
}
function fillChapters(sel, from, max, value) {
  sel.replaceChildren(...Array.from({ length: max - from + 1 }, (_, i) => h('option', { value: from + i, text: from + i })));
  sel.value = String(Math.min(Math.max(value || from, from), max));
}
function syncPassage(fromVal, toVal) {
  const b = BY[mBook.value];
  mFrom.disabled = mTo.disabled = $('#mVerses').disabled = !b;
  if (!b) { mFrom.replaceChildren(); mTo.replaceChildren(); updatePreview(); return; }
  fillChapters(mFrom, 1, b.ch, fromVal ?? (+mFrom.value || 1));
  fillChapters(mTo, +mFrom.value, b.ch, toVal ?? Math.max(+mTo.value || 0, +mFrom.value));
  updatePreview();
}
function updatePreview() {
  const m = { book: mBook.value, ch_from: +mFrom.value || null, ch_to: +mTo.value || null, verses: $('#mVerses').value.trim() };
  $('#mPreview').textContent = ref(m, true);
}
mBook.addEventListener('change', () => syncPassage(1, 1));
mFrom.addEventListener('change', () => syncPassage(+mFrom.value, Math.max(+mTo.value, +mFrom.value)));
mTo.addEventListener('change', updatePreview);
$('#mVerses').addEventListener('input', updatePreview);

function setSpan(n) {
  const b = BY[mBook.value];
  if (!b) return;
  const from = +mFrom.value || 1;
  syncPassage(from, Math.min(b.ch, from + n - 1));
}
function markSpan() {
  const n = BY[mBook.value] ? (+mTo.value - +mFrom.value + 1) : 0;
  document.querySelectorAll('[data-span]').forEach(b => { b.classList.toggle('on', +b.dataset.span === n); b.disabled = !BY[mBook.value]; });
}
document.querySelectorAll('[data-span]').forEach(b => b.addEventListener('click', () => { setSpan(+b.dataset.span); markSpan(); }));
[mBook, mFrom, mTo].forEach(el => el.addEventListener('change', markSpan));

function applySuggestion() {
  const s = suggestNext();
  if (!s) return;
  mBook.value = s.book;
  syncPassage(s.ch, Math.min(BY[s.book].ch, s.ch + s.span - 1));
  $('#mVerses').value = '';
  updatePreview(); markSpan();
}
$('#suggestBtn').addEventListener('click', applySuggestion);

/* ---------- Medlemer ---------- */
let editingMember = null;
function openMember(m) {
  editingMember = m;
  $('#memberTitle').textContent = m ? 'Endre medlem' : 'Nytt medlem';
  $('#mbName').value = m ? m.name : '';
  $('#mbRole').value = m ? (m.role || '') : '';
  $('#mbAddress').value = m ? (m.address || '') : '';
  $('#mbPostcode').value = m ? (m.postcode || '') : '4335';
  $('#mbPlace').value = m ? (m.place || '') : 'Dirdal';
  $('#mbPhone').value = m ? (m.phone || '') : '';
  $('#mbEmail').value = m ? (m.email || '') : '';
  $('#mbBio').value = m ? (m.bio || '') : '';
  const del = $('#mbDelete'); del.hidden = !m; del.classList.remove('armed'); del.textContent = 'Slett';
  $('#memberDlg').showModal();
}
$('#addMember').addEventListener('click', () => openMember(null));
$('#mbCancel').addEventListener('click', () => $('#memberDlg').close());
$('#mbDelete').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Trykk igjen for å slette'; return; }
  if (await run(store.deleteMember(editingMember.id))) { $('#memberDlg').close(); reload(); }
});
$('#memberForm').addEventListener('submit', async e => {
  e.preventDefault();
  const v = id => $(id).value.trim() || null;
  const row = { name: v('#mbName'), role: v('#mbRole'), address: v('#mbAddress'), postcode: v('#mbPostcode'), place: v('#mbPlace'), phone: v('#mbPhone'), email: v('#mbEmail'), bio: v('#mbBio') };
  if (editingMember) row.id = editingMember.id;
  else row.sort = S.members.reduce((mx, m) => Math.max(mx, m.sort || 0), 0) + 1;
  if (await run(store.saveMember(row))) { $('#memberDlg').close(); reload(); }
});

let editing = null;
function openMeeting(m) {
  editing = m;
  $('#meetingTitle').textContent = m ? 'Endre samling' : 'Ny samling';
  $('#mDate').value = m ? m.date : '';
  $('#mTime').value = m && m.time ? m.time.slice(0, 5) : '';
  mBook.value = m && BY[m.book] ? m.book : '';
  syncPassage(m ? m.ch_from : 1, m ? (m.ch_to || m.ch_from) : 1);
  $('#mVerses').value = m ? (m.verses || '') : '';
  $('#mTopic').value = m ? (m.topic || '') : '';
  $('#mHost').value = m ? (m.host || '') : '';
  $('#mNote').value = m ? (m.note || '') : '';
  const s = suggestNext();
  $('#suggestBtn').hidden = !s;
  $('#suggestHint').textContent = s ? `Sist: ${ref(s.after)}. Neste: ${BY[s.book].abbr} ${s.ch}` : '';
  if (!m && s) applySuggestion();
  updatePreview(); markSpan();
  const del = $('#mDelete'); del.hidden = !m; del.classList.remove('armed'); del.textContent = 'Slett';
  $('#meetingDlg').showModal();
}
$('#addPast').addEventListener('click', () => openMeeting(null));
$('#mCancel').addEventListener('click', () => $('#meetingDlg').close());
$('#mDelete').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Trykk igjen for å slette'; return; }
  if (await run(store.deleteMeeting(editing.id))) { $('#meetingDlg').close(); reload(); }
});
$('#meetingForm').addEventListener('submit', async e => {
  e.preventDefault();
  const hasBook = !!BY[mBook.value];
  const row = {
    date: $('#mDate').value, time: $('#mTime').value || null,
    book: hasBook ? mBook.value : null,
    ch_from: hasBook ? +mFrom.value : null, ch_to: hasBook ? +mTo.value : null,
    verses: hasBook ? ($('#mVerses').value.trim() || null) : null,
    topic: $('#mTopic').value.trim() || null, host: $('#mHost').value.trim() || null, note: $('#mNote').value.trim() || null,
  };
  if (editing) row.id = editing.id;
  if (await run(store.saveMeeting(row))) { $('#meetingDlg').close(); reload(); }
});

/* ---------- Om gruppa ---------- */
$('#editInfo').addEventListener('click', () => {
  const i = S.info || {};
  $('#iName').value = i.name || DEFAULT_NAME; $('#iWhen').value = i.when_text || ''; $('#iAbout').value = i.about || '';
  $('#infoDlg').showModal();
});
$('#iCancel').addEventListener('click', () => $('#infoDlg').close());
$('#infoForm').addEventListener('submit', async e => {
  e.preventDefault();
  const info = { name: $('#iName').value.trim() || DEFAULT_NAME, when_text: $('#iWhen').value.trim() || null, about: $('#iAbout').value.trim() || null };
  if (await run(store.saveInfo(info))) { $('#infoDlg').close(); reload(); }
});

/* ---------- Profil ---------- */
$('#profileBtn').addEventListener('click', () => { $('#pName').value = pname(meId()); $('#profileDlg').showModal(); });
$('#pCancel').addEventListener('click', () => $('#profileDlg').close());
$('#logoutBtn').addEventListener('click', async () => { $('#profileDlg').close(); await store.signOut(); S.session = null; render(); });
$('#profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (await run(store.saveName(meId(), $('#pName').value.trim()))) { $('#profileDlg').close(); reload(); }
});

/* ---------- Forum ---------- */
$('#newThreadBtn').addEventListener('click', () => { $('#newThreadForm').hidden = false; $('#ntTitle').focus(); });
$('#ntCancel').addEventListener('click', () => { $('#newThreadForm').hidden = true; });
$('#newThreadForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (await run(store.addThread($('#ntTitle').value.trim(), $('#ntBody').value.trim()))) { e.target.reset(); e.target.hidden = true; reload(); }
});
function openThread(id) {
  S.openThread = id; S.replies = [];
  $('#forumIndex').hidden = true; $('#threadView').hidden = false;
  renderForum(); loadReplies(); window.scrollTo(0, 0);
}
function closeThread() {
  S.openThread = null; S.replies = [];
  $('#forumIndex').hidden = false; $('#threadView').hidden = true;
  renderForum();
}
$('#backToForum').addEventListener('click', closeThread);
$('#replyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = $('#replyBody').value.trim(); if (!S.openThread || !body) return;
  if (await run(store.addReply(S.openThread, body))) { e.target.reset(); loadReplies(); reload(); }
});

/* =====================================================================
   Innlogging
   ===================================================================== */
function authView(name) {
  ['login', 'signup', 'forgot', 'newPass'].forEach(n => $('#' + n + 'Form').hidden = n !== name);
  document.querySelectorAll('[data-auth]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.auth === name)));
  $('#authMsg').textContent = '';
}
document.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => authView(b.dataset.auth)));
$('#forgotBtn').addEventListener('click', () => authView('forgot'));
$('#forgotBack').addEventListener('click', () => authView('login'));

function authError(err) {
  const m = (err && err.message) || '';
  if (/invalid login/i.test(m)) return 'Feil e-post eller passord.';
  if (/not confirmed/i.test(m)) return 'Du må stadfeste e-posten din først. Sjå etter ein e-post frå oss.';
  if (/database error|gruppekode/i.test(m)) return 'Feil gruppekode. Spør nokon i gruppa om koden.';
  if (/already registered/i.test(m)) return 'Denne e-posten har allereie ein brukar. Logg inn i staden.';
  if (/password/i.test(m)) return 'Passordet må ha minst 8 teikn.';
  return m || 'Noko gjekk gale. Prøv igjen.';
}
async function authTry(form, fn) {
  const btn = form.querySelector('.primary'); btn.disabled = true;
  try { await fn(); } catch (err) { $('#authMsg').textContent = authError(err); }
  btn.disabled = false;
}
$('#loginForm').addEventListener('submit', e => { e.preventDefault(); authTry(e.target, () => store.signIn($('#liEmail').value.trim(), $('#liPass').value)); });
$('#signupForm').addEventListener('submit', e => {
  e.preventDefault();
  authTry(e.target, async () => {
    const d = await store.signUp($('#suEmail').value.trim(), $('#suPass').value, $('#suName').value.trim(), $('#suCode').value.trim());
    if (d && !d.session) $('#authMsg').textContent = 'Nesten ferdig: sjekk e-posten din og trykk på lenkja for å stadfeste brukaren.';
  });
});
$('#forgotForm').addEventListener('submit', e => {
  e.preventDefault();
  authTry(e.target, async () => { await store.reset($('#fgEmail').value.trim()); $('#authMsg').textContent = 'Sjekk e-posten din for ei lenkje.'; });
});
$('#newPassForm').addEventListener('submit', e => {
  e.preventDefault();
  authTry(e.target, async () => { await store.setPassword($('#npPass').value); S.session = await store.session(); render(); reload(); });
});

/* =====================================================================
   Oppstart
   ===================================================================== */
async function start() {
  let tab = 'oversikt';
  try { tab = localStorage.getItem('dumf-tab') || tab; } catch {}
  if (TABS.includes(location.hash.slice(1))) tab = location.hash.slice(1);
  showTab(tab);
  render();
  store.onAuth((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { S.session = null; render(); authView('newPass'); return; }
    const was = !!S.session;
    S.session = session;
    if (session && !was) reload(); else render();
  });
  try { S.session = await store.session(); } catch (err) { console.error(err); }
  render();
  if (S.session) reload();
  store.live(scheduleReload);
}
start();
})();
