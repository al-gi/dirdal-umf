/* Valfrie push-varsel. Løyve blir berre spurt om når brukaren trykker sjølv. */
(() => {
  'use strict';

  const api = () => window.dumfPush;
  const $ = (s) => document.querySelector(s);
  const hint = () => $('#pushHint');
  const msg = () => $('#pushMsg');
  let current = null;
  let thisEndpoint = '';

  function standalone() {
    const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
    for (let i = 0; i < modes.length; i++) {
      if (window.matchMedia('(display-mode: ' + modes[i] + ')').matches) return true;
    }
    return window.navigator.standalone === true;
  }
  function ios() {
    const ua = navigator.userAgent || '';
    const iPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPad;
  }
  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function deviceLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone eller iPad';
    if (/Android/.test(ua)) return 'Android';
    return 'Nettlesar';
  }
  function prefsFromForm(enabled) {
    return {
      enabled: !!enabled,
      meeting: $('#pushMeeting').checked,
      wiki: $('#pushWiki').checked,
      forum: $('#pushForum').checked,
      site: $('#pushSite').checked,
    };
  }
  function applyPrefs(prefs) {
    const p = prefs || {};
    $('#pushMeeting').checked = p.meeting !== false;
    $('#pushWiki').checked = p.wiki !== false;
    $('#pushForum').checked = p.forum !== false;
    $('#pushSite').checked = p.site !== false;
    const on = !!p.enabled;
    $('#pushEnable').hidden = on;
    $('#pushDisable').hidden = !on;
    $('#pushForget').hidden = !on || !thisEndpoint;
  }
  function say(text) {
    if (msg()) msg().textContent = text || '';
  }
  function baseHint() {
    if (!hint()) return;
    if (ios() && !standalone()) {
      hint().textContent = 'På iPhone kjem varsel berre når appen er lagt på heimeskjermen og opna derfrå. Trykk Del-knappen, så «Legg til på Heim-skjerm».'
        + (api() && api().demo ? ' I demomodus blir uansett ingen varsel sende.' : '');
      return;
    }
    if (api() && api().demo) {
      hint().textContent = 'Varsel verkar når sida er kopla til databasen, ikkje i demomodus. Teksten på låseskjermen er kort og inneheld ikkje innlegg, adresser eller notat.';
      return;
    }
    if (!supported()) {
      hint().textContent = 'Denne nettlesaren støttar ikkje varsel.';
      return;
    }
    hint().textContent = 'Vel kva du vil ha beskjed om. Teksten på låseskjermen er kort og inneheld ikkje innlegg, adresser eller notat. Påminning kjem dagen før, kl. 18 norsk tid.';
  }
  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function publicKey() {
    const cfg = window.DUMF_CONFIG || {};
    const token = await api().token();
    if (!cfg.supabaseUrl || !token) throw new Error('manglar innlogging');
    const res = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/varsel', {
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token },
    });
    if (res.status === 404) return { configured: false, missingFunction: true };
    if (!res.ok) throw new Error('nøkkel');
    return res.json();
  }
  async function refresh() {
    baseHint();
    say('');
    thisEndpoint = '';
    if (!api() || api().demo) {
      applyPrefs({ enabled: false, meeting: true, wiki: true, forum: true, site: true });
      $('#pushEnable').hidden = false;
      $('#pushDisable').hidden = true;
      $('#pushForget').hidden = true;
      return;
    }
    try {
      current = await api().settings();
      const devices = current.devices || [];
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
      thisEndpoint = sub ? sub.endpoint : '';
      const mine = devices.some((d) => d.endpoint === thisEndpoint);
      if (!mine) thisEndpoint = '';
      applyPrefs(current.prefs);
      const n = devices.length;
      if (n) say(n === 1 ? '1 eining får varsel for denne brukaren.' : n + ' einingar får varsel for denne brukaren.');
      if (current.prefs && current.prefs.enabled && !mine) {
        $('#pushEnable').hidden = false;
        $('#pushEnable').textContent = 'Slå på på denne eininga';
      } else {
        $('#pushEnable').textContent = 'Slå på varsel';
      }
    } catch (err) {
      const code = err && (err.code || '');
      const text = err && err.message || '';
      say(code === 'PGRST202' || /my_push_settings|schema cache/i.test(text)
        ? 'Databasen manglar oppdatering-8.sql, så varsel kan ikkje lagrast enno.'
        : 'Fekk ikkje henta varselvala.');
    }
  }
  async function save(enabled) {
    await api().savePrefs(prefsFromForm(enabled));
  }
  async function enablePush() {
    say('');
    if (!api() || api().demo) { say('I demomodus blir ingen varsel sende.'); return; }
    if (ios() && !standalone()) { baseHint(); return; }
    if (!supported()) { say('Denne nettlesaren støttar ikkje varsel.'); return; }
    if (Notification.permission === 'denied') {
      say('Du har blokkert varsel. Tillat varsel for sida i innstillingane på telefonen, og prøv igjen.');
      return;
    }
    let permission = Notification.permission;
    if (permission !== 'granted') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      say('Du har blokkert varsel. Tillat varsel for sida i innstillingane på telefonen, og prøv igjen.');
      return;
    }
    let key;
    try { key = await publicKey(); }
    catch (err) { say('Fekk ikkje kontakt med varselfunksjonen.'); return; }
    if (key.missingFunction) { say('Edge-funksjonen «varsel» er ikkje lagt ut enno.'); return; }
    try { await save(true); } catch (err) { say('Fekk ikkje lagra valet.'); return; }
    if (!key.configured || !key.publicKey) {
      say('Vala er lagra, men serveren manglar push-nøkkel enno, så ingen varsel blir sende.');
      await refresh();
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key.publicKey),
      });
      const json = sub.toJSON();
      await api().saveSub(json, deviceLabel());
      thisEndpoint = json.endpoint;
      await refresh();
      say('Varsel er på for denne eininga.');
    } catch (err) {
      say('Fekk ikkje registrere eininga. Prøv igjen.');
    }
  }
  async function forgetEndpoint(endpoint) {
    if (!endpoint) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    if (sub && sub.endpoint === endpoint) await sub.unsubscribe();
    await api().forget(endpoint);
  }
  window.dumfPushLogout = async () => {
    if (!api() || api().demo || !thisEndpoint) return;
    try { await forgetEndpoint(thisEndpoint); } catch (err) { /* utlogging skal likevel skje */ }
  };

  $('#pushEnable').addEventListener('click', enablePush);
  $('#pushDisable').addEventListener('click', async () => {
    if (!api() || api().demo) { say('I demomodus blir ingen varsel sende.'); return; }
    try {
      await api().forgetAll();
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
      if (sub) await sub.unsubscribe();
      await save(false);
      thisEndpoint = '';
      await refresh();
      say('Varsel er slått av for denne brukaren.');
    } catch (err) { say('Fekk ikkje slå av varsel.'); }
  });
  $('#pushForget').addEventListener('click', async () => {
    if (!api() || api().demo || !thisEndpoint) return;
    try {
      await forgetEndpoint(thisEndpoint);
      thisEndpoint = '';
      await refresh();
      say('Denne eininga får ikkje lenger varsel.');
    } catch (err) { say('Fekk ikkje fjerne eininga.'); }
  });
  ['pushMeeting', 'pushWiki', 'pushForum', 'pushSite'].forEach((id) => {
    $('#' + id).addEventListener('change', async () => {
      if (!api() || api().demo) return;
      const enabled = current && current.prefs ? !!current.prefs.enabled : false;
      try { await save(enabled); } catch (err) { say('Fekk ikkje lagra valet.'); }
    });
  });
  $('#profileBtn').addEventListener('click', () => { refresh(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(async (reg) => {
      try {
        const sub = reg.pushManager && await reg.pushManager.getSubscription();
        if (sub) thisEndpoint = sub.endpoint;
      } catch (err) { /* inga registrering */ }
    }).catch(() => {});
  }
})();
