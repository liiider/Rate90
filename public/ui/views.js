(() => {
  'use strict';
  const {leagues, roundName, dateSpan, cnDate, sortMatches, pickHeroIds, latestPlayedRound, escapeHtml: e} = window.Rate90.catalog;
  const {matchCard, leagueIcon, icon, canWatch} = window.Rate90.components;
  const i18n = window.Rate90.i18n;
  const t = (key, vars) => i18n ? i18n.t(key, vars) : key;
  const leagueShort = id => i18n ? i18n.leagueName(id, 'short') : (leagues[id]?.short || '全部赛事');

  function seasonInfo(games) {
    const playable = games.filter(canWatch);
    const dates = playable.map(m => m.date).filter(Boolean).sort();
    if (!dates.length) return { season: t('allRounds'), span: '' };
    const y = Number(dates[0].slice(0, 4));
    const mo = Number(dates[0].slice(5, 7));
    const startYear = mo >= 7 ? y : y - 1;
    const spanStr = startYear + '/' + String((startYear + 1) % 100).padStart(2, '0');
    return {
      season: t('seasonFmt', { span: spanStr }),
      span: dateSpan(playable)
    };
  }

  function roundView({catalog, route, watched, previewError}) {
    const {league, round, allRounds, date, future, horizon} = route;
    const all = league === 'all';
    const isAllRounds = !future && !date && Boolean(allRounds);
    const isCurrentAll = all && !isAllRounds && !future && !date && round == null;
    const scope = all ? catalog.matches : catalog.matches.filter(m => m.league === league);
    // On a rest day, use the most recent matchday in the selected scope.
    const day = date && scope.reduce((latest,m) => m.date <= date && m.date > latest ? m.date : latest,'');
    const sections = [];
    for (const [id, rounds] of catalog.groups) {
      if (future) break;
      if (!all && id !== league) continue;
      const targetRound = isCurrentAll ? latestPlayedRound(catalog, id) : round;
      for (const [value, games] of rounds) {
        if (targetRound != null && value !== targetRound) continue;
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
    const currentPlayedRound = !all ? latestPlayedRound(catalog, league) : null;
    const hasPrematch = Boolean(catalog.prematchFile);
    const hasNext = all ? hasPrematch : (catalog.prematch ? Boolean(futureRounds[0]) : hasPrematch);
    const hasFollowing = all ? hasPrematch : (catalog.prematch ? Boolean(futureRounds[1]) : hasPrematch);
    const nextLabel = futureRounds[0]?.label || t('upcomingRound');
    const followingLabel = futureRounds[1]?.label || t('followingRound');

    const timeline = [...histRounds, ...(hasNext ? ['next'] : []), ...(hasFollowing ? ['following'] : [])];
    const currentKey = future && !date ? (horizon === 2 ? 'following' : 'next') : activeRound;
    const curIdx = currentKey != null ? timeline.indexOf(currentKey) : -1;
    const curPlayedIdx = currentPlayedRound != null ? timeline.indexOf(currentPlayedRound) : -1;
    const prevRound = isAllRounds
      ? (curPlayedIdx > 0 ? timeline[curPlayedIdx - 1] : null)
      : isCurrentAll ? null
      : (curIdx > 0 ? timeline[curIdx - 1] : null);
    const nextRound = (isAllRounds || isCurrentAll)
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
      '<option value="' + e(value) + '"' + (!future && !date && !isAllRounds && value === round ? ' selected' : '') + '>' + e(roundName(league, value)) + '</option>').join('');
    const dateLabel = date ? date.replaceAll('-', '/') : t('pickDate');
    const currentRoundLabel = future ? t('byDate') : sections.length === 1
      ? roundName(sections[0].id, sections[0].value)
      : (activeRound != null && !all ? roundName(league, activeRound) : t('currentRoundsMulti'));
    const roundTriggerLabel = date ? currentRoundLabel
      : future ? (horizon === 2 ? followingLabel : nextLabel)
      : isCurrentAll ? t('currentRound')
      : isAllRounds ? t('allRounds')
      : round != null ? roundName(league, round)
      : t('allRounds');
    const mergedHistory = !future && !all && sections.length === 1;
    const mergedFuture = future && !all && !date && futureSections.length === 1;
    const merged = mergedHistory || mergedFuture;

    const scopeTitle = all ? leagueShort('all') : leagueShort(league);
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
      futureBadge = '<span class="dock-badge-future">' + e(t('notStarted')) + '</span>';
      dockSpan = sec.span || t('futureSchedule');
    } else if (future && date) {
      subTitle = cnDate(date);
      futureBadge = '<span class="dock-badge-future">' + e(t('notStarted')) + '</span>';
      const count = futureSections.reduce((sum, s) => sum + s.games.length, 0);
      dockSpan = count ? t('unplayedCount', { count }) : t('futureSchedule');
    } else if (future) {
      subTitle = horizon === 2 ? followingLabel : nextLabel;
      futureBadge = '<span class="dock-badge-future">' + e(t('notStarted')) + '</span>';
      dockSpan = futureSpan || t('futureSchedule');
    } else if (isCurrentAll) {
      subTitle = t('currentRound');
      dockSpan = dateSpan(sections.flatMap(s => s.games));
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
      all ? '<button type="button" class="round-opt' + (isCurrentAll ? ' is-selected' : '') + '" role="option" aria-selected="' + String(isCurrentAll) + '" data-act="pickRound" data-val="current">' +
        '<span class="round-opt-label">' + e(t('currentRound')) + '</span>' +
        '<span class="round-opt-meta">' + (isCurrentAll ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') + '</span>' +
      '</button>' : '',
      '<button type="button" class="round-opt' + (isAllRounds ? ' is-selected' : '') + '" role="option" aria-selected="' + String(isAllRounds) + '" data-act="pickRound" data-val="all">' +
        '<span class="round-opt-label">' + e(t('allRounds')) + '</span>' +
        '<span class="round-opt-meta">' + (isAllRounds ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') + '</span>' +
      '</button>',
      (hasFollowing || hasNext || descHistRounds.length) ? '<div class="round-opt-sep" role="separator"></div>' : '',
      hasFollowing ? (() => {
        const selected = future && !date && horizon === 2;
        return '<button type="button" class="round-opt is-future' + (selected ? ' is-selected' : '') + '" role="option" aria-selected="' + String(selected) + '" data-act="pickRound" data-val="following">' +
          '<span class="round-opt-label">' + e(followingLabel) + '</span>' +
          '<span class="round-opt-meta"><span class="round-opt-tag is-future">' + e(t('notStarted')) + '</span>' +
            (selected ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') +
          '</span>' +
        '</button>';
      })() : '',
      hasNext ? (() => {
        const selected = future && !date && horizon === 1;
        return '<button type="button" class="round-opt is-future' + (selected ? ' is-selected' : '') + '" role="option" aria-selected="' + String(selected) + '" data-act="pickRound" data-val="next">' +
          '<span class="round-opt-label">' + e(nextLabel) + '</span>' +
          '<span class="round-opt-meta"><span class="round-opt-tag is-future">' + e(t('notStarted')) + '</span>' +
            (selected ? '<span class="round-opt-check" aria-hidden="true">' + icon('check') + '</span>' : '') +
          '</span>' +
        '</button>';
      })() : '',
      ((hasFollowing || hasNext) && descHistRounds.length) ? '<div class="round-opt-sep" role="separator"></div>' : '',
      ...descHistRounds.map(value => {
        const selected = !future && !date && !isAllRounds && value === round;
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
        '<div class="round-jump"><span class="sr">' + e(t('roundJump')) + '</span><span class="round-control">' +
          '<button type="button" class="round-nav-btn" data-act="prevRound"' + (prevRound != null ? ' data-val="' + e(prevRound) + '"' : ' disabled') + ' aria-label="' + e(t('prevRound')) + '" title="' + e(t('prevRoundTitle')) + '">' + icon('left') + '</button>' +
          '<button type="button" class="round-trigger" id="round-trigger" data-act="toggleRoundMenu" aria-expanded="false" aria-haspopup="listbox" aria-controls="round-popover">' +
            '<span class="round-trigger-label">' + e(roundTriggerLabel) + '</span>' + icon('down') +
          '</button>' +
          '<button type="button" class="round-nav-btn" data-act="nextRound"' + (nextRound != null ? ' data-val="' + e(nextRound) + '"' : ' disabled') + ' aria-label="' + e(t('nextRound')) + '" title="' + e(t('nextRoundTitle')) + '">' + icon('right') + '</button>' +
        '</span>' +
        '<select class="sr-date-input" id="round-picker" aria-label="' + e(t('pickRound')) + '" tabindex="-1">' +
          (date ? '<option value="" hidden disabled selected>' + e(currentRoundLabel) + '</option>' : '') +
          (all ? '<option value="current"' + (isCurrentAll ? ' selected' : '') + '>' + e(t('currentRound')) + '</option>' : '') +
          '<option value="all"' + (isAllRounds ? ' selected' : '') + '>' + e(t('allRounds')) + '</option>' +
          (hasFollowing ? '<option value="following"' + (future && !date && horizon === 2 ? ' selected' : '') + '>' + e(followingLabel) + '</option>' : '') +
          (hasNext ? '<option value="next"' + (future && !date && horizon === 1 ? ' selected' : '') + '>' + e(nextLabel) + '</option>' : '') +
          options +
        '</select>' +
        '<div class="round-popover" id="round-popover" hidden role="listbox" aria-label="' + e(t('pickRound')) + '">' + popoverItems + '</div>' +
        '</div>' +
        '<div class="round-date"><label class="sr" for="date-picker">' + e(t('dateJump')) + '</label>' +
          '<div class="date-picker-wrap">' +
            '<button type="button" class="date-input date-trigger' + (date ? ' has-value' : '') + '" id="cal-trigger" data-act="toggleCal" aria-expanded="false" aria-haspopup="dialog" aria-controls="cal-popover">' +
              icon('calendar') + '<span>' + e(dateLabel) + '</span>' +
            '</button>' +
            '<input class="sr-date-input" id="date-picker" type="date" value="' + e(date) + '" tabindex="-1">' +
            '<div class="cal-popover" id="cal-popover" hidden role="dialog" aria-label="' + e(t('pickMatchDate')) + '"></div>' +
          '</div>' +
        '</div>' +
      '</div></div>';
    if (future) {
      if (!catalog.prematch) return dock + (previewError ?
        '<p class="state-card">' + e(t('previewLoadError')) + ' <button class="text-btn" data-act="retryPreview">' + e(t('retryLoad')) + '</button></p>' :
        '<p class="state-card">' + e(t('loadingSchedule')) + '</p>');
      return dock + window.Rate90.upcoming.view(catalog, futureSections, { merged: mergedFuture, showLeagueIcon: all && Boolean(date) });
    }
    if (!sections.length) return dock + '<p class="state-card">' + e(t('noSchedule')) + '</p>';
    return dock + sections.map(({id,value,games}) => {
      const sorted = sortMatches(games), heroes = pickHeroIds(sorted);
      const headingText = all ? (leagueShort(id) + ' · ' + roundName(id,value)) : roundName(id,value);
      const heading = merged ? '' :
        '<header class="round-heading">' + (all ? leagueIcon(id, 'heading-ic') : '') + '<h2>' + e(headingText) +
        '</h2><span>' + e(dateSpan(games)) + '</span></header>';
      return '<section class="round-group' + (merged ? ' is-merged-group' : '') + '" data-league="' + id + '" data-round="' + e(value) + '">' +
        heading + '<div class="card-stack">' +
        sorted.map(m => matchCard(m,{showLeagueIcon:false,isHero:heroes.has(m.id)})).join('') + '</div></section>';
    }).join('');
  }
  window.Rate90.views = {roundView};
})();
