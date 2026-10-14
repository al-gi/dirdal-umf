(() => {
'use strict';

const cfg = window.DUMF_CONFIG || {};
const DEMO = !(cfg.supabaseUrl && cfg.supabaseAnonKey);
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
      const [m, t, p, i] = await Promise.all([
        sb.from('meetings').select('*'),
        sb.from('threads').select('*').order('last_at', { ascending: false }),
        sb.from('profiles').select('id,name').order('name'),
        sb.from('group_info').select('*').eq('id', 1).maybeSingle(),
      ]);
      return { meetings: ok(m), threads: ok(t), profiles: ok(p), info: ok(i) };
    },
    async saveMeeting(m) {
      const { id, ...row } = m; row.updated_at = now();
      if (id) ok(await sb.from('meetings').update(row).eq('id', id));
      else ok(await sb.from('meetings').insert(row));
    },
    async deleteMeeting(id) { ok(await sb.from('meetings').delete().eq('id', id)); },
    async saveInfo(info) { ok(await sb.from('group_info').upsert({ id: 1, ...info, updated_at: now() })); },
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
    meetings: [
      { id: uid(), date: iso(-42), time: '19:30', book: 'MRK', ch_from: 1, ch_to: 1, verses: '', topic: '', host: 'Eksempel A', note: '' },
      { id: uid(), date: iso(-28), time: '19:30', book: 'MRK', ch_from: 2, ch_to: 3, verses: '', topic: '', host: 'Eksempel B', note: 'Eksempelnotat.' },
      { id: uid(), date: iso(-14), time: '19:30', book: 'MRK', ch_from: 4, ch_to: 4, verses: '1–34', topic: 'Likningane', host: 'Eksempel A', note: '' },
      { id: uid(), date: iso(7), time: '19:30', book: 'MRK', ch_from: 5, ch_to: 5, verses: '', topic: '', host: 'Eksempel C', note: 'Eksempel: ta med kaffi.' },
    ],
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
    async loadAll() { return JSON.parse(JSON.stringify({ meetings: db.meetings, threads: [...db.threads].sort((a, b) => b.last_at.localeCompare(a.last_at)), profiles: db.profiles, info: db.info })); },
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
const S = { session: null, meetings: [], threads: [], profiles: [], info: null, replies: [], openThread: null, loaded: false, allBooks: false };
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
  for (const m of S.meetings) {
    const b = BY[m.book];
    if (!b || !m.ch_from) continue;
    const to = Math.min(b.ch, Math.max(m.ch_from, m.ch_to || m.ch_from));
    const state = m.date < t ? 'read' : 'plan';
    for (let c = m.ch_from; c <= to; c++) {
      const book = (map[m.book] ||= {});
      const cur = book[c];
      if (!cur || (cur.state === 'plan' && state === 'read') || (cur.state === state && m.date > cur.date)) book[c] = { state, date: m.date };
    }
  }
  return map;
}

/** Neste kapittel etter den siste samlinga som har ein bibeltekst. */
function suggestNext() {
  const withBook = S.meetings.filter(m => BY[m.book] && m.ch_from).sort((a, b) => b.date.localeCompare(a.date));
  const last = withBook[0];
  if (!last) return null;
  const b = BY[last.book];
  const end = Math.max(last.ch_from, last.ch_to || last.ch_from);
  if (end < b.ch) return { book: b.id, ch: end + 1, after: last };
  const idx = BOOKS.indexOf(b);
  const nb = BOOKS[(idx + 1) % BOOKS.length];
  return { book: nb.id, ch: 1, after: last };
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
  renderOverview(); renderReading(); renderForum();
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
      h('div', { class: 'row' }, h('span', { class: 'rel', text: relDays(next.date) }), h('button', { class: 'btn', onclick: () => openMeeting(next) }, 'Endre')),
      h('div', { class: 'when', text: cap(fmtLong(next.date)) + (next.time ? ' kl. ' + next.time.slice(0, 5).replace(':', '.') : '') }),
      h('dl', {},
        h('dt', { class: 'label', text: 'Les til då' }), h('dd', {}, readingBlock(next)),
        h('dt', { class: 'label', text: 'Hos' }), h('dd', { text: next.host || 'Ikkje bestemt enno' }),
        next.note ? [h('dt', { class: 'label', text: 'Notat' }), h('dd', { class: 'prose', text: next.note })] : null)));
  }
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
  $('#infoBox').replaceChildren(info.about
    ? h('p', { class: 'prose', text: info.about })
    : h('p', { class: 'muted', text: 'Skriv kort om gruppa, så nye medlemer finn fram.' }));
  $('#membersLabel').textContent = `Medlemer (${S.profiles.length})`;
  $('#members').replaceChildren(...S.profiles.map(p => h('span', { class: 'chip', text: (p.name || 'Utan namn') + (p.id === meId() ? ' (deg)' : '') })));
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

  const books = S.allBooks ? BOOKS : BOOKS.filter(b => map[b.id]);
  const out = [];
  let section = null;
  for (const b of books) {
    if (S.allBooks && b.t !== section) { section = b.t; out.push(h('h3', { text: b.t === 'GT' ? 'Det gamle testamentet' : 'Det nye testamentet' })); }
    const chs = map[b.id] || {};
    const done = Object.values(chs).filter(c => c.state === 'read').length;
    const cells = [];
    for (let c = 1; c <= b.ch; c++) {
      const st = chs[c];
      cells.push(h('span', {
        class: 'cell' + (st ? ' ' + st.state : ''),
        title: `${b.name} ${c}` + (st ? (st.state === 'read' ? ' – lese ' : ' – planlagt ') + fmtShort(st.date) : ''),
        text: c,
      }));
    }
    out.push(h('div', { class: 'book' },
      h('div', { class: 'bn' }, h('b', { text: b.name }), h('span', { text: `${done} / ${b.ch}` + (done === b.ch ? ' · ferdig' : '') })),
      h('div', { class: 'cells' }, cells)));
  }
  if (!out.length) out.push(h('p', { class: 'muted', text: 'Når de legg inn ein bibeltekst på ei samling, dukkar boka opp her med kapitla de har lese.' }));
  $('#bookMap').replaceChildren(...out);
  $('#toggleBooks').textContent = S.allBooks ? 'Vis berre bøker vi har byrja på' : 'Vis alle bøkene';

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
  $('#hostOptions').replaceChildren(...chips.map(c => h('option', { value: c.name })));
}
$('#toggleBooks').addEventListener('click', () => { S.allBooks = !S.allBooks; renderReading(); });

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
    Object.assign(S, { meetings: d.meetings || [], threads: d.threads || [], profiles: d.profiles || [], info: d.info, loaded: true });
    setStatus('');
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
const TABS = ['oversikt', 'lesing', 'forum'];
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

function applySuggestion() {
  const s = suggestNext();
  if (!s) return;
  mBook.value = s.book;
  syncPassage(s.ch, s.ch);
  $('#mVerses').value = '';
  updatePreview();
}
$('#suggestBtn').addEventListener('click', applySuggestion);

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
  updatePreview();
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
