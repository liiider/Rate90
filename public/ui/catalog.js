(() => {
  'use strict';

  window.Rate90 = {};

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
    const [teams, fixtures, snapshot, collected] = await Promise.all(
      [asset('teams'), asset('fixtures'), asset('process-ratings'),
        asset('collected-index').catch(() => ({fixtures:[], days:{}}))]
    );
    const teamById = new Map(teams.map(t => [t.id, t]));
    function team(id) {
      if (!teamById.has(id)) teamById.set(id, {id, en:String(id), zh:String(id), crest:null});
      return teamById.get(id);
    }
    // Base fixtures supply the schedule. Only a Rate90 snapshot can supply a rating.
    const rows = new Map(fixtures.map(f => [f.id, {...f, rating:null}]));
    const detailFiles = new Map();
    const earlier = (a, b) => Date.parse(a) < Date.parse(b);

    function mergeFixture(fixture, dayFiles) {
      const id = String(fixture.id);
      const previous = rows.get(id) ?? rows.get(fixture.alias);
      const alias = fixture.alias ?? previous?.alias;
      const observedAt = fixture.observedAt ?? fixture.capturedAt;
      const olderSchedule = earlier(observedAt, previous?.observedAt);
      const schedule = olderSchedule ? previous : fixture;
      // Fixtures with no kick-off time are reference entries from the original schedule.
      const sameKickoff = !previous?.time || !fixture.time || (previous.date === fixture.date && previous.time === fixture.time);
      const finished = schedule.status === 'finished';
      const olderScore = sameKickoff && Number.isFinite(previous?.rating) && previous.capturedAt &&
        (fixture.capturedAt === null || earlier(fixture.capturedAt, previous.capturedAt));
      const useNew = finished && fixture.status === 'finished' && (!olderSchedule || sameKickoff) &&
        Number.isFinite(fixture.rating) && !olderScore;
      const keepPrevious = finished && (sameKickoff || olderSchedule) && Number.isFinite(previous?.rating);
      const score = useNew ? fixture : keepPrevious ? previous : null;
      const stylesAt = fixture.stylesCapturedAt ?? fixture.capturedAt;
      const priorStylesAt = previous?.stylesCapturedAt;
      const useStyles = finished && fixture.status === 'finished' && (!olderSchedule || sameKickoff) &&
        Array.isArray(fixture.styles) && (stylesAt || fixture.styleIds?.length || useNew) &&
        (!sameKickoff || !priorStylesAt || (stylesAt && !earlier(stylesAt,priorStylesAt)));
      const tags = useStyles ? fixture : finished && (sameKickoff || olderSchedule) ? previous : null;
      const oldFile = sameKickoff || olderSchedule ? detailFiles.get(id) ?? detailFiles.get(alias) : null;
      const newFile = fixture.status === 'finished' && (sameKickoff || !olderSchedule) ? dayFiles?.file : null;
      const file = finished && ((useNew ? newFile : null) || oldFile || newFile);
      if (alias) {
        rows.delete(alias);
        detailFiles.delete(alias);
      }
      if (file) detailFiles.set(id, file);
      else detailFiles.delete(id);
      rows.set(id, {...previous, ...schedule, id, ...(alias ? {alias} : {}), rating:score?.rating ?? null,
        styles:tags?.styles ?? [], styleIds:tags?.styleIds ?? [], stylesCapturedAt:useStyles ? stylesAt : tags?.stylesCapturedAt,
        capturedAt:useNew ? fixture.capturedAt : score?.capturedAt, observedAt:olderSchedule ? previous.observedAt : observedAt});
    }

    const archivedIds = new Set();
    for (const fixture of snapshot.fixtures ?? []) {
      archivedIds.add(fixture.id);
      const rating = snapshot.matches[fixture.id];
      mergeFixture({...fixture, observedAt:fixture.capturedAt, ...rating}, rating && snapshot.days?.[rating.day]);
    }
    for (const [id, rating] of Object.entries(snapshot.matches)) {
      if (archivedIds.has(id) || !rows.has(id)) continue;
      const previous = rows.get(id);
      mergeFixture({...previous, observedAt:snapshot.updatedAt, ...rating, status:'finished'}, snapshot.days?.[rating.day]);
    }
    for (const fixture of collected.fixtures) mergeFixture(fixture, collected.days[fixture.day]);

    // Providers sometimes assign a new ID when a postponed game is played.
    const fixtureKey = m => {
      const season = Number(m.date.slice(0,4)) - Number(m.date.slice(5,7) < '07');
      return JSON.stringify([season,m.league,m.round,m.home,m.away]);
    };
    const played = new Map();
    for (const m of rows.values()) {
      if (m.status !== 'finished' || m.round == null) continue;
      const key = fixtureKey(m);
      played.set(key,played.has(key) ? null : m.id);
    }
    const superseded = new Map();
    for (const m of rows.values()) {
      const replacement = m.replacedBy || (m.status === 'postponed' && played.get(fixtureKey(m)));
      if (replacement && replacement !== m.id && rows.has(replacement)) superseded.set(m.id,replacement);
    }
    const matches = [...rows.values()].filter(m => !superseded.has(m.id) && m.status !== 'unresolved').map(m => ({...m, round:m.round || '轮次待定', id:String(m.id), home:team(m.home), away:team(m.away),
      styles:m.styles ?? [], styleIds:m.styleIds ?? [], hasDetails:detailFiles.has(m.id), time:m.time || ''}));
    const byId = new Map(matches.map(m => [m.id, m]));
    for (const match of matches) if (match.alias) byId.set(match.alias, match);
    for (const [id,replacement] of superseded) if (byId.has(replacement)) byId.set(id,byId.get(replacement));
    const roundsByLeague = {}, groups = new Map();
    for (const id of Object.keys(leagues)) {
      const games = matches.filter(m => m.league === id).sort((a,b) => a.date.localeCompare(b.date));
      const byRound = new Map();
      for (const game of games) {
        if (!byRound.has(game.round)) byRound.set(game.round, []);
        byRound.get(game.round).push(game);
      }
      groups.set(id,byRound);
      const rounds = [...byRound.keys()];
      rounds.sort((a,b) => typeof a === 'number' && typeof b === 'number' ? a-b :
        byRound.get(a)[0].date.localeCompare(byRound.get(b)[0].date));
      roundsByLeague[id] = rounds;
    }
    const firstDateByRound = new Map();
    for (const m of matches) {
      if (!firstDateByRound.has(m.round) || m.date < firstDateByRound.get(m.round)) firstDateByRound.set(m.round,m.date);
    }
    roundsByLeague.all = [...firstDateByRound.keys()].sort((a,b) =>
      typeof a === 'number' && typeof b === 'number' ? a-b : firstDateByRound.get(a).localeCompare(firstDateByRound.get(b)));
    const availableDates = [...new Set(matches.map(m => m.date).filter(Boolean))].sort();
    const defaultMatchDate = matches.filter(m => Number.isFinite(m.rating)).map(m => m.date).sort().at(-1) ?? availableDates.at(-1) ?? '';
    const times = [snapshot.updatedAt, collected.updatedAt].map(t => Date.parse(t)).filter(Number.isFinite);
    const capturedAt = times.length ? new Date(Math.max(...times)).toISOString() : null;
    return {teams:[...teamById.values()], team, matches, byId, groups, roundsByLeague, availableDates, defaultMatchDate, capturedAt, detailFiles};
  }

  const detailSetCache = new Map();

  async function loadMatchDetails(matchId) {
    const {byId, detailFiles} = await (catalogPending ?? loadCatalog());
    const match = byId.get(String(matchId));
    const file = match && detailFiles.get(match.id);
    if (!file) return null;
    if (!detailSetCache.has(file)) {
      const pending = asset(file).then(feed => new Map(feed.matches.map(m => [String(m.id), m.details])));
      detailSetCache.set(file, pending);
      pending.catch(() => detailSetCache.delete(file));
    }
    const details = (await detailSetCache.get(file)).get(match.id);
    if (!details) return null;
    const {lineups, stats, pressure, events} = details;
    return lineups || stats || pressure || events ? {lineups, stats, pressure, events} : null;
  }

  function ratingTier(value) {
    if (!Number.isFinite(value)) return {cls:'upcoming'};
    if (value >= 9.0) return {cls:'inferno'};
    if (value >= 8.0) return {cls:'great'};
    if (value >= 6.5) return {cls:'good'};
    if (value >= 4.5) return {cls:'mid'};
    return {cls:'low'};
  }

  function isValidDate(str) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str || '') &&
      Number.isFinite(Date.parse(str)) &&
      new Date(str + 'T12:00:00Z').toISOString().startsWith(str);
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
      return (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id);
    });
  }

  function pickHeroIds(sorted) {
    const best = sorted[0];
    return new Set(best?.rating >= 8 ? [best.id] : []);
  }

  function roundName(league, round) {
    if (typeof round === 'number' && round > 0) return (league === 'cl' ? '联赛阶段 ' : '') + '第 ' + round + ' 轮';
    const labels = {'round of 16':'1/8 决赛', 'quarter-finals':'1/4 决赛', 'semi-finals':'半决赛', final:'决赛',
      'knockout phase play-offs':'淘汰赛附加赛'};
    const key = String(round).toLowerCase();
    const qualifier = /^qualification round (\d+)$/.exec(key);
    if (qualifier) return '资格赛第 ' + qualifier[1] + ' 轮';
    if (key === 'playoff round') return '资格赛附加赛';
    return Object.hasOwn(labels,key) ? labels[key] : (round || '轮次待定');
  }
  window.Rate90.catalog = {
    leagues,
    escapeHtml,
    readStore,
    writeStore,
    loadCatalog,
    loadMatchDetails,
    ratingTier,
    isValidDate,
    cnDate,
    dateSpan,
    tagCount,
    sortMatches,
    pickHeroIds,
    roundName
  };
})();
