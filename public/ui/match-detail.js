(() => {
  'use strict';

  const { escapeHtml: e } = window.Rate90.catalog;
  const { crest, icon } = window.Rate90.components;
  const sides = ['home', 'away'];
  const sideNames = { home: '主队', away: '客队' };

  function disclosure(key, label, content) {
    return '<details class="match-disclosure" data-section="' + key + '">' +
      '<summary>' + label + icon('right') + '</summary>' + content + '</details>';
  }

  function playerList(players, className) {
    if (!players?.length) return '<p class="match-note">暂无名单</p>';
    return '<ul class="players ' + className + '">' + players.map(player =>
      '<li><span class="shirt-number" title="球衣号码">' + e(player.number ?? '—') + '</span>' +
      '<span class="player-name">' + e(player.name) +
        (player.captain ? ' <abbr class="captain" title="队长" aria-label="队长">C</abbr>' : '') +
      '</span></li>'
    ).join('') + '</ul>';
  }

  function lineupTeam(m, lineups, side, substitutes) {
    const team = m[side];
    const teamLineup = lineups[side];
    const subCount = teamLineup?.substitutes?.length || 0;
    const head = substitutes
      ? '<div class="split-head"><span class="split-team">' + e(team.zh) + '</span>' +
          (subCount ? '<span class="split-sub">' + subCount + ' 人</span>' : '') + '</div>'
      : '<div class="split-head is-starter">' +
          '<span class="split-team-mobile">' + e(team.zh) + '</span>' +
          '<div class="lineup-meta">' +
            (teamLineup?.formation ? '<span class="formation"><span class="sr">开场阵型 </span>' + e(teamLineup.formation) + '</span>' : '') +
            (teamLineup?.coach ? '<span class="coach">教练 ' + e(teamLineup.coach) + '</span>' : '') +
          '</div>' +
        '</div>';
    return '<section class="lineup-team" data-side="' + side + '">' + head +
      (substitutes ? playerList(teamLineup?.substitutes, 'bench-players') : playerList(teamLineup?.players, 'starters')) +
      '</section>';
  }

  function lineupsSection(m, lineups, substitutes = false) {
    if (!lineups || !sides.some(side => lineups[side])) {
      return '<p class="match-note">' + (substitutes ? '暂无替补名单' : '暂无首发阵容') + '</p>';
    }
    if (substitutes && !sides.some(side => lineups[side]?.substitutes?.length)) {
      return '<p class="match-note">暂无替补名单</p>';
    }
    return '<section class="lineups"><div class="lineup-grid detail-split">' +
      sides.map(side => lineupTeam(m, lineups, side, substitutes)).join('') + '</div></section>';
  }

  const metrics = [
    ['shots', '射门'], ['shotsOnTarget', '射正'],
    ['possession', '控球率'], ['crosses', '传中尝试'], ['tackles', '抢断尝试'], ['distanceKm', '跑动距离']
  ];

  function displayValue(value, key) {
    if (!Number.isFinite(value)) return '—';
    if (key === 'possession') return value + '%';
    if (key === 'distanceKm') return value.toFixed(1) + ' km';
    return String(value);
  }

  function statTable(m, stats) {
    const rows = metrics.filter(([key]) => sides.some(side => Number.isFinite(stats?.[key]?.[side])));
    if (!rows.length) return '';
    return '<div class="match-stats" role="region" aria-label="常规时间技术统计">' +
      '<div class="stats-head"><span>' + e(m.home.zh) + '</span><span class="stats-head-mid">常规时间</span><span>' + e(m.away.zh) + '</span></div>' +
      '<ul class="stats-list">' +
      rows.map(([key, label]) => {
        const hv = stats[key]?.home;
        const av = stats[key]?.away;
        const comparable = Number.isFinite(hv) && Number.isFinite(av);
        const total = comparable ? hv + av : 0;
        const hLead = comparable && hv > av;
        const aLead = comparable && av > hv;
        const bar = total > 0 ? '<div class="stat-bar" aria-hidden="true">' +
          '<span class="stat-bar-home' + (hLead ? ' is-lead' : '') + '" style="width:' + (hv / total * 100).toFixed(1) + '%"></span>' +
          '<span class="stat-bar-away' + (aLead ? ' is-lead' : '') + '" style="width:' + (av / total * 100).toFixed(1) + '%"></span></div>' : '';
        return '<li class="stat-item">' +
          '<div class="stat-values">' +
            '<span class="stat-val home' + (hLead ? ' is-lead' : '') + '">' + displayValue(hv, key) + '</span>' +
            '<span class="stat-label">' + label + '</span>' +
            '<span class="stat-val away' + (aLead ? ' is-lead' : '') + '">' + displayValue(av, key) + '</span>' +
          '</div>' +
          bar +
        '</li>';
      }).join('') +
      '</ul></div>';
  }

  function pressureChart(m, pressure) {
    if (!Array.isArray(pressure) || !pressure.some(Number.isFinite)) return '';
    const peak = Math.max(1, ...pressure.filter(Number.isFinite).map(Math.abs));
    const bars = pressure.map((value, i) => {
      if (!Number.isFinite(value)) return '';
      const height = Math.max(0.6, Math.abs(value) * 31 / peak);
      const side = value > 0 ? 'home' : value < 0 ? 'away' : 'even';
      const title = (i + 1) + '′ · ' + (side === 'even' ? '均势' : m[side].zh + ' ' + Math.abs(value));
      return '<rect class="pressure-' + side + '" x="' + (i * 3 + 0.25) + '" y="' + (value >= 0 ? 32 - height : 32) +
        '" width="2.4" height="' + height + '" rx="0.9"><title>' + e(title) + '</title></rect>';
    }).join('');
    const legend = sides.map(side => '<span class="pressure-key ' + side + '">' + e(m[side].zh) + '</span>').join('');
    return '<figure class="pressure-chart"><figcaption><b>逐分钟攻势</b><span>' + legend + '</span></figcaption>' +
      '<svg role="img" aria-label="' + e('常规时间攻势，上方为' + m.home.zh + '，下方为' + m.away.zh) +
      '" viewBox="0 0 270 64" preserveAspectRatio="none">' +
      '<path class="pressure-axis" d="M0 32H270"/><path class="pressure-mid" d="M135 2V62"/>' + bars + '</svg>' +
      '<div class="chart-axis"><span>1′</span><span>45′</span><span>90′</span></div></figure>';
  }

  const cardNames = { yellow: '黄牌', yellowRed: '两黄变一红', red: '红牌' };

  function renderTimelineEntry(event, side) {
    if (event.type === 'substitution') {
      const iconHtml = '<span class="tl-icon is-sub" title="换人"><span class="sr">换人</span>' +
        '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M5 12V4m0 0L2.8 6.2M5 4l2.2 2.2" class="sub-up"/>' +
          '<path d="M11 4v8m0 0-2.2-2.2M11 12l2.2-2.2" class="sub-down"/>' +
        '</svg></span>';
      const inName = event.playerIn ? '<span class="tl-sub-in">' + e(event.playerIn) + '</span>' : '';
      const outName = event.playerOut ? '<span class="tl-sub-out">' + e(event.playerOut) + '</span>' : '';
      const textHtml = '<span class="tl-sub-names">' + inName + outName + '</span>';
      return '<div class="tl-entry is-sub">' + (side === 'home' ? textHtml + iconHtml : iconHtml + textHtml) + '</div>';
    }
    const label = cardNames[event.card];
    const cardHtml = '<span class="tl-icon is-card card-' + event.card + '" title="' + e(label) + '"><span class="sr">' + e(label) + '</span></span>';
    const playerHtml = '<span class="tl-player">' + e(event.player) + '</span>';
    return '<div class="tl-entry is-card">' + (side === 'home' ? playerHtml + cardHtml : cardHtml + playerHtml) + '</div>';
  }

  function eventList(m, events) {
    if (!Array.isArray(events)) return '<p class="match-note">暂无事件资料</p>';
    const items = events
      .filter(event => sides.includes(event.side) &&
        (event.type === 'substitution' || (event.type === 'card' && Object.hasOwn(cardNames, event.card))))
      .map((ev, idx) => ({ ev, idx }))
      .sort((a, b) => (a.ev.minute ?? 999) - (b.ev.minute ?? 999) || (a.ev.addedTime ?? 0) - (b.ev.addedTime ?? 0) || a.idx - b.idx)
      .map(x => x.ev);
    if (!items.length) return '<p class="match-note">无换人及出牌记录</p>';

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
        sep = '<li class="tl-half" aria-hidden="true"><span>中场</span></li>';
      }
      return sep + '<li class="tl-row">' +
        '<div class="tl-side home">' + group.home.map(ev => renderTimelineEntry(ev, 'home')).join('') + '</div>' +
        '<div class="tl-axis"><span class="tl-minute">' + e(group.minute) + '</span></div>' +
        '<div class="tl-side away">' + group.away.map(ev => renderTimelineEntry(ev, 'away')).join('') + '</div>' +
      '</li>';
    }).join('');

    return '<div class="timeline-card">' +
      '<div class="timeline-head">' +
        '<span class="tl-club home"><i aria-hidden="true"></i>' + e(m.home?.zh || sideNames.home) + '</span>' +
        '<span class="tl-mid">时间线</span>' +
        '<span class="tl-club away">' + e(m.away?.zh || sideNames.away) + '<i aria-hidden="true"></i></span>' +
      '</div>' +
      '<ol class="timeline">' + rowsHtml + '</ol>' +
    '</div>';
  }

  function peekGuard(targetTab) {
    return '<div class="peek-guard" role="alertdialog" aria-labelledby="peek-title">' +
      '<p id="peek-title" class="peek-title">真的要偷看一眼吗？</p>' +
      '<p class="peek-desc">比赛数据与换人红黄牌可能透露场上走势，确认后再展开查看。</p>' +
      '<div class="peek-actions">' +
        '<button type="button" class="btn peek-cancel" data-act="cancelPeek">还是算了</button>' +
        '<button type="button" class="btn peek-confirm" data-act="confirmPeek" data-val="' + e(targetTab) + '">偷看一眼</button>' +
      '</div>' +
    '</div>';
  }

  function renderMatchFacts(m, detail, { activeTab = 'lineups', pendingTab = '' } = {}) {
    if (!detail) return '<p class="match-note">暂无本场详细资料</p>';
    const tabs = [
      ['lineups', '首发阵容'],
      ['substitutes', '替补阵容'],
      ['stats', '比赛数据'],
      ['events', '换人与红黄牌']
    ];
    const current = pendingTab || activeTab;
    const nav = '<div class="detail-tabs" role="tablist" aria-label="比赛详情">' +
      tabs.map(([id, label]) => {
        const active = current === id;
        return '<button type="button" class="detail-tab' + (active ? ' active' : '') + '" role="tab" aria-selected="' + active + '" data-act="detailTab" data-val="' + id + '">' + label + '</button>';
      }).join('') +
    '</div>';

    let body = '';
    if (pendingTab) {
      body = '<div class="detail-panel is-guard" data-panel="guard">' + peekGuard(pendingTab) + '</div>';
    } else if (activeTab === 'substitutes') {
      body = '<div class="detail-panel" data-panel="substitutes">' + lineupsSection(m, detail.lineups, true) + '</div>';
    } else if (activeTab === 'stats') {
      const stats = pressureChart(m, detail.pressure) + statTable(m, detail.stats);
      body = '<div class="detail-panel" data-panel="stats">' + (stats || '<p class="match-note">暂无技术统计</p>') + '</div>';
    } else if (activeTab === 'events') {
      body = '<div class="detail-panel" data-panel="events">' + eventList(m, detail.events) + '</div>';
    } else {
      body = '<div class="detail-panel" data-panel="lineups">' + lineupsSection(m, detail.lineups, false) + '</div>';
    }
    return nav + body;
  }

  window.Rate90.renderMatchFacts = renderMatchFacts;
})();
