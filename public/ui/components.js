(() => {
  'use strict';

  const { escapeHtml: e, leagues, ratingTier, cnDate, roundName } = window.Rate90.catalog;

  // Morphicons-compatible icon definitions (24x24 optical stroke grid)
  const morphDefs = {
    sun: [
      ['circle', { cx: 12, cy: 12, r: 3.8 }],
      ['path', { d: 'M12 2.75v2M12 19.25v2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M2.75 12h2M19.25 12h2M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41' }]
    ],
    moon: 'M20.2 14.3A8.1 8.1 0 1 1 9.7 3.8a6.6 6.6 0 0 0 10.5 10.5Z',
    external: 'M14 5h5v5M19 5l-9.5 9.5M10.5 6.5H6.8A1.8 1.8 0 0 0 5 8.3v8.9A1.8 1.8 0 0 0 6.8 19h8.9a1.8 1.8 0 0 0 1.8-1.8v-3.7',
    check: 'M5 12.6 9.6 17.2 19.2 7.2',
    link: 'M10.2 13.8a4.3 4.3 0 0 0 6.1 0l2.2-2.2a4.3 4.3 0 0 0-6.1-6.1l-1.2 1.2M13.8 10.2a4.3 4.3 0 0 0-6.1 0l-2.2 2.2a4.3 4.3 0 0 0 6.1 6.1l1.2-1.2',
    right: 'M9.5 6.5 15 12l-5.5 5.5',
    down: 'M6.5 9.5 12 15l5.5-5.5'
  };

  const paths = {
    history: '<path d="M3.5 11.5a8.5 8.5 0 1 1 2.1 5.7M3.5 5.5v6h6M12 7.8v4.5l3 1.9"/>',
    undo: '<path d="M5 10.5h9a4.5 4.5 0 0 1 0 9h-2M5 10.5l4-4M5 10.5l4 4"/>',
    left: '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    close: '<path d="m7 7 10 10M7 17 17 7"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    tagDot: '<circle cx="12" cy="12" r="3.5"/>'
  };

  // Unified tactical-editorial geometric glyph system (24x24 grid, 1.7px uniform stroke)
  const styleArt = {
    'heavyweights': [
      'duel',
      '<path d="M12 3.5 20 8v5.5c0 4-3.3 6.5-8 7.8-4.7-1.3-8-3.8-8-7.8V8l8-4.5Z"/><path d="M12 3.5v17.8M8.2 11.2 12 8.5l3.8 2.7"/>',
      '两队上赛季均进入欧冠八强或五大联赛前二。'
    ],
    'rivalry': [
      'duel',
      '<path d="M5 5v14M19 5v14M13.5 5.5 9.8 12h4.4l-3.7 6.5"/>',
      '这对老对手又碰面了。'
    ],
    'talisman': [
      'attack',
      '<path d="M12 3.2 14.3 9.7 20.8 12l-6.5 2.3L12 20.8l-2.3-6.5L3.2 12l6.5-2.3L12 3.2Z"/>',
      '有一名球员在决定比赛走向的时刻格外抢眼。'
    ],
    'flashpoint-player': [
      'duel',
      '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.8"/><path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7"/>',
      '一名球员在多个改变局面的瞬间成为焦点，表现起伏很大。'
    ],
    'contested-call': [
      'duel',
      '<rect x="7" y="4.2" width="10" height="15.6" rx="1.8" transform="rotate(-11 12 12)"/><path d="m5 19 14-14"/>',
      '赛后独立裁判评议认定，本场有关键判罚出错。'
    ],
    'var-spotlight': [
      'duel',
      '<rect x="3.5" y="5" width="17" height="11.5" rx="2"/><path d="M8.5 20h7M12 16.5V20M8 9.2l1.8 3.6 1.8-3.6M14.2 12.8V9.2h1.6a1.1 1.1 0 0 1 0 2.2h-1.6"/>',
      '一次涉及进球、点球或红牌的复核值得回看。'
    ],
    'end-to-end': [
      'rhythm',
      '<path d="M4.5 8.5h15m-3.6-3.5 3.6 3.5-3.6 3.5M19.5 15.5h-15m3.6-3.5-3.6 3.5 3.6 3.5"/>',
      '双方在多个时段互有攻势，都能把球打到危险区域。'
    ],
    'team-move': [
      'attack',
      '<circle cx="5.5" cy="17.5" r="2"/><circle cx="12" cy="6.2" r="2"/><circle cx="18.5" cy="15.5" r="2"/><path d="m6.6 15.7 4.2-7.6m2.4.1 4.1 5.6M7.5 17.2l9-1.4"/>',
      '留意多人连续传递打穿防线的那次配合。'
    ],
    'keeper-show': [
      'defense',
      '<path d="M4 19V7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V19"/><path d="M7.5 17c1.2-4.2 4.3-6.8 8.8-7.4M13.5 7.7l3 1.9-2 2.9"/>',
      '高难度扑救接连出现，门线上的表现值得看。'
    ],
    'late-drama': [
      'rhythm',
      '<circle cx="12" cy="13" r="7.5"/><path d="M9.5 3h5M12 5.5V3M12 13V8.2M12 13l4.2 2.4"/>',
      '比赛进入尾声时局面依然紧，门前还有连续机会。'
    ]
  };

  const morphInstances = new WeakMap();
  const morphState = new WeakMap();

  function morphPathData(name) {
    const def = morphDefs[name];
    if (!def) return '';
    if (window.Morphicons?.canonicalD) {
      try { return window.Morphicons.canonicalD(def); } catch {}
    }
    if (typeof def === 'string') return def;
    return def.map(([tag, a]) => {
      if (tag === 'path') return a.d;
      if (tag === 'circle') {
        const { cx, cy, r } = a;
        return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
      }
      return '';
    }).join(' ');
  }

  function icon(name) {
    if (Object.hasOwn(morphDefs, name)) {
      return '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
        '<path class="morph-path" data-morph="' + e(name) + '" d="' + morphPathData(name) + '"/></svg>';
    }
    const body = paths[name] || styleArt[name]?.[1] || '';
    const sw = styleArt[name] ? '1.65' : '1.75';
    return '<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  function morphTo(container, name, preset = 'snappy') {
    const pathEl = container?.querySelector?.('.morph-path');
    if (!pathEl || !Object.hasOwn(morphDefs, name)) return;
    const current = morphState.get(pathEl) || pathEl.dataset.morph;
    if (current === name) return;
    morphState.set(pathEl, name);
    pathEl.dataset.morph = name;

    if (window.Morphicons?.createMorph) {
      let instance = morphInstances.get(pathEl);
      if (!instance) {
        try {
          instance = window.Morphicons.createMorph(pathEl, morphDefs[current] || morphDefs[name], {
            reducedMotion: 'user',
            strokeWidth: 1.75
          });
          morphInstances.set(pathEl, instance);
        } catch {
          pathEl.setAttribute('d', morphPathData(name));
          return;
        }
      }
      try {
        instance.morphTo(morphDefs[name], preset);
        return;
      } catch {}
    }
    pathEl.setAttribute('d', morphPathData(name));
  }

  function leagueIcon(id, size = '') {
    const l = leagues[id];
    if (!l) return '';
    return '<span class="league-ic ' + size + '" aria-hidden="true"><img src="./ui/leagues/' + e(l.image) + '" alt=""></span>';
  }

  function leagueRail(selected) {
    const items = [['all', { short: '全部赛事', name: '全部赛事' }], ...Object.entries(leagues)].map(([id, l]) => {
      const active = selected === id;
      const mark = id === 'all' ? '<span class="rail-all-ic" aria-hidden="true">' + icon('grid') + '</span>' : leagueIcon(id, 'rail-ic');
      return '<button type="button" class="rail-item' + (active ? ' active' : '') + '" aria-pressed="' + active + '" data-act="league" data-val="' + id + '" title="' + e(l.name) + '">' +
        mark + '<span class="rail-label">' + e(l.short) + '</span></button>';
    });
    return '<nav class="rail-nav" aria-label="赛事列表">' + items.join('') + '</nav>';
  }

  function defaultCrestSvg() {
    return '<svg class="crest-fallback-svg" aria-hidden="true" viewBox="0 0 24 24" fill="none">' +
      '<path class="shield-fill" d="M12 2.4 19.6 5.6v6.2c0 4.8-3.2 8-7.6 9.8-4.4-1.8-7.6-5-7.6-9.8V5.6L12 2.4Z"/>' +
      '<path class="shield-half" d="M12 2.4 19.6 5.6v6.2c0 4.8-3.2 8-7.6 9.8V2.4Z"/>' +
      '<path class="shield-stroke" d="M12 2.4 19.6 5.6v6.2c0 4.8-3.2 8-7.6 9.8-4.4-1.8-7.6-5-7.6-9.8V5.6L12 2.4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<circle class="shield-core" cx="12" cy="11.2" r="2.7" stroke="currentColor" stroke-width="1.3"/>' +
    '</svg>';
  }

  function crest(team, size = '') {
    const hasImg = Boolean(team.crest);
    return '<span class="crest ' + size + (hasImg ? ' has-img' : ' is-fallback') + '" aria-hidden="true">' +
      (hasImg ? '<img src="./ui/crests/' + e(team.crest) + '" alt="" loading="lazy">' : defaultCrestSvg()) +
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

  function styleTagPills(m, withNames = false) {
    const ids = (m.styleIds || []).filter(id => Object.hasOwn(styleArt, id));
    if (!ids.length) return '';
    const tags = ids.map(id => {
      const [tone, , description] = styleArt[id];
      const label = e(m.styles[m.styleIds.indexOf(id)]);
      const tipAttr = withNames ? ' title="' + label + '"' : ' data-tip="' + label + '"';
      const pill = '<span class="style-tag style-' + tone + '" role="img" aria-label="' + label + '"' + tipAttr + '>' + icon(id) + '</span>';
      return withNames ? '<li>' + pill + '<span><b>' + label + '</b><small>' + e(description) + '</small></span></li>' : pill;
    });
    return withNames ? '<ul class="reason-list">' + tags.join('') + '</ul>' :
      '<span class="style-tags icon-tags">' + tags.join('') + '</span>';
  }

  function detailHeroTags(m) {
    const ids = (m.styleIds || []).filter(id => Object.hasOwn(styleArt, id));
    if (!ids.length) return '';
    const items = ids.map(id => {
      const [tone, , description] = styleArt[id];
      const label = e(m.styles[m.styleIds.indexOf(id)]);
      return '<span class="hero-tag style-' + tone + '" tabindex="0" aria-label="' + label + '：' + e(description) + '">' +
        icon(id) +
        '<span class="hero-tag-tip" role="tooltip"><b>' + label + '</b><small>' + e(description) + '</small></span>' +
      '</span>';
    }).join('');
    return '<div class="detail-hero-tags" aria-label="比赛标签">' + items + '</div>';
  }

  function watchLabel(m, watched) {
    return '去看 ' + m.home.zh + ' 对 ' + m.away.zh + '，打开咪咕体育首页' + (watched ? '，已看过' : '');
  }

  function canWatch(m) {
    return m.status === 'finished' || (m.status == null && Number.isFinite(m.rating));
  }

  function watchLink(m, watched) {
    if (!canWatch(m)) return '';
    return '<a class="btn watch-link' + (watched ? ' is-watched' : '') + '" data-act="watch" data-val="' + e(m.id) +
      '" href="https://www.miguvideo.com/" target="_blank" rel="noopener noreferrer" title="打开咪咕体育首页" aria-label="' +
      e(watchLabel(m, watched)) + '">' +
      '<span class="watch-text">去看</span><span class="watch-icon">' + icon(watched ? 'check' : 'external') + '</span></a>';
  }

  function cardTierClass(rating, isHero) {
    if (!Number.isFinite(rating)) return ' is-upcoming';
    if (rating >= 9.0) return ' tier-inferno';
    if (rating >= 8.0) return ' tier-focus';
    if (isHero) return ' tier-highlights';
    if (rating < 4.5) return ' is-low';
    return '';
  }

  function matchCard(m, { showLeagueIcon, showCompetition = false, isHero, watched } = {}) {
    const l = leagues[m.league];
    const meta = l.short + ' · ' + roundName(m.league, m.round);
    const time = cnDate(m.date) + (m.time ? ' ' + m.time : '');
    const crestSize = isHero ? 'hero' : 'card';
    const tags = styleTagPills(m);
    const watch = watchLink(m, watched);
    return '<article class="match-card' + (isHero ? ' is-hero' : '') + (watch ? ' has-watch' : '') + (tags ? ' has-tags' : '') + cardTierClass(m.rating, isHero) + '">' +
      (Number.isFinite(m.rating) && (m.rating >= 8 || isHero) ? '<span class="card-glow" aria-hidden="true"></span>' : '') +
      '<button type="button" class="card-details" data-act="details" data-val="' + e(m.id) + '">' +
        '<span class="card-main">' +
          '<span class="card-time">' + (showLeagueIcon ? leagueIcon(m.league, 'card-ic') : '') +
            '<span class="card-meta">' +
              (showCompetition ? '<span class="competition">' + e(meta) + '</span>' : '') +
              '<span class="time-val">' + e(time) + '</span>' +
              (tags ? '<span class="card-tags-inline">' + tags + '</span>' : '') +
            '</span>' +
          '</span>' +
          '<span class="side home"><span class="team-name">' + e(m.home.zh) + '</span>' + crest(m.home, crestSize) + '</span>' +
          '<span class="vs">vs</span>' +
          '<span class="side away">' + crest(m.away, crestSize) + '<span class="team-name">' + e(m.away.zh) + '</span></span>' +
          '<span class="card-score">' + scoreBlock(m.rating) + '</span>' +
        '</span>' +
      '</button>' + watch +
    '</article>';
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

  window.Rate90.components = {
    icon,
    morphTo,
    defaultCrestSvg,
    leagueIcon,
    leagueRail,
    crest,
    scoreBlock,
    scoreMini,
    styleTagPills,
    detailHeroTags,
    matchCard,
    canWatch,
    watchLink,
    watchLabel,
    miniMatchRow,
    dialogHead
  };
})();
