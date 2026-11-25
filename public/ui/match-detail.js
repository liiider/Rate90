(() => {
  'use strict';

  const { escapeHtml: e } = window.Rate90.catalog;
  const { icon } = window.Rate90.components;
  const i18n = window.Rate90.i18n;
  const t = (key, vars) => i18n ? i18n.t(key, vars) : key;
  const teamLabel = team => i18n ? i18n.teamName(team) : (team?.zh || team?.en || '');
  const coachLabel = (name, zh) => i18n ? i18n.coachName(name, zh) : (name || '');
  const playerLabel = (name, zh, squad) => i18n ? i18n.playerName(name, zh, squad) : (name || '');
  const sides = ['home', 'away'];

  const posShort = { G: 'GK', D: 'DEF', M: 'MID', F: 'FWD' };
  function formatPos(pos) {
    if (!pos) return '';
    const raw = String(pos).trim().toUpperCase();
    return posShort[raw] || raw;
  }

  function playerList(players, className) {
    if (!players?.length) return '<p class="match-note">' + e(t('noRoster')) + '</p>';
    const hasPos = players.some(p => p.position);
    return '<ul class="players ' + className + (hasPos ? ' has-pos' : '') + '">' + players.map(player => {
      const pos = formatPos(player.position);
      const posHtml = hasPos
        ? '<span class="player-pos' + (pos === 'GK' ? ' is-gk' : !pos ? ' is-empty' : '') + '">' + e(pos || '—') + '</span>'
        : '';
      const displayName = playerLabel(player.name, player.zh);
      return '<li><span class="shirt-number" title="' + e(t('shirtNumber')) + '">' + e(player.number ?? '—') + '</span>' +
        posHtml +
        '<span class="player-name">' + e(displayName) +
          (player.captain ? ' <abbr class="captain" title="' + e(t('captain')) + '" aria-label="' + e(t('captain')) + '">C</abbr>' : '') +
        '</span></li>';
    }).join('') + '</ul>';
  }

  function lineupTeam(m, lineups, side, substitutes) {
    const team = m[side];
    const teamLineup = lineups[side];
    const coach = teamLineup?.coach ? coachLabel(teamLineup.coach, teamLineup.coachZh) : '';
    const meta = '<div class="lineup-meta">' +
      '<span class="split-team-mobile">' + e(teamLabel(team)) + '</span>' +
      (teamLineup?.formation ? '<span class="formation"><span class="sr">' + e(t('formationSr')) + '</span>' + e(teamLineup.formation) + '</span>' : '') +
      (coach ? '<span class="coach">' + e(t('coachPrefix')) + e(coach) + '</span>' : '') +
    '</div>';
    return '<section class="lineup-team" data-side="' + side + '">' + meta +
      (substitutes ? playerList(teamLineup?.substitutes, 'bench-players') : playerList(teamLineup?.players, 'starters')) +
      '</section>';
  }

  function lineupsSection(m, lineups, substitutes = false) {
    if (!lineups || !sides.some(side => lineups[side])) {
      return '<p class="match-note">' + e(substitutes ? t('noBench') : t('noLineups')) + '</p>';
    }
    if (substitutes && !sides.some(side => lineups[side]?.substitutes?.length)) {
      return '<p class="match-note">' + e(t('noBench')) + '</p>';
    }
    return '<section class="lineups"><div class="lineup-grid">' +
      sides.map(side => lineupTeam(m, lineups, side, substitutes)).join('') + '</div></section>';
  }

  const metricKeys = [
    ['shots', 'statShots'],
    ['shotsOnTarget', 'statShotsOnTarget'],
    ['xg', 'statXg'],
    ['possession', 'statPossession'],
    ['crosses', 'statCrosses'],
    ['tackles', 'statTackles'],
    ['distanceKm', 'statDistanceKm']
  ];

  function displayValue(value, key) {
    if (!Number.isFinite(value)) return '—';
    if (key === 'xg') return value.toFixed(2);
    if (key === 'possession') return value + '%';
    if (key === 'distanceKm') return value.toFixed(1) + ' km';
    return String(value);
  }

  function statTable(m, stats) {
    const rows = metricKeys.filter(([key]) => sides.some(side => Number.isFinite(stats?.[key]?.[side])));
    if (!rows.length) return '';
    return '<table class="match-stats" aria-label="' + e(t('statsTableAria')) + '">' +
      '<thead><tr>' +
        '<th scope="col" class="col-home">' + e(teamLabel(m.home)) + '</th>' +
        '<th scope="col" class="col-mid">' + e(t('regularTime')) + '</th>' +
        '<th scope="col" class="col-away">' + e(teamLabel(m.away)) + '</th>' +
      '</tr></thead><tbody>' +
      rows.map(([key, labelKey]) => {
        const hv = stats[key]?.home;
        const av = stats[key]?.away;
        const comparable = Number.isFinite(hv) && Number.isFinite(av);
        const hLead = comparable && hv > av;
        const aLead = comparable && av > hv;
        const hText = displayValue(hv, key);
        const aText = displayValue(av, key);
        return '<tr>' +
          '<td class="col-home">' + (hLead ? '<span class="stat-lead home">' + e(hText) + '</span>' : e(hText)) + '</td>' +
          '<th scope="row">' + e(t(labelKey)) + '</th>' +
          '<td class="col-away">' + (aLead ? '<span class="stat-lead away">' + e(aText) + '</span>' : e(aText)) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function pressureChart(m, pressure) {
    if (!Array.isArray(pressure) || !pressure.some(Number.isFinite)) return '';
    const peak = Math.max(1, ...pressure.filter(Number.isFinite).map(Math.abs));
    const homeName = teamLabel(m.home);
    const awayName = teamLabel(m.away);
    const bars = pressure.map((value, i) => {
      if (!Number.isFinite(value)) return '';
      const height = Math.max(0.8, Math.abs(value) * 21 / peak);
      const side = value > 0 ? 'home' : value < 0 ? 'away' : 'even';
      const title = (i + 1) + '′ · ' + (side === 'even' ? t('momentumEven') : teamLabel(m[side]) + ' ' + Math.abs(value));
      return '<rect class="pressure-' + side + '" x="' + (i * 3 + 0.85).toFixed(2) + '" y="' + (value >= 0 ? (24 - height).toFixed(1) : '24') +
        '" width="1.3" height="' + height.toFixed(1) + '" rx="0.65"><title>' + e(title) + '</title></rect>';
    }).join('');
    const legend = sides.map(side => '<span class="pressure-key ' + side + '">' + e(teamLabel(m[side])) + '</span>').join('');
    return '<figure class="pressure-chart"><figcaption><b>' + e(t('momentumTitle')) + '</b><span>' + legend + '</span></figcaption>' +
      '<svg role="img" aria-label="' + e(t('momentumAria', { home: homeName, away: awayName })) +
      '" viewBox="0 0 270 48" preserveAspectRatio="none">' +
      '<path class="pressure-axis" d="M0 24H270"/><path class="pressure-mid" d="M135 2V46"/>' + bars + '</svg>' +
      '<div class="chart-axis"><span>1′</span><span>45′</span><span>90′</span></div></figure>';
  }

  const cardKeys = { yellow: 'cardYellow', yellowRed: 'cardYellowRed', red: 'cardRed' };

  function renderTimelineEntry(event, side, squad) {
    if (event.type === 'substitution') {
      const inArrow = '<span class="tl-arrow is-in" title="' + e(t('subIn')) + '" aria-hidden="true">↑</span>';
      const outArrow = '<span class="tl-arrow is-out" title="' + e(t('subOut')) + '" aria-hidden="true">↓</span>';
      const inText = event.playerIn ? playerLabel(event.playerIn, event.playerInZh, squad) : '';
      const outText = event.playerOut ? playerLabel(event.playerOut, event.playerOutZh, squad) : '';
      const inName = inText ? '<span class="tl-sub-in">' + e(inText) + '</span>' : '';
      const outName = outText ? '<span class="tl-sub-out">' + e(outText) + '</span>' : '';
      const inLine = inText
        ? '<div class="tl-sub-line">' + (side === 'home' ? inName + inArrow : inArrow + inName) + '</div>'
        : '';
      const outLine = outText
        ? '<div class="tl-sub-line">' + (side === 'home' ? outName + outArrow : outArrow + outName) + '</div>'
        : '';
      return '<div class="tl-sub-group"><span class="sr">' + e(t('subSr')) + '</span>' + inLine + outLine + '</div>';
    }
    const label = t(cardKeys[event.card]);
    const cardHtml = '<span class="tl-icon is-card card-' + event.card + '" title="' + e(label) + '"><span class="sr">' + e(label) + ' </span></span>';
    const playerHtml = '<span class="tl-player">' + e(playerLabel(event.player, event.playerZh, squad)) + '</span>';
    return '<div class="tl-card-item">' + (side === 'home' ? playerHtml + cardHtml : cardHtml + playerHtml) + '</div>';
  }

  function eventList(m, events, lineups) {
    if (!Array.isArray(events)) return '<p class="match-note">' + e(t('noEvents')) + '</p>';
    const items = events
      .filter(event => sides.includes(event.side) &&
        (event.type === 'substitution' || (event.type === 'card' && Object.hasOwn(cardKeys, event.card))))
      .map((ev, idx) => ({ ev, idx }))
      .sort((a, b) => (a.ev.minute ?? 999) - (b.ev.minute ?? 999) || (a.ev.addedTime ?? 0) - (b.ev.addedTime ?? 0) || a.idx - b.idx)
      .map(x => x.ev);
    if (!items.length) return '<p class="match-note">' + e(t('noSubsOrCards')) + '</p>';

    const squad = i18n ? i18n.buildSquadLookup(lineups) : [];
    const groups = [];
    for (const ev of items) {
      const minute = ev.minute == null ? '—' : ev.minute + (ev.addedTime > 0 ? '+' + ev.addedTime : '') + '′';
      const key = (ev.minute ?? 'x') + '+' + (ev.addedTime ?? 0);
      let group = groups.at(-1);
      if (!group || group.key !== key) {
        group = { key, minute, sortMin: ev.minute ?? 999, home: [], away: [] };
        groups.push(group);
      }
      group[ev.side].push(ev);
    }

    const hasFirstHalf = groups.some(g => g.sortMin <= 45);
    const hasSecondHalf = groups.some(g => g.sortMin > 45);
    let insertedHalf = false;
    const rowsHtml = groups.map(group => {
      let sep = '';
      if (hasFirstHalf && hasSecondHalf && !insertedHalf && group.sortMin > 45) {
        insertedHalf = true;
        sep = '<li class="tl-half" aria-hidden="true"><span>' + e(t('halftime')) + '</span></li>';
      }
      const homeHtml = group.home.length
        ? '<div class="tl-cluster">' + group.home.map(ev => renderTimelineEntry(ev, 'home', squad)).join('') + '</div>'
        : '';
      const awayHtml = group.away.length
        ? '<div class="tl-cluster">' + group.away.map(ev => renderTimelineEntry(ev, 'away', squad)).join('') + '</div>'
        : '';
      const axisCls = ['tl-axis', group.home.length ? 'has-home' : '', group.away.length ? 'has-away' : ''].filter(Boolean).join(' ');
      return sep + '<li class="tl-row">' +
        '<div class="tl-side home">' + homeHtml + '</div>' +
        '<div class="' + axisCls + '"><span class="tl-minute">' + e(group.minute) + '</span></div>' +
        '<div class="tl-side away">' + awayHtml + '</div>' +
      '</li>';
    }).join('');

    return '<ol class="timeline">' + rowsHtml + '</ol>';
  }

  const privateTabKeys = { stats: 'tabStats', events: 'tabEvents', tactics: 'tabTactics' };

  function tacticalTimeLabel(time) {
    if (time === '赛前') return t('tacticalXI');
    if (time === '终场') return t('tacticalSummary');
    return time;
  }

  function tacticalSection(m, detail, side) {
    const tactics = detail?.tactics;
    const review = tactics?.[side];
    const rawCoach = detail?.lineups?.[side]?.coach || '';
    const coachName = rawCoach ? coachLabel(rawCoach, detail?.lineups?.[side]?.coachZh) : '';
    const sideClub = teamLabel(m[side]);

    const nav = '<div class="coach-switch" role="group" aria-label="' + e(t('coachBenchAria')) + '">' +
      sides.map(key => '<button type="button" data-act="tacticalSide" data-val="' + key + '" data-side="' + key + '" aria-pressed="' +
        (key === side) + '"><span class="coach-dot" aria-hidden="true"></span><span>' + e(teamLabel(m[key])) + '</span></button>').join('') + '</div>';

    const scoreHtml = Number.isFinite(review?.score)
      ? '<div class="coach-score" aria-label="' + e(t('coachRatingAria', { score: review.score.toFixed(1) })) + '">' +
          '<span class="coach-score-label">' + e(t('coachRating')) + '</span>' +
          '<span class="coach-score-sep" aria-hidden="true"></span>' +
          '<strong class="coach-score-num">' + e(review.score.toFixed(1)) + '<small>/10</small></strong>' +
        '</div>'
      : '';

    const spotlight = (coachName || scoreHtml)
      ? '<div class="coach-spotlight">' +
          (coachName ? '<div class="coach-id"><span class="coach-role">' + e(side === 'home' ? t('homeManager') : t('awayManager')) + '</span>' +
            '<span class="coach-name">' + e(coachName) + '</span></div>' : '') +
          scoreHtml +
        '</div>'
      : '';

    const header = '<div class="tactics-header">' + nav + spotlight + '</div>';

    if (!review?.nodes?.length) {
      const msg = tactics || m.tacticalCoverage ? t('tacticsNotReady') : t('tacticsNone');
      return header + '<div class="tactics-empty">' +
        '<span class="tactics-empty-ic" aria-hidden="true">✦</span>' +
        '<p class="tactics-empty-title">' + e(msg) + '</p>' +
        '<p class="tactics-empty-sub">' + e(t('tacticsEmptySub', { team: sideClub })) + '</p>' +
      '</div>';
    }

    return header + '<ol class="coach-timeline" aria-label="' + e(t('tacticsReviewAria', { team: sideClub })) + '">' +
      review.nodes.map((node, i) => {
        const isAnchor = i === 0 || i === review.nodes.length - 1;
        const timeCls = 'coach-time' + (isAnchor ? ' is-' + side : '');
        return '<li>' +
          '<div><span class="' + timeCls + '">' + e(tacticalTimeLabel(node.time)) + '</span></div>' +
          '<div class="coach-node-body">' +
            '<p class="coach-analysis">' + e(node.analysis) + '</p>' +
            '<div class="coach-comment"><span class="coach-ai-tag">' + e(t('aiNote')) + '</span>' + e(node.comment) + '</div>' +
          '</div>' +
        '</li>';
      }).join('') + '</ol>';
  }

  function peekGuard(targetTab) {
    const tabLabel = t(privateTabKeys[targetTab]);
    return '<div class="peek-guard" role="alertdialog" aria-labelledby="peek-title">' +
      '<p id="peek-title" class="peek-title">' + e(t('peekTitle')) + '</p>' +
      '<p class="peek-desc">' + e(t('peekDesc', { tab: tabLabel })) + '</p>' +
      '<div class="peek-actions">' +
        '<button type="button" class="btn peek-cancel" data-act="cancelPeek">' + e(t('peekCancel')) + '</button>' +
        '<button type="button" class="btn peek-confirm" data-act="confirmPeek" data-val="' + e(targetTab) + '">' + e(t('peekConfirm')) + '</button>' +
      '</div>' +
    '</div>';
  }

  function renderMatchFacts(m, detail, { activeTab = 'lineups', pendingTab = '', tacticalSide = 'home' } = {}) {
    if (!detail && !m.tacticalCoverage) return '<p class="match-note">' + e(t('noDetails')) + '</p>';
    detail = detail || {};
    const tabs = [
      ['lineups', t('tabLineups')],
      ['substitutes', t('tabSubstitutes')],
      ...Object.entries(privateTabKeys)
        .filter(([key]) => key !== 'tactics' || m.tacticalCoverage || detail.tactics)
        .map(([key, labelKey]) => [key, t(labelKey)])
    ];
    const current = pendingTab || activeTab;
    const nav = '<div class="detail-tabs" role="tablist" aria-label="' + e(t('detailTabsAria')) + '">' +
      tabs.map(([id, label]) => {
        const active = current === id;
        return '<button type="button" class="detail-tab' + (active ? ' active' : '') + '" role="tab" aria-selected="' + active + '" data-act="detailTab" data-val="' + id + '">' + e(label) + '</button>';
      }).join('') +
    '</div>';

    let body = '';
    if (pendingTab) {
      body = '<div class="detail-panel is-guard" data-panel="guard">' + peekGuard(pendingTab) + '</div>';
    } else if (activeTab === 'substitutes') {
      body = '<div class="detail-panel" data-panel="substitutes">' + lineupsSection(m, detail.lineups, true) + '</div>';
    } else if (activeTab === 'stats') {
      const stats = pressureChart(m, detail.pressure) + statTable(m, detail.stats);
      body = '<div class="detail-panel" data-panel="stats">' + (stats || '<p class="match-note">' + e(t('noStats')) + '</p>') + '</div>';
    } else if (activeTab === 'tactics') {
      body = '<div class="detail-panel" data-panel="tactics">' + tacticalSection(m, detail, tacticalSide) + '</div>';
    } else if (activeTab === 'events') {
      body = '<div class="detail-panel" data-panel="events">' + eventList(m, detail.events, detail.lineups) + '</div>';
    } else {
      body = '<div class="detail-panel" data-panel="lineups">' + lineupsSection(m, detail.lineups, false) + '</div>';
    }
    return nav + body;
  }

  window.Rate90.renderMatchFacts = renderMatchFacts;
})();
