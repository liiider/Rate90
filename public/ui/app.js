(async () => {
  'use strict';

  const {
    leagues,
    escapeHtml: e,
    readStore,
    writeStore,
    loadCatalog,
    loadMatchDetails,
    ratingTier,
    isValidDate,
    cnDate,
    roundName
  } = window.Rate90.catalog;

  const {
    icon,
    morphTo,
    defaultCrestSvg,
    leagueIcon,
    leagueRail,
    crest,
    detailHeroTags,
    watchLink,
    watchLabel,
    canWatch,
    miniMatchRow,
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
    const league = Object.hasOwn(leagues,requested) || requested === 'all' ? requested :
      (linkedMatch?.league ?? 'all');
    const round = catalog?.roundsByLeague[league]?.find(r => String(r) === p.get('round')) ??
      (!requested && linkedMatch && !isValidDate(p.get('date')) ? linkedMatch.round : null);
    const date = round == null && isValidDate(p.get('date')) ? p.get('date') : '';
    const roundChoice=p.get('round');
    const future=roundChoice==='next' || roundChoice==='following' || p.get('view')==='future' ||
      (date && date>window.Rate90.upcoming.day({kickoff:Date.now()}));
    return {league,round,date,future:Boolean(future),horizon:roundChoice==='following' || p.get('horizon')==='2'?2:1,match:p.get('match') || ''};
  }

  const state = {
    catalog: null,
    route: routeFromUrl(),
    watched: new Set(),
    peeked: new Set(),
    theme: readStore('theme', 'dark'),
    details: new Map(),
    pendingDetails: new Set()
  };

  let modal = null;
  let detailTab = { activeTab: 'lineups', pendingTab: '' };
  const detailSession = Math.random().toString(36).slice(2);

  function applyTheme() {
    const isDark = state.theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#050506' : '#F4F6FA');
  }

  applyTheme();

  function announce(msg) {
    $('live-status').textContent = msg;
  }

  let railMounted = false;
  let lastTopBarSig = '';

  function renderTopBar() {
    const count = watchedMatches().length;
    const isDark = state.theme === 'dark';
    const sig = count + ':' + isDark;
    if (sig === lastTopBarSig) return;
    const bar = $('top-actions');
    const firstMount = !lastTopBarSig;
    if (firstMount) {
      bar.innerHTML =
        '<button type="button" class="icon-btn" data-act="watched" title="看过" aria-label="看过">' +
          icon('history') + '<span class="icon-badge" hidden></span></button>' +
        '<button type="button" class="icon-btn" data-act="theme" aria-label="切换明暗主题">' +
          icon(isDark ? 'sun' : 'moon') + '</button>';
    }
    lastTopBarSig = sig;
    const badge = bar.querySelector('.icon-badge');
    badge.hidden = count === 0;
    badge.textContent = count || '';
    const themeButton = bar.querySelector('[data-act="theme"]');
    themeButton.title = isDark ? '切换浅色主题' : '切换深色主题';
    if (!firstMount) morphTo(themeButton, isDark ? 'sun' : 'moon', 'smooth');
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
    renderTopBar();
    syncLeagueRail(state.route.league);
    document.title = (leagues[state.route.league]?.short ?? '全部赛事') + ' · Rate90';
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
    p.set('league',league);
    const scopeOnly = changes.league != null && changes.date === undefined && changes.round === undefined && changes.future === undefined;
    const date = changes.date ?? (scopeOnly ? state.route.date : '');
    const round = scopeOnly ? state.route.round : changes.round;
    const future = changes.future ?? (scopeOnly && state.route.future);
    if (future && !date) p.set('round',(changes.horizon ?? state.route.horizon)===2?'following':'next');
    else if (future && date) p.set('view','future');
    else if (state.catalog.roundsByLeague[league].includes(round)) p.set('round',String(round));
    if (date) p.set('date',date);
    history.pushState(null,'',routeUrl(p));
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
    p.set('league',state.route.league);
    if (state.route.round != null) p.set('round',String(state.route.round));
    history.replaceState(null,'',routeUrl(p));
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
    p.set('league',state.route.league);
    if (state.route.round != null) p.set('round',String(state.route.round));
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
    if (type === 'details') detailTab = { activeTab: 'lineups', pendingTab: '' };
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
      state.details.set(id, await loadMatchDetails(id));
      if (modal?.type === 'details' && modal.id === id) {
        refreshFacts(id);
      }
    } catch {
      if (modal?.type === 'details' && modal.id === id) {
        $('match-facts').innerHTML = '<p class="match-note">详细资料读取失败。 ' +
          '<button type="button" class="text-btn" data-act="retryDetails" data-val="' + e(id) + '">重新读取</button></p>';
      }
    } finally {
      state.pendingDetails.delete(id);
    }
  }

  function watchedMatches() {
    return [...state.watched].reverse().map(id => state.catalog?.byId.get(id)).filter(m => m && canWatch(m));
  }

  function readWatched(fallback) {
    const data = readStore('watched', fallback);
    const ids = Array.isArray(data) ? data : [];
    return new Set(ids.filter(id => typeof id === 'string' && id).map(id => state.catalog.byId.get(id)?.id || id));
  }

  function setWatched(id, value) {
    const m = state.catalog.byId.get(id);
    if (!m || (value && !canWatch(m))) return;
    state.watched = readWatched([...state.watched]);
    if (value) state.watched.add(m.id);
    else state.watched.delete(m.id);
    writeStore('watched', [...state.watched]);
    syncWatched();
    announce(value ? '已加入看过' : '已从看过中移除');
  }

  function syncWatched() {
    renderTopBar();
    for (const link of document.querySelectorAll('a[data-act="watch"]')) {
      const m = state.catalog.byId.get(link.dataset.val);
      if (!m) continue;
      const watched = state.watched.has(m.id);
      if (link.classList.contains('is-watched') === watched) continue;
      link.classList.toggle('is-watched', watched);
      link.setAttribute('aria-label', watchLabel(m, watched));
      morphTo(link.querySelector('.watch-icon'), watched ? 'check' : 'external', 'snappy');
    }
    if (modal?.type === 'details') {
      const undo = $('undo-watch');
      const hadFocus = document.activeElement === undo;
      undo.hidden = !state.watched.has(modal.id);
      if (undo.hidden && hadFocus) dialog.querySelector('[data-act="watch"]')?.focus();
    } else if (modal?.type === 'watched') {
      renderModal();
      const next = dialog.querySelector('[data-act="removeWatched"]') || dialog.querySelector('[data-act="close"]');
      next?.focus();
    }
  }

  function restoreRoute(force = false) {
    if (!state.catalog) return;
    const previous = state.route;
    state.route = routeFromUrl(state.catalog);
    const listChanged = force || ['league', 'round', 'date','future','horizon'].some(key => previous[key] !== state.route[key]);
    if (listChanged) render();
    const selected = state.catalog.byId.get(state.route.match);
    if (selected) openModal('details', selected.id);
    else if (listChanged || modal?.type === 'details') dismissModal();
  }

  function renderModal() {
    if (!modal) return;
    const { type, id } = modal;

    if (type === 'watched') {
      const seen = watchedMatches();
      const rows = seen.map(m => '<div class="watch-history-row">' + miniMatchRow(m) +
        '<button type="button" class="icon-btn" data-act="removeWatched" data-val="' + e(m.id) + '" title="撤销看过" aria-label="撤销看过 ' +
        e(m.home.zh + ' 对 ' + m.away.zh) + '">' + icon('undo') + '</button></div>');
      showDialog(
        dialogHead('看过', seen.length + ' 场') + '<div class="modal-list">' +
        (rows.length ? rows.join('') : '<div class="state-card">暂无观看记录</div>') + '</div>'
      );
      return;
    }

    if (type === 'about') {
      showDialog(dialogHead('关于 Rate90') +
        '<div class="about-copy"><p>Rate90 是一份无剧透的足球回看指南，收录欧冠和五大联赛。选一轮比赛，看评分和推荐理由，再决定今晚看哪场。</p></div>');
      return;
    }

    if (type === 'method') {
      showDialog(dialogHead('评分方法') +
        '<div class="about-copy"><p>Rate90 不按最终比分或球队名气打分，而是依据全场过程数据从六个量化维度加权计分，满分 10 分。</p></div>');
      return;
    }

    if (type === 'details') {
      const m = state.catalog.byId.get(id);
      if (!m) { closeModal(); return; }

      const meta = [leagues[m.league].short, roundName(m.league, m.round), cnDate(m.date), m.time].filter(Boolean);
      const rated = Number.isFinite(m.rating);
      const watched = state.watched.has(m.id);
      const heroTags = detailHeroTags(m);
      const facts = m.hasDetails && !state.details.has(m.id)
        ? '<p class="match-note" role="status">正在读取本场资料…</p>'
        : window.Rate90.renderMatchFacts(m, state.details.get(m.id), detailTab);

      const tierCls = ratingTier(m.rating).cls;
      showDialog(
        '<div class="dialog-scroll">' +
          '<div class="detail-hero detail-hero-' + tierCls + (heroTags ? ' has-hero-tags' : '') + '">' +
            '<div class="detail-eyebrow">' + leagueIcon(m.league, 'detail-ic') + '<span class="detail-meta">' + e(meta.join(' · ')) + '</span></div>' +
            '<h2 id="dialog-title" class="sr">' + e(m.home.zh + ' 对 ' + m.away.zh) + '</h2>' +
            '<div class="duel-stage">' +
              '<div class="duel-club">' + crest(m.home, 'lg') + '<b>' + e(m.home.zh) + '</b></div>' +
              '<div class="detail-plaque ' + tierCls + '" aria-label="' + (rated ? '评分 ' + m.rating.toFixed(1) : '暂无评分') + '">' +
                '<div class="plaque-num">' + (rated ? m.rating.toFixed(1) + '<small>/10</small>' : '—') + '</div></div>' +
              '<div class="duel-club">' + crest(m.away, 'lg') + '<b>' + e(m.away.zh) + '</b></div>' +
            '</div>' +
            heroTags +
          '</div>' +
          '<div class="detail-content">' +
            '<div id="match-facts">' + facts + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="detail-footer">' +
          '<button type="button" id="undo-watch" class="btn detail-undo" data-act="removeWatched" data-val="' + e(m.id) + '"' +
            (watched ? '' : ' hidden') + '>' + icon('undo') + '撤销看过</button>' +
          '<div class="detail-footer-actions">' +
            watchLink(m, watched) +
            '<button type="button" class="btn detail-confirm" data-act="close" autofocus>确定</button>' +
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
      if ($('share-feedback')) $('share-feedback').textContent = '已复制无剧透比赛链接。';
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
      const title = tier === 4 ? '未来赛程' : tier === 3 ? '含 8.0+ 高分比赛' : tier === 2 ? '有已评分比赛' : tier === 1 ? '有赛程，暂无评分' : '无比赛日';
      cells.push('<button type="button" class="' + cls + '" data-act="pickDate" data-val="' + ymd + '" title="' + ymd + ' · ' + title + '">' +
        '<span>' + d + '</span>' + (tier ? '<i class="cal-dot" aria-hidden="true"></i>' : '') + '</button>');
    }

    pop.innerHTML =
      '<div class="cal-head">' +
        '<button type="button" class="cal-nav" data-act="calMonth" data-val="' + prevVal + '" aria-label="上个月">' + icon('left') + '</button>' +
        '<strong>' + year + '年 ' + (month + 1) + '月</strong>' +
        '<button type="button" class="cal-nav" data-act="calMonth" data-val="' + nextVal + '" aria-label="下个月">' + icon('right') + '</button>' +
      '</div>' +
      '<div class="cal-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>' +
      '<div class="cal-grid">' + cells.join('') + '</div>' +
      '<div class="cal-foot">' +
        '<span class="cal-legend"><i class="cal-swatch high"></i>8.0+</span>' +
        '<span class="cal-legend"><i class="cal-swatch rated"></i>已评</span>' +
        '<span class="cal-legend"><i class="cal-swatch future"></i>未来</span>' +
        (selected ? '<button type="button" class="cal-clear" data-act="clearDate">清除</button>' : '') +
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
        navigate({league:'all',date:'',future:false});
        break;
      case 'league':
        navigate({league:val});
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
      case 'watched':
      case 'about':
        openModal(act);
        break;
      case 'detailTab':
        if (modal?.type === 'details') {
          if (val === 'lineups' || val === 'substitutes' || state.peeked.has(modal.id)) {
            detailTab = { activeTab: val, pendingTab: '' };
          } else {
            detailTab = { activeTab: detailTab.activeTab, pendingTab: val };
          }
          refreshFacts(modal.id, true);
        }
        break;
      case 'confirmPeek':
        if (modal?.type === 'details' && val) {
          state.peeked.add(modal.id);
          detailTab = { activeTab: val, pendingTab: '' };
          refreshFacts(modal.id, true);
        }
        break;
      case 'cancelPeek':
        if (modal?.type === 'details') {
          detailTab = { activeTab: detailTab.activeTab, pendingTab: '' };
          refreshFacts(modal.id, true);
        }
        break;
      case 'close':
        closeModal();
        break;
      case 'retryDetails':
        await loadFacts(val);
        break;
      case 'watch':
        setWatched(val, true);
        break;
      case 'removeWatched':
        setWatched(val, false);
        break;
      case 'copyLink':
        await copyMatchLink(val, btn);
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
    if (value==='next' || value==='following') {
      navigate({future:true,horizon:value==='following'?2:1,focus});
      return;
    }
    const round=state.catalog.roundsByLeague[state.route.league].find(r=>String(r)===value);
    if (round!=null || value==='all') navigate({round,focus});
  }

  document.addEventListener('change', ev => {
    if (ev.target.id==='date-picker' && (!ev.target.value || isValidDate(ev.target.value))) {
      navigate({date:ev.target.value,focus:'date-picker'});
    } else if (ev.target.id==='round-picker') chooseRound(ev.target.value);
  });

  document.addEventListener('auxclick', ev => {
    const link = ev.target.closest('a[data-act="watch"]');
    if (ev.button === 1 && link) setWatched(link.dataset.val, true);
  });
  window.addEventListener('popstate', () => restoreRoute());
  window.addEventListener('storage', ev => {
    if (!state.catalog || (ev.key !== null && ev.key !== 'rate90.v2.watched')) return;
    state.watched = readWatched([]);
    syncWatched();
  });

  try {
    state.catalog = await loadCatalog();
    state.watched = readWatched([]);
    restoreRoute(true);
    if (state.catalog.prematchFile && !state.catalog.prematch && !state.previewLoading) {
      state.previewLoading = true;
      window.Rate90.catalog.loadPrematch(state.catalog.prematchFile).then(data => {
        state.catalog.prematch = data;
        render();
      }).catch(() => {}).finally(() => { state.previewLoading = false; });
    }
  } catch {
    $('view').innerHTML = '<div class="state-card">比赛数据加载失败，请刷新页面重试。</div>';
  }
})();
