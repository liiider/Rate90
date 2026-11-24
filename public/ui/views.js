(() => {
  'use strict';
  const {leagues, roundName, dateSpan, sortMatches, pickHeroIds, escapeHtml: e} = window.Rate90.catalog;
  const {matchCard, leagueIcon, icon} = window.Rate90.components;

  function roundView({catalog, route, watched, previewError}) {
    const {league, round, date, future, horizon} = route;
    const all = league === 'all';
    const scope = all ? catalog.matches : catalog.matches.filter(m => m.league === league);
    // On a rest day, use the most recent matchday in the selected scope.
    const day = date && scope.reduce((latest,m) => m.date <= date && m.date > latest ? m.date : latest,'');
    const sections = [];
    for (const [id, rounds] of catalog.groups) {
      if (future) break;
      if (!all && id !== league) continue;
      for (const [value, games] of rounds) {
        if (round != null && value !== round) continue;
        if (date && !games.some(m => m.date === day)) continue;
        const latestPlayed = games.filter(m => m.status === 'finished').at(-1)?.date || '';
        sections.push({id, value, games, latestPlayed});
      }
    }
    sections.sort((a,b) => b.latestPlayed.localeCompare(a.latestPlayed) ||
      a.games[0].date.localeCompare(b.games[0].date) || a.id.localeCompare(b.id));

    const {cnDate} = window.Rate90.catalog;
    const rounds = catalog.roundsByLeague[league];
    const sharedRound = sections[0]?.value;
    const activeRound = round ?? (date && sections.every(section => section.value === sharedRound) ? sharedRound : null);
    const futureRounds = (!all && catalog.prematch)
      ? window.Rate90.upcoming.leagueRounds(catalog.prematch, league)
      : [];
    const futureRoundVals = new Set(futureRounds.map(r => r.round));
    const histRounds = !all
      ? rounds.filter(v => !(futureRoundVals.has(v) && !catalog.groups.get(league)?.get(v)?.some(m => m.status === 'finished')))
      : rounds;
    const hasPrematch = Boolean(catalog.prematchFile);
    const hasNext = all ? hasPrematch : (catalog.prematch ? Boolean(futureRounds[0]) : hasPrematch);
    const hasFollowing = all ? hasPrematch : (catalog.prematch ? Boolean(futureRounds[1]) : hasPrematch);
    const nextLabel = futureRounds[0]?.label || '即将开赛';
    const followingLabel = futureRounds[1]?.label || '后续赛程';

    const timeline = [...histRounds, ...(hasNext ? ['next'] : []), ...(hasFollowing ? ['following'] : [])];
    const currentKey = future && !date ? (horizon === 2 ? 'following' : 'next') : activeRound;
    const curIdx = currentKey != null ? timeline.indexOf(currentKey) : -1;
    const prevRound = curIdx > 0 ? timeline[curIdx - 1] : null;
    const nextRound = curIdx >= 0 && curIdx < timeline.length - 1 ? timeline[curIdx + 1] : null;

    const futureSections = future && catalog.prematch
      ? window.Rate90.upcoming.sections(catalog.prematch, route)
      : [];

    const options = histRounds.map(value =>
      '<option value="' + e(value) + '"' + (!future && value === round ? ' selected' : '') + '>' + e(roundName(league,value)) + '</option>').join('');
    const dateLabel = date ? date.replaceAll('-', '/') : '选择日期';
    const currentRoundLabel = future ? '按日期' : sections.length === 1
      ? roundName(sections[0].id, sections[0].value)
      : (activeRound != null && !all ? roundName(league, activeRound) : '当期各轮');
    const mergedHistory = !future && !all && sections.length === 1;
    const mergedFuture = future && !all && !date && futureSections.length === 1;
    const merged = mergedHistory || mergedFuture;

    let titleHtml = '';
    if (mergedHistory) {
      titleHtml = '<div class="dock-title">' + leagueIcon(league, 'dock-ic') +
        '<div class="dock-heading">' +
          '<h1>' + e(leagues[league].short) + '<span class="dock-sep" aria-hidden="true">·</span><span class="dock-round">' + e(roundName(league, sections[0].value)) + '</span></h1>' +
          '<span class="dock-span">' + e(dateSpan(sections[0].games)) + '</span>' +
        '</div></div>';
    } else if (mergedFuture) {
      const sec = futureSections[0];
      titleHtml = '<div class="dock-title">' + leagueIcon(league, 'dock-ic') +
        '<div class="dock-heading">' +
          '<h1>' + e(leagues[league].short) + '<span class="dock-sep" aria-hidden="true">·</span><span class="dock-round preview-round">' + e(sec.roundLabel) + '</span><span class="dock-badge-future">未开赛</span></h1>' +
          (sec.span ? '<span class="dock-span">' + e(sec.span) + '</span>' : '') +
        '</div></div>';
    } else if (future && date) {
      titleHtml = '<div class="dock-title">' + (!all ? leagueIcon(league, 'dock-ic') : '') +
        '<div class="dock-heading"><h1>' + e(all ? '全部赛事' : leagues[league].short) +
          '<span class="dock-sep" aria-hidden="true">·</span><span class="dock-round">' + e(cnDate(date)) + '</span>' +
          '<span class="dock-badge-future">未开赛</span></h1></div></div>';
    } else if (future) {
      titleHtml = '<div class="dock-title">' + (!all ? leagueIcon(league, 'dock-ic') : '') +
        '<div class="dock-heading"><h1>' + e(all ? '全部赛事' : leagues[league].short) +
          '<span class="dock-badge-future">' + (horizon === 2 ? followingLabel : nextLabel) + '</span></h1></div></div>';
    } else {
      titleHtml = '<div class="dock-title">' + (!all ? leagueIcon(league, 'dock-ic') : '') +
        '<div class="dock-heading"><h1>' + e(all ? '全部赛事' : leagues[league].short) + '</h1></div></div>';
    }
    const dock = '<div class="filter-dock round-dock' + (merged ? ' is-merged' : '') + (future ? ' is-future-dock' : '') + '">' + titleHtml +
      '<div class="dock-controls">' +
        '<div class="round-jump"><span class="sr">轮次跳转</span><span class="round-control">' +
          '<button type="button" class="round-nav-btn" data-act="prevRound"' + (prevRound != null ? ' data-val="' + e(prevRound) + '"' : ' disabled') + ' aria-label="前一轮" title="上一轮">' + icon('left') + '</button>' +
          '<select class="date-input" id="round-picker" aria-label="选择轮次">' +
          (date ? '<option value="" hidden disabled selected>' + e(currentRoundLabel) + '</option>' : '') +
          '<option value="all"' + (!future && !date && round == null ? ' selected' : '') + '>全部轮次</option>' +
          options +
          (hasNext ? '<option value="next"' + (future && !date && horizon===1 ? ' selected' : '') + '>' + e(nextLabel) + '</option>' : '') +
          (hasFollowing ? '<option value="following"' + (future && !date && horizon===2 ? ' selected' : '') + '>' + e(followingLabel) + '</option>' : '') +
          '</select>' +
          '<button type="button" class="round-nav-btn" data-act="nextRound"' + (nextRound != null ? ' data-val="' + e(nextRound) + '"' : ' disabled') + ' aria-label="后一轮" title="下一轮">' + icon('right') + '</button>' +
        '</span></div>' +
        '<div class="round-date"><label class="sr" for="date-picker">日期跳转</label>' +
          '<div class="date-picker-wrap">' +
            '<button type="button" class="date-input date-trigger' + (date ? ' has-value' : '') + '" id="cal-trigger" data-act="toggleCal" aria-expanded="false" aria-haspopup="dialog" aria-controls="cal-popover">' +
              icon('calendar') + '<span>' + e(dateLabel) + '</span>' +
            '</button>' +
            '<input class="sr-date-input" id="date-picker" type="date" value="' + e(date) + '" tabindex="-1">' +
            '<div class="cal-popover" id="cal-popover" hidden role="dialog" aria-label="选择比赛日期"></div>' +
          '</div>' +
        '</div>' +
      '</div></div>';
    if (future) {
      if (!catalog.prematch) return dock + (previewError ?
        '<p class="state-card">赛程读取失败。 <button class="text-btn" data-act="retryPreview">重新读取</button></p>' :
        '<p class="state-card">正在读取未来赛程…</p>');
      return dock + window.Rate90.upcoming.view(catalog, futureSections, { merged: mergedFuture, showLeagueIcon: all && Boolean(date) });
    }
    if (!sections.length) return dock + '<p class="state-card">暂无对应赛程。</p>';
    return dock + sections.map(({id,value,games}) => {
      const sorted = sortMatches(games), heroes = pickHeroIds(sorted);
      const heading = merged ? '' :
        '<header class="round-heading">' + leagueIcon(id, 'heading-ic') + '<h2>' + e(leagues[id].short + ' · ' + roundName(id,value)) +
        '</h2><span>' + e(dateSpan(games)) + '</span></header>';
      return '<section class="round-group' + (merged ? ' is-merged-group' : '') + '" data-league="' + id + '" data-round="' + e(value) + '">' +
        heading + '<div class="card-stack">' +
        sorted.map(m => matchCard(m,{showLeagueIcon:false,isHero:heroes.has(m.id),watched:watched.has(m.id)})).join('') + '</div></section>';
    }).join('');
  }
  window.Rate90.views = {roundView};
})();
