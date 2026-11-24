(() => {
  'use strict';

  const { escapeHtml: e, leagues, ratingTier, cnDate, roundName } = window.Rate90.catalog;

  const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    bookmark: '<path d="M6.5 4h11v16.5L12 16.8l-5.5 3.7V4Z"/>',
    bookmarkFilled: '<path fill="currentColor" d="M6.5 4h11v16.5L12 16.8l-5.5 3.7V4Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.2 14.3A8.2 8.2 0 1 1 9.7 3.8a6.8 6.8 0 0 0 10.5 10.5Z"/>',
    left: '<path d="m14.5 6.5-5.5 5.5 5.5 5.5"/>',
    right: '<path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>',
    close: '<path d="m6.5 6.5 11 11M6.5 17.5l11-11"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    external: '<path d="M14 5h5v5M19 5l-9 9M10 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l2-2a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2 2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
    flame: '<path fill="currentColor" stroke="none" d="M12.6 2.3c.3 2.5-1.1 4.2-2.4 5.6-1.3 1.3-2.5 2.6-2.5 4.9 0 2.5 1.9 4.5 4.3 4.5 2.5 0 4.4-2 4.4-4.7 0-1.6-.7-3.1-1.6-4.2-.2 1.2-.9 2.1-1.9 2.5.4-1.5.2-3.4-.3-4.6 0 0 1.4.8 2.4 2.1 1.6 2 2.5 4.1 2.5 6.4 0 4.2-3.3 7.2-7.5 7.2-4.1 0-7.4-3.1-7.4-7.2 0-3.1 1.8-5.4 3.9-7.4 1.8-1.7 3.8-3.3 6.1-5.1Z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    tagExchange: '<path d="M5 9h14m0 0-3.5-3.5M19 9l-3.5 3.5M19 15H5m0 0 3.5-3.5M5 15l3.5 3.5"/>',
    tagPress: '<path d="m5 7 5 5-5 5M11 7l5 5-5 5M19 6v12"/>',
    tagSteady: '<path d="M5 18V9M9.5 18V7M14.5 18V8M19 18V6M3.5 18h17"/>',
    tagBurst: '<path d="M5 18v-3M9.5 18v-5M14.5 18V5M19 18v-4M3.5 18h17"/>',
    tagCalm: '<path d="M6 7v10M11 7v10M15 12c1.2-2 2.8-2 4 0"/>',
    tagShots: '<path d="M4 9h5M4 12h4M4 15h5"/><circle cx="15.5" cy="12" r="4.5"/><circle cx="15.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    tagSpark: '<path d="M12 3.5 14 9.5 20 11.5 14 13.5 12 19.5 10 13.5 4 11.5 10 9.5Z"/>',
    tagDot: '<circle cx="12" cy="12" r="4"/>'
  };

  const styleIconMap = {
    '双向对攻': 'tagExchange',
    '双方对攻': 'tagExchange',
    '单边压制': 'tagPress',
    '机会贯穿全场': 'tagSteady',
    '机会集中': 'tagBurst',
    '节奏舒缓': 'tagCalm',
    '射门密集': 'tagShots',
    '良机频现': 'tagSpark'
  };

  function icon(name) {
    return '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg>';
  }

  function leagueIcon(id, size = '') {
    const l = leagues[id];
    if (!l) return '';
    return '<span class="league-ic ' + size + '" aria-hidden="true"><img src="./ui/leagues/' + e(l.image) + '" alt=""></span>';
  }

  function leagueRail(selected) {
    const allActive = selected === 'all';
    const items = [
      '<button type="button" class="rail-item' + (allActive ? ' active' : '') + '" aria-pressed="' + allActive + '" data-act="league" data-val="all">' +
        '<span class="rail-all-ic" aria-hidden="true">' + icon('grid') + '</span>' +
        '<span class="rail-label">全部赛事</span>' +
      '</button>',
      ...Object.entries(leagues).map(([id, l]) => {
        const active = selected === id;
        return '<button type="button" class="rail-item' + (active ? ' active' : '') + '" aria-pressed="' + active + '" data-act="league" data-val="' + id + '" title="' + e(l.name) + '">' +
          leagueIcon(id, 'rail-ic') +
          '<span class="rail-label">' + e(l.short) + '</span>' +
        '</button>';
      })
    ];
    return '<nav class="rail-nav" aria-label="赛事列表">' + items.join('') + '</nav>';
  }

  function crest(team, size = '') {
    const hasImg = Boolean(team.crest);
    return '<span class="crest ' + size + (hasImg ? ' has-img' : '') + '" aria-hidden="true">' +
      (hasImg ? '<img src="./ui/crests/' + e(team.crest) + '" alt="" loading="lazy">' : e(team.zh.slice(0, 2))) +
      '</span>';
  }

  function scoreBlock(rating) {
    if (!Number.isFinite(rating)) {
      return '<span class="score-block upcoming" aria-label="暂无评分">—</span>';
    }
    const t = ratingTier(rating);
    return '<span class="score-block ' + t.cls + '" aria-label="评分 ' + rating.toFixed(1) + '">' +
      rating.toFixed(1) +
    '</span>';
  }

  function scoreMini(rating) {
    if (!Number.isFinite(rating)) return '<span class="mini-score upcoming">—</span>';
    const t = ratingTier(rating);
    return '<span class="mini-score ' + t.cls + '">' + rating.toFixed(1) + '</span>';
  }

  function styleTagPills(styles) {
    if (!Array.isArray(styles) || !styles.length) return '';
    return '<span class="style-tags">' +
      styles.map(label => {
        const sym = styleIconMap[label] || 'tagDot';
        return '<span class="style-tag">' + icon(sym) + e(label) + '</span>';
      }).join('') +
    '</span>';
  }

  function cardTierClass(rating, isHero) {
    if (!Number.isFinite(rating)) return ' is-upcoming';
    if (rating >= 9.0) return ' tier-inferno';
    if (rating >= 8.0) return ' tier-focus';
    if (isHero) return ' tier-highlights';
    if (rating < 4.5) return ' is-low';
    return '';
  }

  function matchCard(m, opts = {}) {
    const showLeagueIcon = typeof opts === 'boolean' ? opts : Boolean(opts.showLeagueIcon);
    const isHero = typeof opts === 'object' && Boolean(opts.isHero);
    const l = leagues[m.league];
    const timeText = m.time || '--:--';
    const tierCls = cardTierClass(m.rating, isHero);
    const hasGlow = Number.isFinite(m.rating) && (m.rating >= 8.0 || isHero);

    let ribbon = '';
    if (isHero && Number.isFinite(m.rating)) {
      const isInferno = m.rating >= 9.0;
      const isFocus = !isInferno && m.rating >= 8.0;
      const badgeHtml = isInferno ? icon('flame') + '超燃必看' : isFocus ? '焦点之战' : '看看集锦';
      const metaText = l.short + ' · ' + roundName(m.league, m.round) + ' · ' + cnDate(m.date);
      ribbon = '<span class="card-ribbon">' +
        '<span class="hero-badge">' + badgeHtml + '</span>' +
        '<span class="hero-meta">' + e(metaText) + '</span>' +
      '</span>';
    }

    const crestSize = isHero ? 'hero' : 'card';
    const tags = styleTagPills(m.styles);

    return '<button type="button" class="match-card' + (isHero ? ' is-hero' : '') + tierCls + '" data-act="details" data-val="' + e(m.id) + '">' +
      (hasGlow ? '<span class="card-glow" aria-hidden="true"></span>' : '') +
      ribbon +
      '<span class="card-main">' +
        '<span class="card-time">' +
          (showLeagueIcon ? leagueIcon(m.league, 'card-ic') : '') +
          '<span class="time-val' + (m.time ? '' : ' is-empty') + '">' + e(timeText) + '</span>' +
        '</span>' +
        '<span class="side home"><span class="team-name">' + e(m.home.zh) + '</span>' + crest(m.home, crestSize) + '</span>' +
        '<span class="vs" aria-hidden="true">VS</span>' +
        '<span class="side away">' + crest(m.away, crestSize) + '<span class="team-name">' + e(m.away.zh) + '</span></span>' +
        '<span class="card-score">' + scoreBlock(m.rating) + '</span>' +
      '</span>' +
      (tags ? '<span class="card-tags-row">' + tags + '</span>' : '') +
    '</button>';
  }

  function viewingPreview(viewing, fallbackStyles) {
    const styles = viewing?.styles?.length ? viewing.styles : (fallbackStyles || []);
    const metrics = [];
    if (Number.isInteger(viewing?.shots)) metrics.push(viewing.shots + ' 脚射门');
    if (Number.isInteger(viewing?.chances)) metrics.push(viewing.chances + ' 次关键机会');
    if (Number.isFinite(viewing?.xg)) metrics.push('总 xG ' + viewing.xg.toFixed(2));
    if (!styles.length && !metrics.length) return '';
    return '<div class="preview-strip">' +
      styleTagPills(styles) +
      (metrics.length ? '<div class="preview-metrics">' + e(metrics.join(' · ')) + '</div>' : '') +
    '</div>';
  }

  function miniMatchRow(m) {
    const l = leagues[m.league];
    return '<button type="button" class="mini-row" data-act="details" data-val="' + e(m.id) + '">' +
      '<span class="mini-info">' +
        '<strong>' + e(m.home.zh) + ' vs ' + e(m.away.zh) + '</strong>' +
        '<small>' + e(l.short) + ' · ' + e(cnDate(m.date)) + (m.time ? ' ' + e(m.time) : '') + '</small>' +
      '</span>' +
      scoreMini(m.rating) +
    '</button>';
  }

  function dialogHead(title, eyebrow = '') {
    return '<div class="dialog-head">' +
      '<div>' +
        (eyebrow ? '<div class="dialog-eyebrow">' + e(eyebrow) + '</div>' : '') +
        (title ? '<h2 id="dialog-title">' + e(title) + '</h2>' : '') +
      '</div>' +
      '<button type="button" class="icon-btn" data-act="close" aria-label="关闭" title="关闭">' + icon('close') + '</button>' +
    '</div>';
  }

  function revealedEvidence(details) {
    const score = Array.isArray(details.score90) ? details.score90.join(' : ') : '暂无比分';
    let html = '<div class="score-reveal">' +
      '<div><div class="reveal-label">全场比分</div><div class="scoreline">' + e(score) + '</div></div>' +
      '<button type="button" class="text-btn" data-act="hideScore">重新隐藏</button>' +
    '</div>';

    if (details.reason) {
      html += '<p class="evidence-reason">' + e(details.reason) +
        (Number.isFinite(details.xg90) ? ' 常规时间总 xG ' + details.xg90.toFixed(2) + '。' : '') +
      '</p>';
    }

    if (Array.isArray(details.shotsByWindow)) {
      const peak = Math.max(1, ...details.shotsByWindow);
      const labels = ['1–15′', '16–30′', '31–45′', '46–60′', '61–75′', '76–90′'];
      html += '<div class="rhythm-title">每 15 分钟射门节奏</div><div class="rhythm-bars">' +
        details.shotsByWindow.map((n, i) =>
          '<div class="rhythm-col">' +
            '<span>' + e(n) + '</span>' +
            '<i style="height:' + Math.max(5, Math.round((n / peak) * 40)) + 'px"></i>' +
            '<span>' + labels[i] + '</span>' +
          '</div>'
        ).join('') +
      '</div>';
    }
    return html;
  }

  window.Rate90.components = {
    icon,
    leagueIcon,
    leagueRail,
    crest,
    scoreBlock,
    scoreMini,
    styleTagPills,
    matchCard,
    viewingPreview,
    miniMatchRow,
    dialogHead,
    revealedEvidence
  };
})();
