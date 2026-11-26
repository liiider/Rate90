(async () => {
  'use strict';

  const {
    leagues,
    escapeHtml: e,
    readStore,
    writeStore,
    loadCatalog,
    loadMatchDetails,
    loadPlayersZh,
    ratingTier,
    isValidDate,
    cnDate,
    roundName,
    latestPlayedRound
  } = window.Rate90.catalog;

  const i18n = window.Rate90.i18n;
  const t = (key, vars) => i18n ? i18n.t(key, vars) : key;
  const teamLabel = team => i18n ? i18n.teamName(team) : (team?.zh || team?.en || '');
  const leagueShort = id => i18n ? i18n.leagueName(id, 'short') : (leagues[id]?.short || '全部赛事');

  const {
    icon,
    morphTo,
    defaultCrestSvg,
    leagueIcon,
    leagueRail,
    crest,
    detailHeroTags,
    dialogHead
  } = window.Rate90.components;

  const { roundView } = window.Rate90.views;

  const $ = id => document.getElementById(id);
  const dialog = $('overlay');
  const localFile = location.protocol === 'file:';

  const routeParams = () => new URLSearchParams(localFile
    ? location.hash.slice(1) || location.search
    : location.search || location.hash.slice(1));

  function routeUrl(params) {
    const url = new URL(location.href);
    url.hash = '';
    url.search = '';
    if (localFile) url.hash = params.toString();
    else url.search = params.toString();
    return url.href;
  }

  function routeFromUrl(catalog = null) {
    const p = routeParams();
    const linkedMatch = catalog?.byId.get(p.get('match'));
    const requested = p.get('league');
    const league = Object.hasOwn(leagues, requested) || requested === 'all' ? requested :
      (linkedMatch?.league ?? 'all');
    const roundChoice = p.get('round');
    const explicitAll = roundChoice === 'all';
    const explicitRound = !explicitAll && roundChoice != null
      ? (catalog?.roundsByLeague[league]?.find(r => String(r) === roundChoice) ?? null)
      : null;
    const rawDate = isValidDate(p.get('date')) ? p.get('date') : '';
    const future = roundChoice === 'next' || roundChoice === 'following' || p.get('view') === 'future' ||
      (rawDate && rawDate > window.Rate90.upcoming.day({ kickoff: Date.now() }));
    const date = !explicitAll && explicitRound == null && roundChoice !== 'next' && roundChoice !== 'following' ? rawDate : '';
    let round = explicitRound;
    if (!future && !explicitAll && !date && round == null) {
      if (!requested && linkedMatch) round = linkedMatch.round;
      else if (league !== 'all') round = latestPlayedRound(catalog, league);
    }
    return {
      league,
      round,
      allRounds: !future && !date && explicitAll,
      date,
      future: Boolean(future),
      horizon: roundChoice === 'following' || p.get('horizon') === '2' ? 2 : 1,
      match: p.get('match') || ''
    };
  }

  const state = {
    catalog: null,
    route: routeFromUrl(),
    peeked: new Set(),
    theme: readStore('theme', 'dark'),
    lang: i18n ? i18n.getLang() : 'zh',
    details: new Map(),
    pendingDetails: new Set()
  };

  let modal = null;
  let detailTab = { activeTab: 'lineups', pendingTab: '', tacticalSide: 'home' };
  const detailSession = Math.random().toString(36).slice(2);

  function applyTheme() {
    const isDark = state.theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#050506' : '#F4F6FA');
  }

  function syncShellCopy() {
    const skip = document.querySelector('.skip');
    if (skip) skip.textContent = t('skip');
    const brand = document.querySelector('.brand');
    if (brand) brand.setAttribute('aria-label', t('brandAria'));
    const tag = document.querySelector('.brand-tag');
    if (tag) tag.textContent = t('brandTag');
    const rail = $('league-rail');
    if (rail) rail.setAttribute('aria-label', t('leagueFilterAria'));
    const footerNav = document.querySelector('.footer-links');
    if (footerNav) footerNav.setAttribute('aria-label', t('footerAria'));
    const aboutBtn = document.querySelector('.footer-links [data-act="about"]');
    if (aboutBtn) aboutBtn.textContent = t('about');
    const methodBtn = document.querySelector('.footer-links [data-act="method"]');
    if (methodBtn) methodBtn.textContent = t('method');
    const guideLink = $('replay-guide-link');
    if (guideLink) guideLink.textContent = t('replayGuide');
  }

  applyTheme();
  syncShellCopy();

  function announce(msg) {
    $('live-status').textContent = msg;
  }

  let railMounted = false;
  let lastTopBarSig = '';

  function renderTopBar() {
    const isDark = state.theme === 'dark';
    const lang = state.lang;
    const sig = isDark + ':' + lang;
    if (sig === lastTopBarSig) return;
    const bar = $('top-actions');
    const firstMount = !lastTopBarSig;
    if (firstMount) {
      bar.innerHTML =
        '<button type="button" class="icon-btn lang-btn" data-act="lang"></button>' +
        '<button type="button" class="icon-btn" data-act="theme">' +
          icon(isDark ? 'sun' : 'moon') + '</button>';
    }
    lastTopBarSig = sig;
    const langBtn = bar.querySelector('[data-act="lang"]');
    if (langBtn) {
      langBtn.textContent = t('langBtnLabel');
      langBtn.title = t('langSwitchTitle');
      langBtn.setAttribute('aria-label', t('langSwitchAria'));
    }
    const themeButton = bar.querySelector('[data-act="theme"]');
    if (themeButton) {
      themeButton.title = isDark ? t('themeToLight') : t('themeToDark');
      themeButton.setAttribute('aria-label', t('themeAria'));
      if (!firstMount) morphTo(themeButton, isDark ? 'sun' : 'moon', 'smooth');
    }
  }

  function syncLeagueRail(league) {
    const rail = $('league-rail');
    if (!railMounted) {
      rail.innerHTML = leagueRail(league);
      railMounted = true;
      return;
    }
    const items = rail.querySelectorAll?.('.rail-item') || [];
    for (const item of items) {
      const active = item.dataset.val === league;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    }
  }

  function render() {
    if (!state.catalog) return;
    syncShellCopy();
    renderTopBar();
    syncLeagueRail(state.route.league);
    document.title = leagueShort(state.route.league) + ' · Rate90';
    if (state.route.future && !state.catalog.prematch && !state.previewLoading && !state.previewError) {
      state.previewLoading=true;
      window.Rate90.catalog.loadPrematch(state.catalog.prematchFile).then(data=>{state.catalog.prematch=data;})
        .catch(()=>{state.previewError=true;}).finally(()=>{state.previewLoading=false;if(state.route.future) render();});
    }
    $('view').innerHTML = roundView(state);
  }

  function navigate(changes) {
    const p = new URLSearchParams();
    const league = changes.league ?? state.route.league;
    p.set('league', league);
    const date = changes.date ?? '';
    const future = Boolean(changes.future);
    const allRounds = Boolean(changes.allRounds);
    const round = changes.round;
    if (future && !date) p.set('round', (changes.horizon ?? state.route.horizon) === 2 ? 'following' : 'next');
    else if (future && date) p.set('view', 'future');
    else if (allRounds) p.set('round', 'all');
    else if (state.catalog.roundsByLeague[league].includes(round)) p.set('round', String(round));
    if (date) p.set('date', date);
    history.pushState(null, '', routeUrl(p));
    state.route = routeFromUrl(state.catalog);
    dismissModal();
    render();
    if (changes.focus) $(changes.focus)?.focus();
  }

  function showDialog(html, labelledBy = 'dialog-title') {
    $('dialog-body').innerHTML = html;
    dialog.setAttribute('aria-labelledby', labelledBy);
    document.documentElement.classList.add('modal-open');
    if (!dialog.open) dialog.showModal();
  }

  function dismissModal() {
    modal = null;
    document.documentElement.classList.remove('modal-open');
    if (dialog.open) dialog.close();
  }

  function removeMatchFromUrl() {
    const p = routeParams();
    p.delete('match');
    p.set('league', state.route.league);
    if (state.route.future && !state.route.date) p.set('round', state.route.horizon === 2 ? 'following' : 'next');
    else if (state.route.allRounds) p.set('round', 'all');
    else if (state.route.round != null) p.set('round', String(state.route.round));
    history.replaceState(null, '', routeUrl(p));
    state.route = routeFromUrl(state.catalog);
  }

  function closeModal() {
    dismissModal();
    if (!state.route.match) return;
    if (history.state?.rate90Detail === detailSession) {
      state.route = { ...state.route, match: '' };
      history.back();
    } else {
      removeMatchFromUrl();
    }
  }

  function openDetails(id) {
    const m = state.catalog.byId.get(id);
    if (!m) return;
    const p = routeParams();
    p.set('league', state.route.league);
    if (state.route.future && !state.route.date) p.set('round', state.route.horizon === 2 ? 'following' : 'next');
    else if (state.route.allRounds) p.set('round', 'all');
    else if (state.route.round != null) p.set('round', String(state.route.round));
    p.set('match', m.id);
    history.pushState({ rate90Detail: detailSession }, '', routeUrl(p));
    state.route = routeFromUrl(state.catalog);
    openModal('details', m.id);
  }

  function openModal(type, id = '') {
    if (type !== 'details' && modal?.type === 'details' && state.route.match) {
      removeMatchFromUrl();
    }
    modal = { type, id };
    if (type === 'details') detailTab = { activeTab: 'lineups', pendingTab: '', tacticalSide: 'home' };
    dialog.dataset.view = type;
    renderModal();
    dialog.scrollTop = 0;
    const scroller = dialog.querySelector('.dialog-scroll');
    if (scroller) scroller.scrollTop = 0;
    if (!dialog.contains(document.activeElement)) dialog.querySelector('[data-act="close"]')?.focus();
    if (type === 'details') loadFacts(id);
  }

  function refreshFacts(id, focusSelection = false) {
    const m = state.catalog.byId.get(id);
    const box = $('match-facts');
    if (!m || !box) return;
    box.innerHTML = window.Rate90.renderMatchFacts(m, state.details.get(id), detailTab);
    if (focusSelection) {
      const selector = detailTab.pendingTab ? '[data-act="cancelPeek"]' : '[role="tab"][aria-selected="true"]';
      box.querySelector(selector)?.focus();
    }
  }

  async function loadFacts(id) {
    const m = state.catalog.byId.get(id);
    if (!m?.hasDetails || state.details.has(id) || state.pendingDetails.has(id)) return;
    state.pendingDetails.add(id);
    try {
      const [detail] = await Promise.all([loadMatchDetails(id), loadPlayersZh()]);
      state.details.set(id, detail);
      if (modal?.type === 'details' && modal.id === id) {
        refreshFacts(id);
      }
    } catch {
      if (modal?.type === 'details' && modal.id === id) {
        $('match-facts').innerHTML = '<p class="match-note">' + e(t('detailsLoadError')) + ' ' +
          '<button type="button" class="text-btn" data-act="retryDetails" data-val="' + e(id) + '">' + e(t('retryLoad')) + '</button></p>';
      }
    } finally {
      state.pendingDetails.delete(id);
    }
  }

  function restoreRoute(force = false) {
    if (!state.catalog) return;
    const previous = state.route;
    state.route = routeFromUrl(state.catalog);
    const listChanged = force || ['league', 'round', 'allRounds', 'date', 'future', 'horizon'].some(key => previous[key] !== state.route[key]);
    if (listChanged) render();
    const selected = state.catalog.byId.get(state.route.match);
    if (selected) openModal('details', selected.id);
    else if (listChanged || modal?.type === 'details') dismissModal();
  }

  function renderModal() {
    if (!modal) return;
    const { type, id } = modal;

    if (type === 'about') {
      showDialog(dialogHead(t('about')) +
        '<div class="about-copy"><p>' + e(t('aboutBody')) + '</p></div>');
      return;
    }

    if (type === 'method') {
      showDialog(dialogHead(t('method')) +
        '<div class="about-copy"><p>' + e(t('methodBody')) + '</p></div>');
      return;
    }

    if (type === 'details') {
      const m = state.catalog.byId.get(id);
      if (!m) { closeModal(); return; }

      const homeName = teamLabel(m.home);
      const awayName = teamLabel(m.away);
      const meta = [leagueShort(m.league), roundName(m.league, m.round), cnDate(m.date), m.time].filter(Boolean);
      const rated = Number.isFinite(m.rating);
      const heroTags = detailHeroTags(m);
      const facts = m.hasDetails && !state.details.has(m.id)
        ? '<p class="match-note" role="status">' + e(t('loadingDetails')) + '</p>'
        : window.Rate90.renderMatchFacts(m, state.details.get(m.id), detailTab);

      const tierCls = ratingTier(m.rating).cls;
      showDialog(
        '<div class="dialog-scroll">' +
          '<div class="detail-hero detail-hero-' + tierCls + (heroTags ? ' has-hero-tags' : '') + '">' +
            '<div class="detail-eyebrow">' + leagueIcon(m.league, 'detail-ic') + '<span class="detail-meta">' + e(meta.join(' · ')) + '</span></div>' +
            '<h2 id="dialog-title" class="sr">' + e(t('matchVs', { home: homeName, away: awayName })) + '</h2>' +
            '<div class="duel-stage">' +
              '<div class="duel-club">' + crest(m.home, 'lg') + '<b>' + e(homeName) + '</b></div>' +
              '<div class="detail-plaque ' + tierCls + '" aria-label="' + e(rated ? t('ratingAria', { score: m.rating.toFixed(1) }) : t('noRating')) + '">' +
                '<div class="plaque-num">' + (rated ? m.rating.toFixed(1) + '<small>/10</small>' : '—') + '</div></div>' +
              '<div class="duel-club">' + crest(m.away, 'lg') + '<b>' + e(awayName) + '</b></div>' +
            '</div>' +
            heroTags +
          '</div>' +
          '<div class="detail-content">' +
            '<div id="match-facts">' + facts + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-footer">' +
          '<div class="detail-footer-actions">' +
            '<button type="button" class="btn detail-confirm" data-act="close" autofocus>' + e(t('done')) + '</button>' +
          '</div>' +
        '</div>'
      );
    }
  }

  let copyTimer = null;

  async function copyMatchLink(matchId, button) {
    const m = state.catalog.byId.get(matchId);
    if (!m) return;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('league', m.league);
    url.searchParams.set('round', m.round);
    url.searchParams.set('match', m.id);
    try {
      await navigator.clipboard.writeText(url.href);
      if ($('share-feedback')) $('share-feedback').textContent = t('copiedLink');
      if (button) {
        morphTo(button, 'check', 'snappy');
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => morphTo(button, 'link', 'smooth'), 1800);
      }
    } catch {
      if ($('share-feedback')) $('share-feedback').textContent = url.href;
    }
  }

  dialog.addEventListener('toggle', ev => {
    const target = ev.target;
    if (target?.matches?.('details.match-disclosure')) {
      morphTo(target.querySelector(':scope > summary'), target.open ? 'down' : 'right', 'snappy');
    }
  }, true);

  dialog.addEventListener('cancel', ev => { ev.preventDefault(); closeModal(); });
  dialog.addEventListener('wheel', ev => {
    const scroller = ev.target.closest?.('.detail-panel, .modal-list, .dialog-inner');
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) {
      ev.preventDefault();
      return;
    }
    const atTop = scroller.scrollTop <= 0 && ev.deltaY < 0;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 && ev.deltaY > 0;
    if (atTop || atBottom) ev.preventDefault();
  }, { passive: false });
  dialog.addEventListener('click', ev => {
    if (ev.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) {
        closeModal();
      }
    }
  });

  function matchDayTiers(league) {
    const map = new Map();
    const list = league === 'all' ? state.catalog.matches : state.catalog.matches.filter(m => m.league === league);
    for (const m of list) {
      if (!m.date) continue;
      const cur = map.get(m.date);
      const next = Number.isFinite(m.rating) ? (m.rating >= 8 ? 3 : 2) : 1;
      if (!cur || next > cur) map.set(m.date, next);
    }
    const feed=state.catalog.prematch;
    const today=window.Rate90.upcoming.day({kickoff:Date.now()});
    if (feed) for (const g of [...feed.rounds.flatMap(r=>r.games),...(feed.extra||[])]) {
      const date=window.Rate90.upcoming.day(g);
      if ((league==='all' || league===g.league) && !map.has(date)) map.set(date, date > today ? 4 : 1);
    }
    return map;
  }

  function closeCalendar() {
    const pop = $('cal-popover');
    if (pop) pop.hidden = true;
    const trigger = document.querySelector('[data-act="toggleCal"]');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function closeRoundMenu() {
    const pop = $('round-popover');
    if (pop) pop.hidden = true;
    const trigger = $('round-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function toggleRoundMenu() {
    const pop = $('round-popover');
    const trigger = $('round-trigger');
    if (!pop || !trigger) return;
    const willOpen = pop.hidden;
    if (!willOpen) { closeRoundMenu(); return; }
    closeCalendar();
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const target = pop.querySelector('.round-opt.is-selected');
    target?.scrollIntoView?.({ block: 'nearest' });
  }

  function renderCalendar(year, month) {
    const pop = $('cal-popover');
    if (!pop || !state.catalog) return;
    pop.dataset.ym = year + '-' + month;
    const tiers = matchDayTiers(state.route.league);
    const selected = state.route.date;
    const first = new Date(Date.UTC(year, month, 1));
    const startPad = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const prev = new Date(Date.UTC(year, month - 1, 1));
    const next = new Date(Date.UTC(year, month + 1, 1));
    const prevVal = prev.getUTCFullYear() + '-' + String(prev.getUTCMonth() + 1).padStart(2, '0');
    const nextVal = next.getUTCFullYear() + '-' + String(next.getUTCMonth() + 1).padStart(2, '0');

    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push('<span class="cal-empty" aria-hidden="true"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const tier = tiers.get(ymd) || 0;
      const cls = ['cal-day', tier === 4 ? 'is-future' : tier === 3 ? 'is-high' : tier === 2 ? 'is-rated' : tier === 1 ? 'is-scheduled' : 'is-rest',
        ymd === selected ? 'is-selected' : ''].filter(Boolean).join(' ');
      const title = tier === 4 ? t('calTierFuture') : tier === 3 ? t('calTierHigh') : tier === 2 ? t('calTierRated') : tier === 1 ? t('calTierScheduled') : t('calTierRest');
      cells.push('<button type="button" class="' + cls + '" data-act="pickDate" data-val="' + ymd + '" title="' + ymd + ' · ' + e(title) + '">' +
        '<span>' + d + '</span>' + (tier ? '<i class="cal-dot" aria-hidden="true"></i>' : '') + '</button>');
    }

    const weekdays = (t('calWeekdays') || ['一', '二', '三', '四', '五', '六', '日'])
      .map(w => '<span>' + e(w) + '</span>').join('');
    const monthTitle = i18n ? i18n.formatMonthYear(year, month) : (year + '年 ' + (month + 1) + '月');

    pop.innerHTML =
      '<div class="cal-head">' +
        '<button type="button" class="cal-nav" data-act="calMonth" data-val="' + prevVal + '" aria-label="' + e(t('calPrevMonth')) + '">' + icon('left') + '</button>' +
        '<strong>' + e(monthTitle) + '</strong>' +
        '<button type="button" class="cal-nav" data-act="calMonth" data-val="' + nextVal + '" aria-label="' + e(t('calNextMonth')) + '">' + icon('right') + '</button>' +
      '</div>' +
      '<div class="cal-weekdays">' + weekdays + '</div>' +
      '<div class="cal-grid">' + cells.join('') + '</div>' +
      '<div class="cal-foot">' +
        '<span class="cal-legend"><i class="cal-swatch high"></i>8.0+</span>' +
        '<span class="cal-legend"><i class="cal-swatch rated"></i>' + e(t('calLegendRated')) + '</span>' +
        '<span class="cal-legend"><i class="cal-swatch future"></i>' + e(t('calLegendFuture')) + '</span>' +
        (selected ? '<button type="button" class="cal-clear" data-act="clearDate">' + e(t('calClear')) + '</button>' : '') +
      '</div>';
  }

  function toggleCalendar() {
    const pop = $('cal-popover');
    const trigger = document.querySelector('[data-act="toggleCal"]');
    if (!pop || !trigger) return;
    const willOpen = pop.hidden;
    if (!willOpen) { closeCalendar(); return; }
    closeRoundMenu();
    const seed = state.route.date || state.catalog.defaultMatchDate || new Date().toISOString().slice(0, 10);
    const [y, m] = seed.split('-').map(Number);
    renderCalendar(y, m - 1);
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (state.catalog.prematchFile && !state.catalog.prematch && !state.previewLoading) {
      state.previewLoading = true;
      window.Rate90.catalog.loadPrematch(state.catalog.prematchFile).then(data => {
        state.catalog.prematch = data;
        if (!pop.hidden && pop.dataset.ym) {
          const [cy, cm] = pop.dataset.ym.split('-').map(Number);
          renderCalendar(cy, cm);
        }
      }).catch(() => {}).finally(() => { state.previewLoading = false; });
    }
  }

  document.addEventListener('error', ev => {
    const img = ev.target;
    if (img?.tagName === 'IMG' && img.closest?.('.crest')) {
      const box = img.closest('.crest');
      box.classList.remove('has-img');
      box.classList.add('is-fallback');
      box.innerHTML = defaultCrestSvg();
    }
  }, true);

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if ($('round-popover')?.hidden === false) {
        closeRoundMenu();
        $('round-trigger')?.focus();
      } else if ($('cal-popover')?.hidden === false) {
        closeCalendar();
        document.querySelector('[data-act="toggleCal"]')?.focus();
      }
    }
  });

  document.addEventListener('click', async ev => {
    const pop = $('cal-popover');
    if (pop && !pop.hidden && !ev.target.closest('.date-picker-wrap')) closeCalendar();
    const rpop = $('round-popover');
    if (rpop && !rpop.hidden && !ev.target.closest('.round-jump')) closeRoundMenu();
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const { act, val } = btn.dataset;

    if (!state.catalog && act !== 'skip') return;
    switch (act) {
      case 'skip':
        ev.preventDefault();
        $('main').focus();
        break;
      case 'home':
        ev.preventDefault();
        navigate({ league: 'all', round: null, allRounds: false, date: '', future: false });
        break;
      case 'league':
        navigate({ league: val, round: null, allRounds: false, date: '', future: false });
        break;
      case 'retryPreview':
        state.previewError=false;
        render();
        break;
      case 'toggleRoundMenu':
        toggleRoundMenu();
        break;
      case 'pickRound':
        closeRoundMenu();
        chooseRound(val, 'round-trigger');
        break;
      case 'prevRound':
      case 'nextRound': {
        chooseRound(val, 'round-trigger');
        break;
      }
      case 'toggleCal':
        toggleCalendar();
        break;
      case 'calMonth': {
        const [y, m] = val.split('-').map(Number);
        const direction = btn.getAttribute('aria-label');
        renderCalendar(y, m - 1);
        $('cal-popover').querySelector('[aria-label="' + direction + '"]')?.focus();
        break;
      }
      case 'pickDate':
        closeCalendar();
        if (isValidDate(val)) navigate({date:val,focus:'cal-trigger'});
        break;
      case 'clearDate':
        closeCalendar();
        navigate({date:'',focus:'cal-trigger'});
        break;
      case 'details':
        openDetails(val);
        break;
      case 'method':
      case 'about':
        openModal(act);
        break;
      case 'detailTab':
        if (modal?.type === 'details') {
          if (val === 'lineups' || val === 'substitutes' || state.peeked.has(modal.id + '/' + val)) {
            detailTab = { ...detailTab, activeTab: val, pendingTab: '' };
          } else {
            detailTab = { ...detailTab, pendingTab: val };
          }
          refreshFacts(modal.id, true);
        }
        break;
      case 'confirmPeek':
        if (modal?.type === 'details' && val === detailTab.pendingTab && ['stats','events','tactics'].includes(val)) {
          state.peeked.add(modal.id + '/' + val);
          detailTab = { ...detailTab, activeTab: val, pendingTab: '' };
          refreshFacts(modal.id, true);
        }
        break;
      case 'tacticalSide':
        if (modal?.type === 'details' && detailTab.activeTab === 'tactics' && !detailTab.pendingTab &&
            (val === 'home' || val === 'away')) {
          detailTab.tacticalSide = val;
          refreshFacts(modal.id);
          $('match-facts').querySelector('[data-act="tacticalSide"][aria-pressed="true"]')?.focus();
        }
        break;
      case 'cancelPeek':
        if (modal?.type === 'details') {
          detailTab = { ...detailTab, pendingTab: '' };
          refreshFacts(modal.id, true);
        }
        break;
      case 'close':
        closeModal();
        break;
      case 'retryDetails':
        await loadFacts(val);
        break;
      case 'copyLink':
        await copyMatchLink(val, btn);
        break;
      case 'lang':
        state.lang = state.lang === 'zh' ? 'en' : 'zh';
        if (i18n) i18n.setLang(state.lang);
        if (routeParams().has('lang')) {
          const params=routeParams();
          params.set('lang',state.lang);
          history.replaceState(history.state,'',routeUrl(params));
        }
        railMounted = false;
        render();
        if (modal) renderModal();
        announce(t('langSwitched'));
        break;
      case 'theme':
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        writeStore('theme', state.theme);
        applyTheme();
        renderTopBar();
        break;
    }
  });

  function chooseRound(value, focus = 'round-picker') {
    if (value === 'next' || value === 'following') {
      navigate({ future: true, horizon: value === 'following' ? 2 : 1, focus });
      return;
    }
    if (value === 'all') {
      navigate({ allRounds: true, round: null, focus });
      return;
    }
    if (value === 'current') {
      navigate({ allRounds: false, round: null, focus });
      return;
    }
    const round = state.catalog.roundsByLeague[state.route.league].find(r => String(r) === value);
    if (round != null) navigate({ round, allRounds: false, focus });
  }

  document.addEventListener('change', ev => {
    if (ev.target.id==='date-picker' && (!ev.target.value || isValidDate(ev.target.value))) {
      navigate({date:ev.target.value,focus:'date-picker'});
    } else if (ev.target.id==='round-picker') chooseRound(ev.target.value);
  });

  window.addEventListener('popstate', () => restoreRoute());
  window.addEventListener('storage', ev => {
    if (!state.catalog) return;
    if (ev.key === 'rate90.v2.lang') {
      const next = readStore('lang', 'zh') === 'en' ? 'en' : 'zh';
      if (next !== state.lang) {
        state.lang = next;
        if (i18n) i18n.setLang(next);
        railMounted = false;
        render();
        if (modal) renderModal();
      }
    }
  });

  try {
    state.catalog = await loadCatalog();
    restoreRoute(true);
    loadPlayersZh().then(loaded => {
      if (loaded && modal?.type === 'details' && state.details.has(modal.id)) {
        refreshFacts(modal.id);
      }
    });
    if (state.catalog.prematchFile && !state.catalog.prematch && !state.previewLoading) {
      state.previewLoading = true;
      window.Rate90.catalog.loadPrematch(state.catalog.prematchFile).then(data => {
        state.catalog.prematch = data;
        render();
      }).catch(() => {}).finally(() => { state.previewLoading = false; });
    }
  } catch {
    $('view').innerHTML = '<div class="state-card">' + e(t('loadError')) + '</div>';
  }
})();
