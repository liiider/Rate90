import {createHash} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {beijingDate, summarize} from '../server/bsd.mjs';
import {assetDirectory, atomicAsset, readAsset} from '../server/collected-feed.mjs';
import {formatFeed, rateMatch, ruleVersion} from '../server/recommend.mjs';
import {selectRounds} from './fetch-test-round.mjs';

const sampleFile = new URL('../data/bsd-sample.json', import.meta.url);
const archives = fileURLToPath(new URL('../data/round-tests/', import.meta.url));
const leagueCodes = new Map([[1,'pl'], [3,'ll'], [4,'sa'], [5,'bl'], [6,'l1'], [7,'cl']]);
const hour = 3600000;
const viewingDay = kickoff => beijingDate(new Date(Date.parse(kickoff) + 12 * hour));

function groupByDay(matches) {
  const groups = new Map();
  for (const match of matches) {
    const day = viewingDay(match.kickoff);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(match);
  }
  return groups;
}

async function readRound(roundDir, fixtures, teams, expectedRounds) {
  const manifest = JSON.parse(await readFile(join(roundDir, 'manifest.json'), 'utf8'));
  if (!manifest.complete || !manifest.matches?.length || !manifest.rounds?.length || !Number.isFinite(Date.parse(manifest.finishedAt))) {
    throw Error('本轮归档未完成，保留已发布的快照');
  }
  const scope = new Map(manifest.rounds.map(r => [r.league + '/' + r.round, r]));
  if (scope.size !== manifest.rounds.length || expectedRounds?.some(r => !scope.has(r.league + '/' + r.round))) {
    throw Error('联赛或轮次归档不完整，保留已发布的快照');
  }
  const byFixture = new Map(fixtures.map(f => [f.id, f]));
  const byTeam = new Map(teams.map(t => [t.id, t]));
  const byName = new Map(teams.map(t => [t.en, t.id]));
  const ids = new Set(), aliases = new Set(), rows = [];
  for (const entry of manifest.matches) {
    const id = String(entry.eventId);
    if (!Number.isSafeInteger(entry.eventId) || entry.eventId < 1 || !entry.fixtureId ||
        entry.file !== 'events/' + id + '.json' || entry.error || ids.has(id) || aliases.has(entry.fixtureId)) {
      throw Error('归档缺项或比赛 ID 重复：' + entry.fixtureId);
    }
    const event = JSON.parse(await readFile(join(roundDir, entry.file), 'utf8'));
    const prior = byFixture.get(entry.fixtureId) ?? byFixture.get(id);
    const league = leagueCodes.get(event.league?.id);
    const at = Date.parse(event.event_date);
    if (String(event.id) !== id || !league || league !== entry.league || !scope.has(league + '/' + entry.round) ||
        !event.status || event.status !== entry.status ||
        !Number.isFinite(at) || !Number.isInteger(entry.round) || Number(event.round_number) !== entry.round ||
        (prior && (prior.league !== league || prior.round !== entry.round))) {
      throw Error('比赛身份、轮次或状态与归档不一致：' + id);
    }
    function teamId(side) {
      const name = event[side + '_team'];
      if (typeof name !== 'string' || !name.trim()) throw Error('缺少球队名称：' + id);
      const providerId = String(event[side + '_team_obj']?.id ?? '');
      if (prior && prior[side] !== providerId && byTeam.get(prior[side])?.en !== name && prior[side] !== name) {
        throw Error('球队与已有赛程不一致：' + id);
      }
      return prior?.[side] ?? (byTeam.has(providerId) ? providerId : byName.get(name) ?? name);
    }
    const fixture = {id, ...(entry.fixtureId !== id ? {alias:entry.fixtureId} : {}), league, round:entry.round,
      date:beijingDate(new Date(at)), time:new Date(at + 8 * hour).toISOString().slice(11, 16),
      day:viewingDay(event.event_date), home:teamId('home'), away:teamId('away'), status:event.status,
      capturedAt:entry.fetchedAt ?? manifest.finishedAt};
    if (!Number.isFinite(Date.parse(fixture.capturedAt))) throw Error('归档缺少采集时间：' + id);
    rows.push({fixture, summary:event.status === 'finished' ? summarize(event) : null});
    ids.add(id);
    aliases.add(entry.fixtureId);
  }
  for (const round of manifest.rounds) {
    const inRound = f => f.league === round.league && f.round === round.round;
    if (rows.filter(r => inRound(r.fixture)).length !== round.scheduled ||
        fixtures.some(f => inRound(f) && !ids.has(f.id) && !aliases.has(f.id))) {
      throw Error('归档场数与赛程不一致，保留已发布的快照');
    }
  }
  if (manifest.fullResponses !== rows.length) throw Error('归档场数不完整，保留已发布的快照');
  return {updatedAt:manifest.finishedAt, rows};
}

