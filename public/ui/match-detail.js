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
      '<span>' + e(player.name) +
        (player.captain ? ' <abbr class="captain" title="队长" aria-label="队长">C</abbr>' : '') +
      '</span></li>'
    ).join('') + '</ul>';
  }

  function lineupTeam(m, lineups, side, substitutes) {
    const team = m[side];
    const teamLineup = lineups[side];
    return '<section class="lineup-team" data-side="' + side + '">' +
      '<div class="lineup-club">' + crest(team, 'sm') + '<h4>' + e(team.zh) + '</h4></div>' +
      (substitutes ? playerList(teamLineup?.substitutes, 'bench-players') :
        '<div class="lineup-meta">' +
          (teamLineup?.formation ? '<span class="formation"><span class="sr">开场阵型 </span>' + e(teamLineup.formation) + '</span>' : '') +
          (teamLineup?.coach ? '<span class="coach">教练 ' + e(teamLineup.coach) + '</span>' : '') +
        '</div>' + playerList(teamLineup?.players, 'starters')) + '</section>';
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
    ['shots', '射门'], ['shotsOnTarget', '射正'], ['xg', '预期进球（xG）'],
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
    return '<table class="match-stats"><thead><tr><th scope="col">常规时间</th>' +
      '<th scope="col">' + e(m.home.zh) + '</th><th scope="col">' + e(m.away.zh) + '</th></tr></thead><tbody>' +
      rows.map(([key, label]) => '<tr><th scope="row">' + label + '</th>' +
        sides.map(side => '<td>' + displayValue(stats[key][side], key) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
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

  function eventList(m, events) {
    if (!Array.isArray(events)) return '<p class="match-note">暂无事件资料</p>';
    const items = events.filter(event => sides.includes(event.side) &&
      (event.type === 'substitution' || (event.type === 'card' && Object.hasOwn(cardNames, event.card))));
    if (!items.length) return '<p class="match-note">无换人及出牌记录</p>';
    return '<ol class="events">' + items.map(event => {
      const minute = event.minute == null ? '—' : event.minute + (event.addedTime > 0 ? '+' + event.addedTime : '') + '′';
      const type = event.type === 'substitution' ? '换人' : cardNames[event.card];
      const description = event.type === 'substitution'
        ? [event.playerIn && '换上 ' + event.playerIn, event.playerOut && '换下 ' + event.playerOut].filter(Boolean).map(e).join('<br>')
        : e(event.player);
      return '<li><span class="event-time">' + e(minute) + '</span><div><span class="event-type ' +
        (event.type === 'card' ? 'event-' + event.card : '') + '">' + type + '</span> <span class="event-team">' +
        e(m[event.side].zh || sideNames[event.side]) + '</span><p>' + description + '</p></div></li>';
    }).join('') + '</ol>';
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
