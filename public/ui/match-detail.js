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

  const posShort = { G: 'GK', D: 'DEF', M: 'MID', F: 'FWD' };
  function formatPos(pos) {
    if (!pos) return '';
    const raw = String(pos).trim().toUpperCase();
    return posShort[raw] || raw;
  }

  function playerList(players, className) {
    if (!players?.length) return '<p class="match-note">暂无名单</p>';
    const hasPos = players.some(p => p.position);
    return '<ul class="players ' + className + (hasPos ? ' has-pos' : '') + '">' + players.map(player => {
      const pos = formatPos(player.position);
      const posHtml = hasPos
        ? '<span class="player-pos' + (pos === 'GK' ? ' is-gk' : !pos ? ' is-empty' : '') + '">' + e(pos || '—') + '</span>'
        : '';
      return '<li><span class="shirt-number" title="球衣号码">' + e(player.number ?? '—') + '</span>' +
        posHtml +
        '<span class="player-name">' + e(player.name) +
          (player.captain ? ' <abbr class="captain" title="队长" aria-label="队长">C</abbr>' : '') +
        '</span></li>';
    }).join('') + '</ul>';
  }

  function lineupTeam(m, lineups, side, substitutes) {
    const team = m[side];
    const teamLineup = lineups[side];
    const meta = '<div class="lineup-meta">' +
      '<span class="split-team-mobile">' + e(team.zh) + '</span>' +
      (teamLineup?.formation ? '<span class="formation"><span class="sr">开场阵型 </span>' + e(teamLineup.formation) + '</span>' : '') +
      (teamLineup?.coach ? '<span class="coach">教练 ' + e(teamLineup.coach) + '</span>' : '') +
    '</div>';
    return '<section class="lineup-team" data-side="' + side + '">' + meta +
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
    return '<section class="lineups"><div class="lineup-grid">' +
      sides.map(side => lineupTeam(m, lineups, side, substitutes)).join('') + '</div></section>';
  }

  const metrics = [
    ['shots', '射门'], ['shotsOnTarget', '射正'], ['xg', '预期进球'],
    ['possession', '控球率'], ['crosses', '传中尝试'], ['tackles', '抢断尝试'], ['distanceKm', '跑动距离']
  ];

  function displayValue(value, key) {
    if (!Number.isFinite(value)) return '—';
    if (key === 'xg') return value.toFixed(2);
    if (key === 'possession') return value + '%';
    if (key === 'distanceKm') return value.toFixed(1) + ' km';
    return String(value);
  }

  function statTable(m, stats) {
    const rows = metrics.filter(([key]) => sides.some(side => Number.isFinite(stats?.[key]?.[side])));
    if (!rows.length) return '';
    return '<table class="match-stats" aria-label="常规时间技术统计">' +
      '<thead><tr>' +
        '<th scope="col" class="col-home">' + e(m.home.zh) + '</th>' +
        '<th scope="col" class="col-mid">常规时间</th>' +
        '<th scope="col" class="col-away">' + e(m.away.zh) + '</th>' +
      '</tr></thead><tbody>' +
      rows.map(([key, label]) => {
        const hv = stats[key]?.home;
        const av = stats[key]?.away;
        const comparable = Number.isFinite(hv) && Number.isFinite(av);
        const hLead = comparable && hv > av;
        const aLead = comparable && av > hv;
        const hText = displayValue(hv, key);
        const aText = displayValue(av, key);
        return '<tr>' +
          '<td class="col-home">' + (hLead ? '<span class="stat-lead home">' + e(hText) + '</span>' : e(hText)) + '</td>' +
          '<th scope="row">' + label + '</th>' +
          '<td class="col-away">' + (aLead ? '<span class="stat-lead away">' + e(aText) + '</span>' : e(aText)) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function pressureChart(m, pressure) {
    if (!Array.isArray(pressure) || !pressure.some(Number.isFinite)) return '';
    const peak = Math.max(1, ...pressure.filter(Number.isFinite).map(Math.abs));
    const bars = pressure.map((value, i) => {
      if (!Number.isFinite(value)) return '';
      const height = Math.max(0.8, Math.abs(value) * 21 / peak);
      const side = value > 0 ? 'home' : value < 0 ? 'away' : 'even';
      const title = (i + 1) + '′ · ' + (side === 'even' ? '均势' : m[side].zh + ' ' + Math.abs(value));
      return '<rect class="pressure-' + side + '" x="' + (i * 3 + 0.85).toFixed(2) + '" y="' + (value >= 0 ? (24 - height).toFixed(1) : '24') +
        '" width="1.3" height="' + height.toFixed(1) + '" rx="0.65"><title>' + e(title) + '</title></rect>';
    }).join('');
    const legend = sides.map(side => '<span class="pressure-key ' + side + '">' + e(m[side].zh) + '</span>').join('');
    return '<figure class="pressure-chart"><figcaption><b>逐分钟攻势</b><span>' + legend + '</span></figcaption>' +
      '<svg role="img" aria-label="' + e('常规时间攻势，上方为' + m.home.zh + '，下方为' + m.away.zh) +
      '" viewBox="0 0 270 48" preserveAspectRatio="none">' +
      '<path class="pressure-axis" d="M0 24H270"/><path class="pressure-mid" d="M135 2V46"/>' + bars + '</svg>' +
      '<div class="chart-axis"><span>1′</span><span>45′</span><span>90′</span></div></figure>';
  }

  const cardNames = { yellow: '黄牌', yellowRed: '两黄变一红', red: '红牌' };

  function renderTimelineEntry(event, side) {
    if (event.type === 'substitution') {
      const inArrow = '<span class="tl-arrow is-in" title="换上" aria-hidden="true">↑</span>';
      const outArrow = '<span class="tl-arrow is-out" title="换下" aria-hidden="true">↓</span>';
      const inName = event.playerIn ? '<span class="tl-sub-in">' + e(event.playerIn) + '</span>' : '';
      const outName = event.playerOut ? '<span class="tl-sub-out">' + e(event.playerOut) + '</span>' : '';
      const inLine = event.playerIn
        ? '<div class="tl-sub-line">' + (side === 'home' ? inName + inArrow : inArrow + inName) + '</div>'
        : '';
      const outLine = event.playerOut
        ? '<div class="tl-sub-line">' + (side === 'home' ? outName + outArrow : outArrow + outName) + '</div>'
        : '';
      return '<div class="tl-sub-group"><span class="sr">换人 </span>' + inLine + outLine + '</div>';
    }
    const label = cardNames[event.card];
    const cardHtml = '<span class="tl-icon is-card card-' + event.card + '" title="' + e(label) + '"><span class="sr">' + e(label) + ' </span></span>';
    const playerHtml = '<span class="tl-player">' + e(event.player) + '</span>';
    return '<div class="tl-card-item">' + (side === 'home' ? playerHtml + cardHtml : cardHtml + playerHtml) + '</div>';
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
      const homeHtml = group.home.length
        ? '<div class="tl-cluster">' + group.home.map(ev => renderTimelineEntry(ev, 'home')).join('') + '</div>'
        : '';
      const awayHtml = group.away.length
        ? '<div class="tl-cluster">' + group.away.map(ev => renderTimelineEntry(ev, 'away')).join('') + '</div>'
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

  const privateTabs = {stats:'比赛数据', events:'比赛动态', tactics:'战术分析'};

  function tacticalTimeLabel(time) {
    if (time === '赛前') return '首发';
    if (time === '终场') return '总结';
    return time;
  }

  function tacticalSection(m, detail, side) {
    const tactics = detail?.tactics;
    const review = tactics?.[side];
    const coachName = detail?.lineups?.[side]?.coach || '';
    const nav = '<div class="coach-switch" role="group" aria-label="教练席">' +
      sides.map(key => '<button type="button" data-act="tacticalSide" data-val="' + key + '" data-side="' + key + '" aria-pressed="' +
        (key === side) + '"><span class="coach-dot" aria-hidden="true"></span><span>' + e(m[key].zh) + '</span></button>').join('') + '</div>';

    const scoreHtml = Number.isFinite(review?.score)
      ? '<div class="coach-score" aria-label="教练评分 ' + e(review.score.toFixed(1)) + ' / 10">' +
          '<span class="coach-score-label">教练评分</span>' +
          '<span class="coach-score-sep" aria-hidden="true"></span>' +
          '<strong class="coach-score-num">' + e(review.score.toFixed(1)) + '<small>/10</small></strong>' +
        '</div>'
      : '';

    const spotlight = (coachName || scoreHtml)
      ? '<div class="coach-spotlight">' +
          (coachName ? '<div class="coach-id"><span class="coach-role">' + (side === 'home' ? '主队主帅' : '客队主帅') + '</span>' +
            '<span class="coach-name">' + e(coachName) + '</span></div>' : '') +
          scoreHtml +
        '</div>'
      : '';

    const header = '<div class="tactics-header">' + nav + spotlight + '</div>';

    if (!review?.nodes?.length) {
      const msg = tactics || m.tacticalCoverage ? '本队战术分析尚未生成' : '本场暂无战术分析';
      return header + '<div class="tactics-empty">' +
        '<span class="tactics-empty-ic" aria-hidden="true">✦</span>' +
        '<p class="tactics-empty-title">' + msg + '</p>' +
        '<p class="tactics-empty-sub">赛后完整事件与站位数据齐备后将自动生成 ' + e(m[side].zh) + ' 教练席复盘</p>' +
      '</div>';
    }

    return header + '<ol class="coach-timeline" aria-label="' + e(m[side].zh) + '战术复盘">' +
      review.nodes.map((node, i) => {
        const isAnchor = i === 0 || i === review.nodes.length - 1;
        const timeCls = 'coach-time' + (isAnchor ? ' is-' + side : '');
        return '<li>' +
          '<div><span class="' + timeCls + '">' + e(tacticalTimeLabel(node.time)) + '</span></div>' +
          '<div class="coach-node-body">' +
            '<p class="coach-analysis">' + e(node.analysis) + '</p>' +
            '<div class="coach-comment"><span class="coach-ai-tag">✦ AI 点评</span>' + e(node.comment) + '</div>' +
          '</div>' +
        '</li>';
      }).join('') + '</ol>';
  }

  function peekGuard(targetTab) {
    return '<div class="peek-guard" role="alertdialog" aria-labelledby="peek-title">' +
      '<p id="peek-title" class="peek-title">真的要偷看一眼吗？</p>' +
      '<p class="peek-desc">仅解锁本场的' + privateTabs[targetTab] + '。</p>' +
      '<div class="peek-actions">' +
        '<button type="button" class="btn peek-cancel" data-act="cancelPeek">还是算了</button>' +
        '<button type="button" class="btn peek-confirm" data-act="confirmPeek" data-val="' + e(targetTab) + '">偷看一眼</button>' +
      '</div>' +
    '</div>';
  }

  function renderMatchFacts(m, detail, { activeTab = 'lineups', pendingTab = '', tacticalSide = 'home' } = {}) {
    if (!detail && !m.tacticalCoverage) return '<p class="match-note">暂无本场详细资料</p>';
    detail = detail || {};
    const tabs = [
      ['lineups', '首发阵容'],
      ['substitutes', '替补阵容'],
      ...Object.entries(privateTabs).filter(([key]) => key !== 'tactics' || m.tacticalCoverage || detail.tactics)
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
    } else if (activeTab === 'tactics') {
      body = '<div class="detail-panel" data-panel="tactics">' + tacticalSection(m, detail, tacticalSide) + '</div>';
    } else if (activeTab === 'events') {
      body = '<div class="detail-panel" data-panel="events">' + eventList(m, detail.events) + '</div>';
    } else {
      body = '<div class="detail-panel" data-panel="lineups">' + lineupsSection(m, detail.lineups, false) + '</div>';
    }
    return nav + body;
  }

  window.Rate90.renderMatchFacts = renderMatchFacts;
})();
