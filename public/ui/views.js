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

    const rounds = catalog.roundsByLeague[league];
    const sharedRound = sections[0]?.value;
    const activeRound = round ?? (date && sections.every(section => section.value === sharedRound) ? sharedRound : null);
    const roundIdx = activeRound != null ? rounds.indexOf(activeRound) : -1;
    const prevRound = future && !date && horizon === 2 ? 'next' : roundIdx > 0 ? rounds[roundIdx - 1] : null;
    const nextRound = future && !date && horizon === 1 ? 'following' : roundIdx >= 0 && roundIdx < rounds.length - 1 ? rounds[roundIdx + 1] : null;

    const options = rounds.map(value =>
      '<option value="' + e(value) + '"' + (value === round ? ' selected' : '') + '>' + e(roundName(league,value)) + '</option>').join('');
    const dateLabel = date ? date.replaceAll('-', '/') : '选择日期';
    const currentRoundLabel = future ? '按日期' : sections.length === 1
      ? roundName(sections[0].id, sections[0].value)
      : (activeRound != null && !all ? roundName(league, activeRound) : '当期各轮');
    const merged = !all && sections.length === 1;
    const titleHtml = merged
      ? '<div class="dock-title">' + leagueIcon(league, 'dock-ic') +
          '<div class="dock-heading">' +
            '<h1>' + e(leagues[league].short) + '<span class="dock-sep" aria-hidden="true">·</span><span class="dock-round">' + e(roundName(league, sections[0].value)) + '</span></h1>' +
            '<span class="dock-span">' + e(dateSpan(sections[0].games)) + '</span>' +
          '</div></div>'
      : '<div class="dock-title">' + (!all ? leagueIcon(league, 'dock-ic') : '') +
          '<div class="dock-heading"><h1>' + e(all ? '全部赛事' : leagues[league].short) + '</h1></div></div>';
    const dock = '<div class="filter-dock round-dock' + (merged ? ' is-merged' : '') + '">' + titleHtml +
      '<div class="dock-controls">' +
        '<div class="round-jump"><span class="sr">轮次跳转</span><span class="round-control">' +
          '<button type="button" class="round-nav-btn" data-act="prevRound"' + (prevRound != null ? ' data-val="' + e(prevRound) + '"' : ' disabled') + ' aria-label="前一轮" title="前一轮">' + icon('left') + '</button>' +
          '<select class="date-input" id="round-picker" aria-label="选择轮次">' +
          (date ? '<option value="" hidden disabled selected>' + e(currentRoundLabel) + '</option>' : '') +
          '<option value="all"' + (!future && !date && round == null ? ' selected' : '') + '>全部轮次</option>' +
          '<option value="next"' + (future && !date && horizon===1 ? ' selected' : '') + '>下一轮</option>' +
          '<option value="following"' + (future && !date && horizon===2 ? ' selected' : '') + '>下下轮</option>' + options + '</select>' +
          '<button type="button" class="round-nav-btn" data-act="nextRound"' + (nextRound != null ? ' data-val="' + e(nextRound) + '"' : ' disabled') + ' aria-label="后一轮" title="后一轮">' + icon('right') + '</button>' +
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
      return dock + window.Rate90.upcoming.view(catalog,window.Rate90.upcoming.sections(catalog.prematch,route));
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
