(() => {
  'use strict';

  window.Rate90 = {};

  const snapshotDate = '2026-11-22';
  const defaultMatchDate = '2026-11-21';

  const leagues = {
    cl: { name: '欧洲冠军联赛', short: '欧冠', region: '欧洲', image: 'cl.svg', round: 4 },
    pl: { name: '英格兰超级联赛', short: '英超', region: '英格兰', image: 'pl.svg', round: 11 },
    ll: { name: '西班牙甲级联赛', short: '西甲', region: '西班牙', image: 'll.svg', round: 13 },
    sa: { name: '意大利甲级联赛', short: '意甲', region: '意大利', image: 'sa.svg', round: 12 },
    bl: { name: '德国甲级联赛', short: '德甲', region: '德国', image: 'bl.svg', round: 10 },
    l1: { name: '法国甲级联赛', short: '法甲', region: '法国', image: 'l1.png', round: 11 }
  };

  let catalogPending;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  function asset(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './ui/data/' + name + '.js';
      script.onload = () => {
        const data = script.rate90Data;
        script.remove();
        if (data === undefined) reject(new Error('未读到数据'));
        else resolve(data);
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('数据文件读取失败'));
      };
      document.head.append(script);
    });
  }

  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem('rate90.v2.' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem('rate90.v2.' + key, JSON.stringify(value));
    } catch {}
  }

  function loadCatalog() {
    catalogPending = readCatalog();
    return catalogPending;
  }

  async function readCatalog() {
    const [teams, fixtures, samples, collected] = await Promise.all(
      ['teams', 'fixtures', 'process-ratings', 'collected-index'].map(asset)
    );
    const teamById = new Map(teams.map(t => [t.id, t]));
    const team = id => teamById.get(id) || { id: String(id), en: String(id), zh: String(id), crest: null };
    const rows = new Map();
    const detailFiles = new Map();
    const previewFiles = new Map();
    for (const fixture of fixtures) {
      const sample = samples.matches[fixture.id];
      rows.set(fixture.id, sample ? {...fixture, rating:sample.rating, source:'Rate90', styles:sample.styles, chances:sample.chances} : fixture);
      if (sample) previewFiles.set(fixture.id, 'sample-' + sample.day);
      if (sample) detailFiles.set(fixture.id, 'sample-' + sample.day + '-details');
    }
    for (const fixture of collected.fixtures) {
      const previous = rows.get(fixture.id) ?? rows.get(fixture.alias);
      if (fixture.alias) rows.delete(fixture.alias);
      const rating = fixture.status === 'finished' ? fixture.rating ?? previous?.rating ?? null : null;
      const source = Number.isFinite(fixture.rating) ? 'Rate90' : previous?.source;
      rows.set(fixture.id, {...previous, ...fixture, rating, source});
      const preview = collected.days[fixture.day]?.previewFile;
      if (preview) previewFiles.set(fixture.id, preview);
      const file = collected.days[fixture.day]?.file;
      if (file) detailFiles.set(fixture.id, file);
    }
    const matches = [...rows.values()].map(m => ({
      ...m,
      id: String(m.id),
      home: team(m.home),
      away: team(m.away),
      source: Number.isFinite(m.rating) ? m.source || 'MustWatch90' : null,
      hasPreview: previewFiles.has(m.id),
      time: m.time || ''
    }));
    const byId = new Map(matches.map(m => [m.id, m]));
    for (const match of matches) {
      if (match.alias) byId.set(match.alias, match);
    }
    const latestRatedRound = {};
    for (const id of Object.keys(leagues)) {
      const rounds = matches.filter(m => m.league === id && m.rating !== null).map(m => m.round);
      latestRatedRound[id] = rounds.length ? Math.max(...rounds) : leagues[id].round;
    }
    const availableDates = [...new Set(matches.map(m => m.date).filter(Boolean))].sort();
    return { teams, team, matches, byId, latestRatedRound, availableDates, detailFiles, previewFiles };
  }

  let resultsCache = null;
  let resultsPending = null;
  const detailSetCache = new Map();

  async function readMatchFile(file, id) {
    if (!file) return null;
    if (!detailSetCache.has(file)) {
      const pending = asset(file).then(feed => new Map(feed.matches.map(m => [String(m.id), m])));
      detailSetCache.set(file, pending);
      pending.catch(() => detailSetCache.delete(file));
    }
    return (await detailSetCache.get(file)).get(id);
  }

  async function loadViewingProfile(matchId) {
    const {byId, previewFiles} = await (catalogPending ?? loadCatalog());
    const id = byId.get(matchId)?.id ?? matchId;
    const card = await readMatchFile(previewFiles.get(id), id);
    return card?.viewing ?? null;
  }

  async function loadMatchDetails(matchId) {
    const {byId, detailFiles} = await (catalogPending ?? loadCatalog());
    const id = byId.get(matchId)?.id ?? matchId;
    const card = await readMatchFile(detailFiles.get(id), id);
    if (card?.details) return card.details;
    if (!resultsCache) {
      resultsPending ??= asset('results').finally(() => { resultsPending = null; });
      resultsCache = await resultsPending;
    }
    return {score90:resultsCache[id] ?? resultsCache[matchId] ?? null};
  }

  function ratingTier(value) {
    if (!Number.isFinite(value)) return { cls: 'upcoming', label: '未开赛' };
    if (value >= 9.0) return { cls: 'inferno', label: '超燃必看' };
    if (value >= 8.0) return { cls: 'great', label: '焦点之战' };
    if (value >= 6.5) return { cls: 'good', label: '看看集锦' };
    if (value >= 4.5) return { cls: 'mid', label: '看看集锦' };
    return { cls: 'low', label: '可跳过' };
  }

  function dayOffset(date, days) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function isValidDate(str) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str || '') &&
      Number.isFinite(Date.parse(str)) &&
      new Date(str + 'T12:00:00Z').toISOString().startsWith(str);
  }

  function weekdayLabel(date) {
    if (!isValidDate(date)) return '';
    return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
  }

  function cnDate(date) {
    if (!date || date.length < 10) return date || '';
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    return m + '月' + d + '日';
  }

  function dateSpan(matches) {
    const dates = matches.map(m => m.date).filter(Boolean).sort();
    if (!dates.length) return '';
    const first = cnDate(dates[0]);
    const last = cnDate(dates[dates.length - 1]);
    return first === last ? first : first + ' – ' + last;
  }

  function nearestMatchDates(date, dates) {
    let prev = null;
    let next = null;
    for (const d of dates) {
      if (d < date) prev = d;
      if (d > date && !next) next = d;
    }
    return [prev, next].filter(Boolean);
  }

  const tagCount = m => (Array.isArray(m?.styles) ? m.styles.length : 0);

  function sortMatches(list) {
    return [...list].sort((a, b) => {
      const aRated = Number.isFinite(a.rating);
      const bRated = Number.isFinite(b.rating);
      if (aRated !== bRated) return aRated ? -1 : 1;
      if (aRated && bRated) {
        if (b.rating !== a.rating) return b.rating - a.rating;
        const tagDiff = tagCount(b) - tagCount(a);
        if (tagDiff !== 0) return tagDiff;
      }
      if (a.date !== b.date) return aRated ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
      return (a.time || '99:99').localeCompare(b.time || '99:99');
    });
  }

  function pickHeroIds(sorted) {
    const rated = sorted.filter(m => Number.isFinite(m.rating));
    if (!rated.length) return new Set();
    const maxRating = rated[0].rating;
    const topRated = rated.filter(m => m.rating === maxRating);
    const maxTags = Math.max(...topRated.map(tagCount));
    return new Set(topRated.filter(m => tagCount(m) === maxTags).map(m => m.id));
  }

  const roundName = (league, n) => league === 'cl' ? '联赛阶段 第 ' + n + ' 轮' : '第 ' + n + ' 轮';
  const venueFor = league => league === 'cl'
    ? ['爱奇艺体育', 'https://www.iqiyi.com/']
    : league === 'bl'
      ? ['央视频', 'https://www.yangshipin.cn/']
      : ['咪咕视频', 'https://www.miguvideo.com/'];

  window.Rate90.catalog = {
    snapshotDate,
    defaultMatchDate,
    leagues,
    escapeHtml,
    readStore,
    writeStore,
    loadCatalog,
    loadMatchDetails,
    loadViewingProfile,
    ratingTier,
    dayOffset,
    isValidDate,
    weekdayLabel,
    cnDate,
    dateSpan,
    nearestMatchDates,
    tagCount,
    sortMatches,
    pickHeroIds,
    roundName,
    venueFor
  };
})();
