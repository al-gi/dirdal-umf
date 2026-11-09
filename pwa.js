/* Installering og tenestearbeidar. Rører ikkje innlogging eller data. */
(() => {
  'use strict';

  const DISMISS_KEY = 'dumf-install-dismissed';

  function isStandalone() {
    const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
    for (let i = 0; i < modes.length; i++) {
      if (window.matchMedia('(display-mode: ' + modes[i] + ')').matches) return true;
    }
    return window.navigator.standalone === true;
  }

  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (err) { return false; }
  }

  function rememberDismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (err) { /* privatmodus */ }
  }

  const banner = document.getElementById('installBanner');
  const text = document.getElementById('installText');
  const installBtn = document.getElementById('installBtn');
  const dismissBtn = document.getElementById('installDismiss');
  let deferred = null;

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  function showBanner(mode) {
    if (!banner || !text || isStandalone() || dismissed()) return;
    if (mode === 'ios') {
      text.textContent = 'Installer appen: trykk Del-knappen, så «Legg til på Heim-skjerm».';
      if (installBtn) installBtn.hidden = true;
    } else {
      text.textContent = 'Installer appen. Legg han på heimeskjermen, så opnar han seg i fullskjerm.';
      if (installBtn) installBtn.hidden = false;
    }
    banner.hidden = false;
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      rememberDismiss();
      hideBanner();
    });
  }

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      const promptEvent = deferred;
      deferred = null;
      if (!promptEvent) return;
      hideBanner();
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') rememberDismiss();
      } catch (err) { /* nettlesaren viste ikkje dialogen */ }
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (isStandalone() || dismissed()) return;
    deferred = event;
    showBanner('chrome');
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    rememberDismiss();
    hideBanner();
  });

  function iosSafari() {
    const ua = navigator.userAgent || '';
    const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const ios = /iPad|iPhone|iPod/.test(ua) || iPadOs;
    if (!ios || !/WebKit/i.test(ua)) return false;
    return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Android/i.test(ua);
  }

  if (iosSafari()) showBanner('ios');

  function appScopePath() {
    const path = location.pathname;
    if (path.endsWith('/')) return path;
    const slash = path.lastIndexOf('/');
    const last = path.slice(slash + 1);
    if (last.includes('.')) return path.slice(0, slash + 1);
    return path + '/';
  }

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });

    const scope = appScopePath();
    const swUrl = new URL('sw.js', location.origin + scope).href;
    navigator.serviceWorker.register(swUrl, { scope: scope, updateViaCache: 'none' })
      .catch(() => navigator.serviceWorker.register(swUrl, { scope: scope }))
      .then((reg) => {
        if (!reg || !reg.update) return;
        const update = () => reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') update();
        });
      })
      .catch(() => {});
  }
})();
