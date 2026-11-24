(async () => {
  'use strict';

  const {
    defaultMatchDate,
    leagues,
    escapeHtml: e,
    readStore,
    writeStore,
    loadCatalog,
    loadMatchDetails,
    loadViewingProfile,
    ratingTier,
    dayOffset,
    isValidDate,
    cnDate,
    roundName,
    venueFor
  } = window.Rate90.catalog;

  const {
    icon,
    leagueRail,
    crest,
    viewingPreview,
    miniMatchRow,
    dialogHead,
    revealedEvidence
  } = window.Rate90.components;

  const { dateView, roundView, allView } = window.Rate90.views;

  const $ = id => document.getElementById(id);
  const dialog = $('overlay');
  const localFile = location.protocol === 'file:';

  const routeParams = () => new URLSearchParams(localFile ? location.hash.slice(1) : location.search);

  function routeFromUrl(catalog = null) {
    const p = routeParams();
    const rawView = p.get('view');
    const view = ['date', 'round', 'all'].includes(rawView) ? rawView : 'date';

    let league = p.get('league');
    if (view === 'round') {
      if (!Object.hasOwn(leagues, league)) league = 'pl';
    } else if (!Object.hasOwn(leagues, league)) {
      league = 'all';
    }

    const roundLeague = Object.hasOwn(leagues, league) ? league : 'pl';
    const fallbackRound = catalog ? catalog.latestRatedRound[roundLeague] : leagues[roundLeague].round;
    const requested = Number(p.get('round'));
    const validRound = catalog
      ? catalog.matches.some(m => m.league === roundLeague && m.round === requested)
      : Math.abs(requested - fallbackRound) <= 1;

    const rawDate = p.get('date');
    const date = isValidDate(rawDate) ? rawDate : defaultMatchDate;

    return {
      view,
      league,
      round: validRound ? requested : fallbackRound,
      date,
      match: p.get('match') || ''
    };
  }

  const state = {
    catalog: null,
    route: routeFromUrl(),
    bookmarks: new Set(readStore('bookmarks', [])),
    theme: readStore('theme', 'light'),
    revealed: new Set(),
    previews: new Map(),
    details: new Map(),
    loadingDetail: new Set(),
    detailError: new Set()
  };

  let modal = null;

  function applyTheme() {
    const isDark = state.theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#0B0D0C' : '#F5F3ED');
  }

  applyTheme();

  function announce(msg) {
    $('live-status').textContent = msg;
  }

  let railMounted = false;
  let lastTopBarSig = '';

  function renderTopBar() {
    const count = state.bookmarks.size;
    const isDark = state.theme === 'dark';
    const sig = count + ':' + isDark;
    if (sig === lastTopBarSig) return;
    lastTopBarSig = sig;
    $('top-actions').innerHTML =
      '<button type="button" class="icon-btn" data-act="search" title="搜索球队 (Ctrl K)" aria-label="搜索球队">' + icon('search') + '</button>' +
      '<button type="button" class="icon-btn" data-act="bookmarks" title="我的收藏" aria-label="我的收藏">' +
        icon(count ? 'bookmarkFilled' : 'bookmark') +
        (count ? '<span class="icon-badge">' + count + '</span>' : '') +
      '</button>' +
      '<button type="button" class="icon-btn" data-act="theme" title="' + (isDark ? '切换浅色画报主题' : '切换深色炭黑主题') + '" aria-label="切换明暗主题">' +
        icon(isDark ? 'sun' : 'moon') +
      '</button>';
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
    const { view, league, date } = state.route;
    syncLeagueRail(league);

    const viewTitle = view === 'round'
      ? leagues[league === 'all' ? 'pl' : league].short + '轮次'
      : view === 'all'
        ? (league === 'all' ? '全部比赛' : leagues[league].short)
        : cnDate(date);
    document.title = viewTitle + ' · Rate90';

    const views = { date: dateView, round: roundView, all: allView };
    $('view').innerHTML = views[view](state);
  }

  function navigate(changes, push = true) {
    const p = routeParams();
    const nextView = changes.view || state.route.view;
    p.set('view', nextView);
    p.delete('match');

    let nextLeague = changes.league !== undefined ? changes.league : state.route.league;
    if (nextView === 'round' && nextLeague === 'all') nextLeague = 'pl';
    if (nextLeague === 'all' || !nextLeague) p.delete('league');
    else p.set('league', nextLeague);

    if (nextView === 'date') {
      const nextDate = changes.date || state.route.date || defaultMatchDate;
      p.set('date', nextDate);
      p.delete('round');
    } else if (nextView === 'round') {
      p.delete('date');
      if (changes.round != null) p.set('round', String(changes.round));
      else if (changes.league && changes.league !== state.route.league) p.delete('round');
    } else {
      p.delete('date');
      p.delete('round');
    }

    if (push) {
      const qs = p.toString();
      history.pushState(null, '', qs ? (localFile ? '#' : '?') + qs : location.pathname);
    }

    const prevView = state.route.view;
    state.route = routeFromUrl(state.catalog);
    closeModal();
    render();
    if (prevView !== state.route.view) window.scrollTo(0, 0);
  }

  function showDialog(html, labelledBy = 'dialog-title') {
    $('dialog-body').innerHTML = html;
    dialog.setAttribute('aria-labelledby', labelledBy);
    if (!dialog.open) dialog.showModal();
  }

  function closeModal() {
    modal = null;
    if (dialog.open) dialog.close();
  }

  function openModal(type, id = '') {
    modal = { type, id };
    renderModal();
    if (type === 'search') $('team-query')?.focus();
    if (type === 'details') ensurePreview(id);
  }

  async function ensurePreview(matchId) {
    const m = state.catalog?.byId.get(matchId);
    if (!m || !m.hasPreview || state.previews.has(m.id)) return;
    try {
      const viewing = await loadViewingProfile(m.id);
      state.previews.set(m.id, viewing);
      if (modal?.type === 'details' && modal.id === matchId) renderModal();
    } catch {}
  }

  function teamSearchList(query) {
    const q = query.trim().toLowerCase();
    const list = (q
      ? state.catalog.teams.filter(t => (t.zh + ' ' + t.en).toLowerCase().includes(q))
      : state.catalog.teams.slice(0, 16)
    ).slice(0, 40);

    if (!list.length) {
      return '<div class="state-card">没有找到匹配的球队。</div>';
    }
    return list.map(t =>
      '<button type="button" class="team-option" data-act="team" data-val="' + e(t.id) + '">' +
        crest(t, 'sm') + '<b>' + e(t.zh) + '</b><small>' + e(t.en) + '</small>' +
      '</button>'
    ).join('');
  }

  function renderModal() {
    if (!modal) return;
    const { type, id } = modal;

    if (type === 'search') {
      showDialog(
        dialogHead('搜索球队', '欧冠与五大联赛') +
        '<input class="search-input" id="team-query" type="search" placeholder="输入中文或英文队名，如 曼联、Real Madrid" aria-label="搜索球队">' +
        '<div class="modal-list" id="search-results">' + teamSearchList('') + '</div>'
      );
      return;
    }

    if (type === 'team') {
      const t = state.catalog.team(id);
      const matches = state.catalog.matches
        .filter(m => m.home.id === id || m.away.id === id)
        .sort((a, b) => b.date.localeCompare(a.date));

      showDialog(
        dialogHead(t.zh, t.en) +
        '<div class="modal-list">' +
          (matches.length ? matches.map(miniMatchRow).join('') : '<div class="state-card">暂无已收录比赛。</div>') +
        '</div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="text-btn" data-act="search">← 返回搜索</button>' +
        '</div>'
      );
      return;
    }

    if (type === 'bookmarks') {
      const saved = [...state.bookmarks].map(mid => state.catalog.byId.get(mid)).filter(Boolean);
      showDialog(
        dialogHead('我的收藏', saved.length + ' 场待看') +
        '<div class="modal-list">' +
          (saved.length ? saved.map(miniMatchRow).join('') : '<div class="state-card">还没有收藏比赛。打开任意场次详情即可加入待看。</div>') +
        '</div>'
      );
      return;
    }

    if (type === 'about') {
      showDialog(
        dialogHead('关于本站') +
        '<div class="about-copy">' +
          '<p><strong>先看评分，再决定是否回看。</strong>用 0–10 评分呈现欧冠与欧洲五大联赛的比赛观赏价值，默认隐藏全部比分，让你在不被剧透的前提下挑选值得花 90 分钟的场次。</p>' +
          '<p><strong>静态评分快照。</strong>当前收录 2026/27 赛季共 198 场赛程（含 95 场已评比赛与 103 场未开赛赛程），比分仅在你主动点击揭晓后按需读取。部分重点场次揭晓后还附带每 15 分钟射门节奏与 xG 参考。</p>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<a class="btn" href="./world-cup-2022.html">2022 世界杯历史样本 ' + icon('external') + '</a>' +
        '</div>'
      );
      return;
    }

    if (type === 'details') {
      const m = state.catalog.byId.get(id);
      if (!m) { closeModal(); return; }

      const l = leagues[m.league];
      const tier = ratingTier(m.rating);
      const upcoming = m.rating === null;
      const saved = state.bookmarks.has(m.id);
      const shown = state.revealed.has(m.id);
      const loading = state.loadingDetail.has(m.id);
      const hasErr = state.detailError.has(m.id);
      const details = state.details.get(m.id);
      const [venueName, venueUrl] = venueFor(m.league);

      const metaParts = [l.short, roundName(m.league, m.round), cnDate(m.date)];
      if (m.time) metaParts.push(m.time);

      const centerPlaque = upcoming
        ? '<div class="detail-plaque upcoming"><div class="plaque-num">—</div></div>'
        : '<div class="detail-plaque ' + tier.cls + '"><div class="plaque-num">' + m.rating.toFixed(1) + '<small>/10</small></div></div>';

      let revealArea = '';
      if (upcoming) {
        revealArea = '<div class="reveal-muted">本场比赛尚未开赛</div>';
      } else if (shown && details) {
        revealArea = '<div class="reveal-opened">' + revealedEvidence(details) + '</div>';
      } else {
        revealArea = '<button type="button" class="reveal-shield" data-act="reveal" data-val="' + e(m.id) + '"' + (loading ? ' disabled' : '') + '>' +
          '<span class="shield-icon">' + icon('eye') + '</span>' +
          '<span class="shield-title">' + (loading ? '正在读取赛果…' : hasErr ? '读取失败，点击重试' : '点击揭晓比分') + '</span>' +
          '<span class="shield-sub">比分默认隐藏 · 揭晓后可随时重新收起</span>' +
        '</button>';
      }

      const previewHtml = viewingPreview(state.previews.get(m.id), m.styles);

      showDialog(
        '<div class="detail-bar">' +
          '<span class="detail-meta" id="dialog-title">' + e(metaParts.join(' · ')) + '</span>' +
          '<button type="button" class="icon-btn" data-act="close" aria-label="关闭" title="关闭">' + icon('close') + '</button>' +
        '</div>' +
        '<div class="duel-stage">' +
          '<div class="duel-club">' + crest(m.home, 'lg') + '<b>' + e(m.home.zh) + '</b></div>' +
          centerPlaque +
          '<div class="duel-club">' + crest(m.away, 'lg') + '<b>' + e(m.away.zh) + '</b></div>' +
        '</div>' +
        previewHtml +
        revealArea +
        '<div class="modal-actions">' +
          '<a class="btn primary" href="' + venueUrl + '" target="_blank" rel="noreferrer">前往' + e(venueName) + ' ' + icon('external') + '</a>' +
          '<button type="button" class="btn' + (saved ? ' active-soft' : '') + '" data-act="toggleBookmark" data-val="' + e(m.id) + '">' +
            icon(saved ? 'bookmarkFilled' : 'bookmark') + (saved ? '已收藏' : '收藏') +
          '</button>' +
          (localFile ? '' : '<button type="button" class="btn push" data-act="copyLink" data-val="' + e(m.id) + '">' + icon('link') + '复制链接</button>') +
        '</div>' +
        '<div id="share-feedback" class="feedback-line" role="status"></div>'
      );
    }
  }

  async function revealMatch(matchId) {
    const m = state.catalog.byId.get(matchId);
    if (!m || m.rating === null || state.loadingDetail.has(matchId)) return;
    if (state.details.has(matchId)) {
      state.revealed.add(matchId);
      renderModal();
      return;
    }

    state.loadingDetail.add(matchId);
    state.detailError.delete(matchId);
    renderModal();

    try {
      const data = await loadMatchDetails(matchId);
      state.details.set(matchId, data);
      state.revealed.add(matchId);
    } catch {
      state.detailError.add(matchId);
    } finally {
      state.loadingDetail.delete(matchId);
      renderModal();
    }
  }

  async function copyMatchLink(matchId) {
    const m = state.catalog.byId.get(matchId);
    if (!m) return;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('view', 'date');
    url.searchParams.set('date', m.date);
    url.searchParams.set('match', m.id);
    try {
      await navigator.clipboard.writeText(url.href);
      if ($('share-feedback')) $('share-feedback').textContent = '已复制无剧透比赛链接。';
    } catch {
      if ($('share-feedback')) $('share-feedback').textContent = url.href;
    }
  }

  function stepCurrent(delta) {
    const { view, league, round, date } = state.route;
    if (view === 'date') {
      navigate({ view: 'date', date: dayOffset(date, delta) });
      return;
    }
    if (view === 'round') {
      const target = round + delta;
      if (state.catalog.matches.some(m => m.league === league && m.round === target)) {
        navigate({ view: 'round', league, round: target });
      }
    }
  }

  dialog.addEventListener('cancel', () => { modal = null; });
  dialog.addEventListener('click', ev => {
    if (ev.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) {
        closeModal();
      }
    }
  });

  document.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const { act, val } = btn.dataset;

    switch (act) {
      case 'home':
        ev.preventDefault();
        navigate({ view: 'date', league: 'all', date: defaultMatchDate });
        break;
      case 'view':
        navigate({ view: val });
        break;
      case 'league':
        if (val === 'all' && state.route.view === 'round') {
          navigate({ view: 'date', league: 'all' });
        } else {
          navigate({ league: val });
        }
        break;
      case 'prevDay':
        stepCurrent(-1);
        break;
      case 'nextDay':
        stepCurrent(1);
        break;
      case 'jumpDate':
        navigate({ view: 'date', date: val });
        break;
      case 'prevRound':
        stepCurrent(-1);
        break;
      case 'nextRound':
        stepCurrent(1);
        break;
      case 'details':
        openModal('details', val);
        break;
      case 'team':
        openModal('team', val);
        break;
      case 'search':
      case 'bookmarks':
      case 'about':
        openModal(act);
        break;
      case 'close':
        closeModal();
        break;
      case 'reveal':
        await revealMatch(val);
        break;
      case 'hideScore':
        if (modal?.id) {
          state.revealed.delete(modal.id);
          renderModal();
        }
        break;
      case 'toggleBookmark':
        if (state.bookmarks.has(val)) {
          state.bookmarks.delete(val);
          announce('已取消收藏');
        } else {
          state.bookmarks.add(val);
          announce('已加入收藏');
        }
        writeStore('bookmarks', [...state.bookmarks]);
        renderTopBar();
        renderModal();
        break;
      case 'copyLink':
        await copyMatchLink(val);
        break;
      case 'theme':
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        writeStore('theme', state.theme);
        applyTheme();
        renderTopBar();
        break;
    }
  });

  document.addEventListener('change', ev => {
    if (ev.target.id === 'date-picker' && isValidDate(ev.target.value)) {
      navigate({ view: 'date', date: ev.target.value });
    }
  });

  document.addEventListener('input', ev => {
    if (ev.target.id === 'team-query') {
      const box = $('search-results');
      if (box) box.innerHTML = teamSearchList(ev.target.value);
    }
  });

  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      openModal('search');
      return;
    }
    if (dialog.open || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepCurrent(-1); }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); stepCurrent(1); }
  });

  window.addEventListener('popstate', () => {
    state.route = routeFromUrl(state.catalog);
    closeModal();
    render();
  });

  try {
    state.catalog = await loadCatalog();
    state.route = routeFromUrl(state.catalog);
    render();
    if (state.route.match && state.catalog.byId.has(state.route.match)) {
      openModal('details', state.route.match);
    }
  } catch {
    $('view').innerHTML = '<div class="state-card">比赛数据加载失败，请刷新页面重试。</div>';
  }
})();
