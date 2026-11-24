(() => {
  'use strict';
  const {leagues, roundName, dateSpan, cnDate, sortMatches, pickHeroIds, escapeHtml: e} = window.Rate90.catalog;
  const {matchCard, leagueIcon, icon, canWatch} = window.Rate90.components;

  function seasonInfo(games) {
    const playable = games.filter(canWatch);
    const dates = playable.map(m => m.date).filter(Boolean).sort();
    if (!dates.length) return { season: '全部轮次', span: '' };
    const y = Number(dates[0].slice(0, 4));
    const mo = Number(dates[0].slice(5, 7));
    const startYear = mo >= 7 ? y : y - 1;
    return {
      season: startYear + '/' + String((startYear + 1) % 100).padStart(2, '0') + ' 赛季',
      span: dateSpan(playable)
    };
  }

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
    const futureRounds = (!all && catalog.prematch)
      ? window.Rate90.upcoming.leagueRounds(catalog.prematch, league)
      : [];
    const futureRoundVals = new Set(futureRounds.map(r => r.round));
    const histRounds = !all
      ? rounds.filter(v => !(futureRoundVals.has(v) && !catalog.groups.get(league)?.get(v)?.some(canWatch)))
      : rounds;
    const currentPlayedRound = !all
      ? ([...histRounds].reverse().find(v => catalog.groups.get(league)?.get(v)?.some(canWatch)) ?? histRounds.at(-1) ?? null)
      : null;
    const hasPrematch = Boolean(catalog.prematchFile);
    const hasNext = all ? hasPrematch : (catalog.prematch ? Boolean(futureRounds[0]) : hasPrematch);
    const hasFollowing = all ? hasPrematch : (catalog.prematch ? Boolean(futureRounds[1]) : hasPrematch);
    const nextLabel = futureRounds[0]?.label || '即将开赛';
    const followingLabel = futureRounds[1]?.label || '后续赛程';

    const timeline = [...histRounds, ...(hasNext ? ['next'] : []), ...(hasFollowing ? ['following'] : [])];
    const currentKey = future && !date ? (horizon === 2 ? 'following' : 'next') : activeRound;
    const curIdx = currentKey != null ? timeline.indexOf(currentKey) : -1;
    const isAllRounds = !future && !date && round == null;
    const curPlayedIdx = currentPlayedRound != null ? timeline.indexOf(currentPlayedRound) : -1;
    const prevRound = isAllRounds
      ? (curPlayedIdx > 0 ? timeline[curPlayedIdx - 1] : null)
      : (curIdx > 0 ? timeline[curIdx - 1] : null);
    const nextRound = isAllRounds
      ? (hasNext ? 'next' : null)
      : (curIdx >= 0 && curIdx < timeline.length - 1 ? timeline[curIdx + 1] : null);

    const futureSections = future && catalog.prematch
      ? window.Rate90.upcoming.sections(catalog.prematch, route)
      : [];
    const futureSpan = futureSections.length
      ? (() => {
          const days = futureSections.flatMap(s => s.games).map(window.Rate90.upcoming.day).filter(Boolean).sort();
          if (!days.length) return '';
          const first = cnDate(days[0]), last = cnDate(days.at(-1));
          return first === last ? first : first + ' – ' + last;
        })()
      : '';

    const descHistRounds = [...histRounds].reverse();
    const options = descHistRounds.map(value =>
      '<option value="' + e(value) + '"' + (!future && !date && value === round ? ' selected' : '') + '>' + e(roundName(league, value)) + '</option>').join('');
    const dateLabel = date ? date.replaceAll('-', '/') : '选择日期';
    const currentRoundLabel = future ? '按日期' : sections.length === 1
      ? roundName(sections[0].id, sections[0].value)
      : (activeRound != null && !all ? roundName(league, activeRound) : '当期各轮');
    const roundTriggerLabel = date ? currentRoundLabel
      : future ? (horizon === 2 ? followingLabel : nextLabel)
      : round != null ? roundName(league, round)
      : '全部轮次';
    const mergedHistory = !future && !all && sections.length === 1;
    const mergedFuture = future && !all && !date && futureSections.length === 1;
    const merged = mergedHistory || mergedFuture;

    const scopeTitle = all ? '全部赛事' : leagues[league].short;
    const dockIcon = !all ? leagueIcon(league, 'dock-ic') : '';
    let subTitle = '';
    let subRoundCls = 'dock-round';
    let futureBadge = '';
    let dockSpan = '';

    if (mergedHistory) {
      subTitle = roundName(league, sections[0].value);
      dockSpan = dateSpan(sections[0].games);
    } else if (mergedFuture) {
      const sec = futureSections[0];
      subTitle = sec.roundLabel;
      subRoundCls = 'dock-round preview-round';
      futureBadge = '<span class="dock-badge-future">未开赛</span>';
      dockSpan = sec.span || '未来赛程';
    } else if (future && date) {
      subTitle = cnDate(date);
      futureBadge = '<span class="dock-badge-future">未开赛</span>';
      const count = futureSections.reduce((sum, s) => sum + s.games.length, 0);
      dockSpan = count ? count + ' 场未开赛' : '未来赛程';
    } else if (future) {
      subTitle = horizon === 2 ? followingLabel : nextLabel;
      futureBadge = '<span class="dock-badge-future">未开赛</span>';
      dockSpan = futureSpan || '未来赛程';
    } else if (isAllRounds) {
      const info = seasonInfo(scope);
      subTitle = info.season;
      dockSpan = info.span || dateSpan(scope);
    } else if (date) {
      subTitle = cnDate(date);
      dockSpan = dateSpan(sections.flatMap(s => s.games)) || cnDate(date);
    } else if (round != null) {
      subTitle = roundName(league, round);
      dockSpan = dateSpan(sections.flatMap(s => s.games));
    } else {
      const info = seasonInfo(scope);
      subTitle = info.season;
      dockSpan = info.span;
    }

    const titleHtml = '<div class="dock-title">' + dockIcon +
      '<div class="dock-heading">' +
        '<h1>' + e(scopeTitle) +
          (subTitle ? '<span class="dock-sep" aria-hidden="true">·</span><span class="' + subRoundCls + '">' + e(subTitle) + '</span>' : '') +
          futureBadge +
        '</h1>' +
        '<span class="dock-span">' + e(dockSpan || '\u00A0') + '</span>' +
      '</div></div>';

    const popoverItems = [
      '<button type="button" class="round-opt' + (isAllRounds ? ' is-selected' : '') + '" role="option" aria-selected="' + String(isAllRounds) + '" data-act="pickRound" data-val="all">' +
        '<span class="round-opt-label">全部轮次</span>' +
        '<span class="round-opt-meta">' + (isAllRounds ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') + '</span>' +
      '</button>',
      (hasFollowing || hasNext || descHistRounds.length) ? '<div class="round-opt-sep" role="separator"></div>' : '',
      hasFollowing ? (() => {
        const selected = future && !date && horizon === 2;
        return '<button type="button" class="round-opt is-future' + (selected ? ' is-selected' : '') + '" role="option" aria-selected="' + String(selected) + '" data-act="pickRound" data-val="following">' +
          '<span class="round-opt-label">' + e(followingLabel) + '</span>' +
          '<span class="round-opt-meta"><span class="round-opt-tag is-future">未开赛</span>' +
            (selected ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') +
          '</span>' +
        '</button>';
      })() : '',
      hasNext ? (() => {
        const selected = future && !date && horizon === 1;
        return '<button type="button" class="round-opt is-future' + (selected ? ' is-selected' : '') + '" role="option" aria-selected="' + String(selected) + '" data-act="pickRound" data-val="next">' +
          '<span class="round-opt-label">' + e(nextLabel) + '</span>' +
          '<span class="round-opt-meta"><span class="round-opt-tag is-future">未开赛</span>' +
            (selected ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') +
          '</span>' +
        '</button>';
      })() : '',
      ((hasFollowing || hasNext) && descHistRounds.length) ? '<div class="round-opt-sep" role="separator"></div>' : '',
      ...descHistRounds.map(value => {
        const selected = !future && !date && value === round;
        const cls = ['round-opt', selected ? 'is-selected' : ''].filter(Boolean).join(' ');
        return '<button type="button" class="' + cls + '" role="option" aria-selected="' + String(selected) + '" data-act="pickRound" data-val="' + e(value) + '">' +
          '<span class="round-opt-label">' + e(roundName(league, value)) + '</span>' +
          '<span class="round-opt-meta">' +
            (selected ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') +
          '</span>' +
        '</button>';
      })
    ].filter(Boolean).join('');

    const dock = '<div class="filter-dock round-dock' + (merged ? ' is-merged' : '') + (future ? ' is-future-dock' : '') + '">' + titleHtml +
      '<div class="dock-controls">' +
        '<div class="round-jump"><span class="sr">轮次跳转</span><span class="round-control">' +
          '<button type="button" class="round-nav-btn" data-act="prevRound"' + (prevRound != null ? ' data-val="' + e(prevRound) + '"' : ' disabled') + ' aria-label="前一轮" title="上一轮">' + icon('left') + '</button>' +
          '<button type="button" class="round-trigger" id="round-trigger" data-act="toggleRoundMenu" aria-expanded="false" aria-haspopup="listbox" aria-controls="round-popover">' +
            '<span class="round-trigger-label">' + e(roundTriggerLabel) + '</span>' + icon('down') +
          '</button>' +
          '<button type="button" class="round-nav-btn" data-act="nextRound"' + (nextRound != null ? ' data-val="' + e(nextRound) + '"' : ' disabled') + ' aria-label="后一轮" title="下一轮">' + icon('right') + '</button>' +
        '</span>' +
        '<select class="sr-date-input" id="round-picker" aria-label="选择轮次" tabindex="-1">' +
          (date ? '<option value="" hidden disabled selected>' + e(currentRoundLabel) + '</option>' : '') +
          '<option value="all"' + (isAllRounds ? ' selected' : '') + '>全部轮次</option>' +
          (hasFollowing ? '<option value="following"' + (future && !date && horizon === 2 ? ' selected' : '') + '>' + e(followingLabel) + '</option>' : '') +
          (hasNext ? '<option value="next"' + (future && !date && horizon === 1 ? ' selected' : '') + '>' + e(nextLabel) + '</option>' : '') +
          options +
        '</select>' +
        '<div class="round-popover" id="round-popover" hidden role="listbox" aria-label="选择轮次">' + popoverItems + '</div>' +
        '</div>' +
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
      const headingText = all ? (leagues[id].short + ' · ' + roundName(id,value)) : roundName(id,value);
      const heading = merged ? '' :
        '<header class="round-heading">' + (all ? leagueIcon(id, 'heading-ic') : '') + '<h2>' + e(headingText) +
        '</h2><span>' + e(dateSpan(games)) + '</span></header>';
      return '<section class="round-group' + (merged ? ' is-merged-group' : '') + '" data-league="' + id + '" data-round="' + e(value) + '">' +
        heading + '<div class="card-stack">' +
        sorted.map(m => matchCard(m,{showLeagueIcon:false,isHero:heroes.has(m.id),watched:watched.has(m.id)})).join('') + '</div></section>';
    }).join('');
  }
  window.Rate90.views = {roundView};
})();