export async function buildOfflineSnapshot({roundDir, baseDir = assetDirectory, outputDir = assetDirectory} = {}) {
  const [fixtures, teams, sample] = await Promise.all([
    readAsset(baseDir, 'fixtures'), readAsset(baseDir, 'teams'), readFile(sampleFile, 'utf8').then(JSON.parse)
  ]);
  const expectedRounds = roundDir ? null : selectRounds(fixtures);
  roundDir ??= join(archives, expectedRounds.map(r => r.league + r.round).join('-'));
  const {updatedAt, rows} = await readRound(roundDir, fixtures, teams, expectedRounds);
  let previous;
  try { previous = await readAsset(outputDir, 'process-ratings'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const verified = new Set(previous?.fixtures?.filter(f => f.status === 'finished' &&
    Number.isFinite(previous.matches[f.id]?.rating) && previous.matches[f.id].capturedAt !== null).map(f => f.id));
  const baseline = new Map(sample.matches.map(m => [m.id, m]));
  const matches = new Map(baseline);
  const fixedScores = new Set(baseline.keys());
  const index = {ruleVersion, updatedAt, days:{}, fixtures:[], matches:{}};
  for (const {fixture, summary} of rows) {
    index.fixtures.push(fixture);
    if (!summary) {
      matches.delete(fixture.id);
      continue;
    }
    const older = baseline.get(fixture.id);
    const rated = rateMatch(summary).rating !== null;
    if (!rated && verified.has(fixture.id)) throw Error('完赛详情缺少此前已取得的评分依据，保留已发布的快照：' + fixture.id);
    if (rated || !older) {
      matches.set(fixture.id, summary);
      fixedScores.delete(fixture.id);
    } else {
      matches.set(fixture.id, {...older, kickoff:summary.kickoff, stage:summary.stage, home:summary.home, away:summary.away,
        incidentReasons:summary.incidentReasons,matchDetail:summary.matchDetail, styleStats:summary.styleStats});
    }
  }
  const days = groupByDay(matches.values());
  for (const fixture of index.fixtures) if (!days.has(fixture.day)) days.set(fixture.day, []);

  await mkdir(join(outputDir, 'rounds'), {recursive:true});
  for (const [day, group] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const feed = formatFeed({day, source:'BSD', mode:'stored', sampleOnly:false, updatedAt, partial:true, matches:group}, true);
    const hash = createHash('sha256').update(JSON.stringify(feed)).digest('hex').slice(0, 20);
    const file = 'rounds/' + day + '-' + hash;
    const previewFile = file + '-preview';
    const preview = {...feed, matches:feed.matches.map(({details, ...card}) => card)};
    await atomicAsset(outputDir, file, feed, true);
    await atomicAsset(outputDir, previewFile, preview, true);
    index.days[day] = {file, previewFile};
    for (const card of preview.matches) {
      index.matches[card.id] = {day, rating:card.rating, styles:card.viewing?.styles ?? [], styleIds:card.viewing?.styleIds ?? [],
        ...(fixedScores.has(card.id) ? {capturedAt:null} : {})};
    }
  }
  await atomicAsset(outputDir, 'process-ratings', index);
  return index;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.length > 3) throw Error('用法：node scripts/build-offline-sample.mjs [本轮归档目录]');
  const roundDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const index = await buildOfflineSnapshot({roundDir});
  console.log('已发布 ' + index.fixtures.length + ' 场归档赛程，' +
    Object.values(index.matches).filter(m => Number.isFinite(m.rating)).length + ' 场过程评分。');
}
