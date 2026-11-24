(() => {
  'use strict';

  const {
    leagues,
    roundName,
    cnDate,
    dateSpan,
    weekdayLabel,
    nearestMatchDates,
    sortMatches,
    pickHeroIds,
    escapeHtml: e
  } = window.Rate90.catalog;

  const { icon, matchCard } = window.Rate90.components;

  function segControl(options, selected, act, label) {
    return '<div class="seg-group" role="group" aria-label="' + e(label) + '">' +
      options.map(([val, text]) => {
        const active = String(selected) === String(val);
        return '<button type="button" class="seg-btn' + (active ? ' active' : '') + '" aria-pressed="' + active + '" data-act="' + act + '" data-val="' + e(val) + '">' + e(text) + '</button>';
      }).join('') +
    '</div>';
  }

  function modeSwitch(currentView) {
    return segControl([['date', '按日期'], ['round', '按轮次'], ['all', '全部比赛']], currentView, 'view', '浏览方式');
  }

  function renderMatchCollection(list, showLeagueIcon) {
    const sorted = sortMatches(list);
    if (!sorted.length) return '';
    const heroIds = pickHeroIds(sorted);
    return '<div class="card-stack">' +
      sorted.map(m => matchCard(m, { showLeagueIcon, isHero: heroIds.has(m.id) })).join('') +
    '</div>';
  }

  function dateView(s) {
    const { league, date } = s.route;
    const scopedAll = s.catalog.matches.filter(m => league === 'all' || m.league === league);
    const scopedDates = [...new Set(scopedAll.map(m => m.date).filter(Boolean))].sort();
    const list = scopedAll.filter(m => m.date === date);
    const wd = weekdayLabel(date);

    let html = '<section class="filter-dock" aria-label="日期与模式筛选">' +
      modeSwitch('date') +
      '<span class="dock-divider" aria-hidden="true"></span>' +
      '<div class="date-nav">' +
        '<button type="button" class="step-btn" data-act="prevDay" aria-label="前一天" title="前一天">' + icon('left') + '</button>' +
        '<input class="date-input" id="date-picker" type="date" value="' + e(date) + '" aria-label="选择比赛日期">' +
        '<button type="button" class="step-btn" data-act="nextDay" aria-label="后一天" title="后一天">' + icon('right') + '</button>' +
      '</div>' +
      '<span class="dock-meta">' + e(wd) + ' · ' + list.length + ' 场</span>' +
    '</section>';

    if (!list.length) {
      const jumps = nearestMatchDates(date, scopedDates);
      const jumpHtml = jumps.map(d =>
        '<button type="button" class="btn" data-act="jumpDate" data-val="' + e(d) + '">跳到 ' + e(cnDate(d)) + ' (' + e(weekdayLabel(d)) + ')</button>'
      ).join('');
      return html + '<div class="state-card">' +
        '<p>' + e(cnDate(date)) + (league === 'all' ? '' : ' ' + e(leagues[league].short)) + '暂无已收录赛程。</p>' +
        (jumpHtml ? '<div class="empty-actions">' + jumpHtml + '</div>' : '') +
      '</div>';
    }

    return html + renderMatchCollection(list, league === 'all');
  }

  function roundView(s) {
    const { league, round } = s.route;
    const activeLeague = league === 'all' ? 'pl' : league;
    const l = leagues[activeLeague];
    const inLeague = s.catalog.matches.filter(m => m.league === activeLeague);
    const rounds = [...new Set(inLeague.map(m => m.round))].sort((a, b) => a - b);
    const hasPrev = rounds.includes(round - 1);
    const hasNext = rounds.includes(round + 1);
    const inRound = inLeague.filter(m => m.round === round);
    const span = dateSpan(inRound);

    let html = '<section class="filter-dock" aria-label="轮次与模式筛选">' +
      modeSwitch('round') +
      '<span class="dock-divider" aria-hidden="true"></span>' +
      '<div class="stepper">' +
        '<button type="button" class="step-btn" data-act="prevRound"' + (hasPrev ? '' : ' disabled') + ' aria-label="上一轮" title="上一轮">' + icon('left') + '</button>' +
        '<span class="step-label">' + e(roundName(activeLeague, round)) + '</span>' +
        '<button type="button" class="step-btn" data-act="nextRound"' + (hasNext ? '' : ' disabled') + ' aria-label="下一轮" title="下一轮">' + icon('right') + '</button>' +
      '</div>' +
      (span ? '<span class="dock-meta">' + icon('calendar') + e(span) + ' · ' + inRound.length + ' 场</span>' : '') +
    '</section>';

    if (!inRound.length) {
      return html + '<div class="state-card"><p>本轮暂无收录场次。</p></div>';
    }

    return html + renderMatchCollection(inRound, false);
  }

  function allView(s) {
    const { league } = s.route;
    const list = s.catalog.matches.filter(m => league === 'all' || m.league === league);
    const span = dateSpan(list);
    const ratedCount = list.filter(m => m.rating !== null).length;

    let html = '<section class="filter-dock" aria-label="全部比赛筛选">' +
      modeSwitch('all') +
      '<span class="dock-divider" aria-hidden="true"></span>' +
      '<span class="dock-meta">' + icon('calendar') + e(span) + ' · 共 ' + list.length + ' 场（已评 ' + ratedCount + ' 场）</span>' +
    '</section>';

    if (!list.length) {
      return html + '<div class="state-card"><p>暂无已收录场次。</p></div>';
    }

    return html + renderMatchCollection(list, league === 'all');
  }

  window.Rate90.views = { dateView, roundView, allView };
})();
