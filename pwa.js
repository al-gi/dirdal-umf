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

  function isIos() {
    const ua = navigator.userAgent || '';
    const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPadOs;
  }

  function iosSafari() {
    const ua = navigator.userAgent || '';
    if (!isIos() || !/WebKit/i.test(ua)) return false;
    return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Android/i.test(ua);
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
  const foot = document.getElementById('installFoot');
  const pageBtn = document.getElementById('installPageBtn');
  const guide = document.getElementById('installGuide');
  const guideTitle = document.getElementById('installGuideTitle');
  const guideLead = document.getElementById('installGuideLead');
  const guidePath = document.getElementById('installGuidePath');
  const guidePathText = document.getElementById('installGuidePathText');
  const guideSteps = document.getElementById('installGuideSteps');
  const guideClose = document.getElementById('installGuideClose');
  let deferred = null;
  let prompting = false;

  const GUIDES = {
    safari: {
      title: 'Legg appen på heimeskjermen',
      lead: 'På iPhone og iPad må du leggje appen til frå Safari. Det går ikkje med eitt trykk.',
      path: 'Del-knappen → «Legg til på Heim-skjerm»',
      share: true,
      steps: [
        'Trykk Del-knappen nedst i Safari (firkanten med pila opp).',
        'Rull ned i menyen og vel «Legg til på Heim-skjerm».',
        'Trykk «Legg til». Neste gong opnar appen i fullskjerm frå heimeskjermen.',
      ],
    },
    iosOther: {
      title: 'Opne sida i Safari',
      lead: 'På iPhone og iPad kan appen berre leggjast på heimeskjermen frå Safari, ikkje frå denne nettlesaren.',
      path: 'Del-knappen → «Legg til på Heim-skjerm»',
      share: true,
      steps: [
        'Kopier adressa og opne ho i Safari.',
        'Trykk Del-knappen, så «Legg til på Heim-skjerm».',
        'Trykk «Legg til».',
      ],
    },
    menu: {
      title: 'Installer frå menyen',
      lead: 'Installeringsdialogen er ikkje klar enno. Du kan leggje appen til frå menyen i nettlesaren.',
      path: 'Meny → «Installer app» eller «Legg til på startskjermen»',
      share: false,
      steps: [
        'Opne menyen øvst til høgre i Chrome eller Edge.',
        'Vel «Installer app» eller «Legg til på startskjermen».',
      ],
    },
  };

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  function hidePageButton() {
    if (foot) foot.hidden = true;
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

  function openGuide(kind) {
    const copy = GUIDES[kind];
    if (!guide || !copy || typeof guide.showModal !== 'function') return;
    if (guideTitle) guideTitle.textContent = copy.title;
    if (guideLead) guideLead.textContent = copy.lead;
    guide.classList.toggle('has-share', !!copy.share);
    if (guidePath) guidePath.hidden = !copy.path;
    if (guidePathText) guidePathText.textContent = copy.path || '';
    if (guideSteps) {
      guideSteps.replaceChildren();
      copy.steps.forEach((step) => {
        const li = document.createElement('li');
        li.textContent = step;
        guideSteps.appendChild(li);
      });
    }
    if (!guide.open) guide.showModal();
  }

  function closeGuide() {
    if (guide && guide.open) guide.close();
  }

  async function promptInstall() {
    const promptEvent = deferred;
    if (!promptEvent || prompting) return false;
    deferred = null;
    prompting = true;
    hideBanner();
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') rememberDismiss();
      return true;
    } catch (err) {
      return false;
    } finally {
      prompting = false;
    }
  }

  async function onPageInstall() {
    if (isStandalone()) {
      hidePageButton();
      return;
    }
    if (iosSafari()) {
      openGuide('safari');
      return;
    }
    if (isIos()) {
      openGuide('iosOther');
      return;
    }
    if (prompting) return;
    if (!(await promptInstall())) openGuide('menu');
  }

  if (isStandalone()) hidePageButton();

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      rememberDismiss();
      hideBanner();
    });
  }

  if (installBtn) installBtn.addEventListener('click', () => { promptInstall(); });
  if (pageBtn) pageBtn.addEventListener('click', () => { onPageInstall(); });
  if (guideClose) guideClose.addEventListener('click', closeGuide);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (isStandalone()) return;
    deferred = event;
    showBanner('chrome');
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    rememberDismiss();
    hideBanner();
    hidePageButton();
    closeGuide();
  });

  try {
    const mq = window.matchMedia('(display-mode: standalone)');
    const onMode = () => { if (isStandalone()) { hidePageButton(); closeGuide(); } };
    if (mq.addEventListener) mq.addEventListener('change', onMode);
  } catch (err) { /* eldre nettlesar */ }

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
