import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {buildOfflineSnapshot} from './build-offline-sample.mjs';
import {atomicAsset, readAsset} from '../server/collected-feed.mjs';

const alias = 'pl-25-1-2', id = '9001';
const captured = '2027-02-03T04:00:00Z';
const fixture = {id:alias, league:'pl', round:25, date:'2027-02-02', home:'1', away:'2', rating:null};
const teams = [{id:'1', en:'North', zh:'北队'}, {id:'2', en:'South', zh:'南队'}];
const event = {id:Number(id), league:{id:1}, round_number:25, status:'finished', event_date:'2027-02-02T19:30:00Z',
  home_team:'North', away_team:'South', home_score:0, away_score:0,
  shotmap:[{min:20, type:'miss', home:true, xg:0.20}, {min:60, type:'miss', home:false, xg:0.11}],
  lineups:{confirmed:true, home:{formation:'4-4-2', players:[{name:'North captain', jersey_number:10, captain:true, goals:2}]}, away:{}},
  incidents:[{type:'goal', is_home:true, minute:50}, {type:'card', card_type:'yellow', is_home:true, minute:60, player:'North captain'}]};

async function writeCapture(dir) {
  const second = {...event, id:9002, status:'notstarted', shotmap:null, home_team:'West', away_team:'East'};
  const manifest = {complete:true, finishedAt:captured, fullResponses:2, rounds:[{league:'pl', round:25, scheduled:2}], matches:[]};
  await mkdir(join(dir, 'events'), {recursive:true});
  for (const [raw, fixtureId] of [[event, alias], [second, 'new-pair']]) {
    const file = 'events/' + raw.id + '.json';
    await writeFile(join(dir, file), JSON.stringify(raw));
    manifest.matches.push({league:'pl', round:25, fixtureId, eventId:raw.id, file, status:raw.status, fetchedAt:captured});
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

async function browserCatalog(dir) {
  const requests = [];
  const window = {};
  const document = {createElement:() => ({remove(){}}), head:{async append(script) {
    const name = script.src.slice('./ui/data/'.length, -3);
    requests.push(name);
    try {
      vm.runInNewContext(await readFile(join(dir,name + '.js'), 'utf8'), {document:{currentScript:script}});
      script.onload();
    } catch { script.onerror(); }
  }}};
  vm.runInNewContext(await readFile(new URL('../public/ui/catalog.js', import.meta.url), 'utf8'), {window, document});
  return {catalog:window.Rate90.catalog, requests};
}

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rate90-offline-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  await atomicAsset(dir, 'fixtures', [fixture]);
  await atomicAsset(dir, 'teams', teams);
  await atomicAsset(dir, 'collected-index', {updatedAt:null, days:{}, fixtures:[]});
  const roundDir = join(dir, 'private');
  const manifest = await writeCapture(roundDir);
  const options = {baseDir:dir, outputDir:dir, roundDir};
  return {dir, options, manifest, index:await buildOfflineSnapshot(options)};
}

test('a legacy fixture score stays unpublished until a Rate90 snapshot rates the match', async t => {
  const {dir} = await setup(t);
  const legacy = {...fixture, id:'9009', status:'finished', rating:9.8};
  await atomicAsset(dir, 'fixtures', [fixture, legacy]);
  const {catalog} = await browserCatalog(dir);
  assert.equal((await catalog.loadCatalog()).byId.get(legacy.id).rating, null);
  await atomicAsset(dir, 'collected-index', {days:{}, fixtures:[{...legacy, rating:5.4, capturedAt:captured}]});
  assert.equal((await catalog.loadCatalog()).byId.get(legacy.id).rating, 5.4);
});

test('resolved match IDs, new teams, Beijing dates and lazy details work from standalone scripts', async t => {
  const {dir, index, options, manifest} = await setup(t);
  const {catalog, requests} = await browserCatalog(dir);
  const result = await catalog.loadCatalog();
  assert.deepEqual(requests.slice().sort(), ['collected-index','fixtures','process-ratings','teams']);
  const row = result.byId.get(alias);
  assert.equal(result.matches.length, 2);
  assert.equal(row, result.byId.get(id));
  assert.ok(Number.isFinite(row.rating));
  assert.deepEqual([row.date, row.time, row.day, result.defaultMatchDate], ['2027-02-03', '03:30', '2027-02-03', '2027-02-03']);
  assert.equal(result.byId.get('new-pair').home.zh, 'West');
  assert.ok(result.teams.some(team => team.en === 'East'));
  assert.equal(await catalog.loadMatchDetails('new-pair'), null);
  const [detail, same] = await Promise.all([catalog.loadMatchDetails(alias), catalog.loadMatchDetails(id)]);
  assert.deepEqual(detail, same);
  assert.equal(requests.length, 5);
  assert.equal(detail.lineups.home.formation, '4-4-2');
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].type, 'card');
  assert.ok(!('goals' in detail.lineups.home.players[0]));
  assert.ok(!('score90' in detail));
  const encoded = await readFile(join(dir,'process-ratings.js'), 'utf8');
  assert.deepEqual(await buildOfflineSnapshot(options), index);
  assert.equal(await readFile(join(dir,'process-ratings.js'), 'utf8'), encoded);
  const finishedFile = join(options.roundDir, manifest.matches[0].file);
  await writeFile(finishedFile, JSON.stringify({...event, shotmap:null}));
  await assert.rejects(buildOfflineSnapshot(options), /评分依据/);
  assert.equal(await readFile(join(dir,'process-ratings.js'), 'utf8'), encoded);
  await writeFile(finishedFile, JSON.stringify(event));
  const missingFile = join(options.roundDir, manifest.matches[1].file);
  await rm(missingFile);
  await assert.rejects(buildOfflineSnapshot(options), {code:'ENOENT'});
  assert.equal(await readFile(join(dir,'process-ratings.js'), 'utf8'), encoded);
  manifest.matches.pop();
  await writeFile(join(options.roundDir,'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(buildOfflineSnapshot(options), /场数/);
  assert.equal(await readFile(join(dir,'process-ratings.js'), 'utf8'), encoded);
});

test('a calendar observation cannot replace an archived process score with a sample or revive a postponed fixture', async t => {
  const {dir, index} = await setup(t);
  const {catalog} = await browserCatalog(dir);
  const archived = index.matches[id];
  const archivedFixture = index.fixtures.find(m => m.id === id);
  const day = archivedFixture.day;
  const updatedAt = '2027-02-04T04:00:00Z';
  const days = {[day]:{file:'corrected-day'}};
  const collected = {...archivedFixture, observedAt:updatedAt, capturedAt:null, rating:9.9, styles:[], styleIds:[]};
  const publish = f => atomicAsset(dir, 'collected-index', {updatedAt, fixtures:[f], days});
  await publish(collected);
  assert.equal((await catalog.loadCatalog()).byId.get(id).rating, archived.rating);
  assert.equal((await catalog.loadMatchDetails(alias)).lineups.home.formation, '4-4-2');
  const corrected = await readAsset(dir, index.days[day].file);
  corrected.matches.find(m => m.id === id).details.lineups.home.formation = '3-5-2';
  await atomicAsset(dir, 'corrected-day', corrected);
  await publish({...collected, capturedAt:updatedAt});
  assert.equal((await catalog.loadCatalog()).byId.get(id).rating, 9.9);
  assert.equal((await catalog.loadMatchDetails(id)).lineups.home.formation, '3-5-2');
  await publish({...collected, status:'postponed', observedAt:'2027-01-20T04:00:00Z', rating:null});
  assert.equal((await catalog.loadCatalog()).byId.get(id).rating, archived.rating);
  await publish({...collected, status:'postponed', rating:null});
  const postponed = (await catalog.loadCatalog()).byId.get(alias);
  assert.equal(postponed.rating, null);
  assert.equal(postponed.hasDetails, false);
  assert.equal(await catalog.loadMatchDetails(alias), null);
});

test('a newer style observation updates lists and API even if only the archive has a rating', async t => {
  const {dir,index}=await setup(t);
  const {storedFeed}=await import('../server/collected-feed.mjs');
  const {catalog}=await browserCatalog(dir);
  const f=index.fixtures.find(row => row.id===id);
  const original=index.matches[id].rating;
  const file='fresh-styles', at='2027-02-07T00:00:00Z';
  const feed=await readAsset(dir,index.days[f.day].file);
  const card=feed.matches.find(m=>m.id===id);
  card.rating=null;
  for(const ids of [['team-move'],[]]){
    const labels=ids.map(()=> '流畅配合');
    card.viewing={styleIds:ids,styles:labels};
    await atomicAsset(dir,file,feed);
    await atomicAsset(dir,'collected-index',{days:{[f.day]:{file}},fixtures:[{...f,capturedAt:null,observedAt:at,
      rating:null,stylesCapturedAt:at,styleIds:ids,styles:labels}]});
    const ui=(await catalog.loadCatalog()).byId.get(id);
    const api=(await storedFeed(f.day,false,dir)).matches.find(m=>m.id===id);
    assert.equal(ui.rating,original);
    assert.equal(api.rating,original);
    assert.deepEqual([...ui.styleIds],ids);
    assert.deepEqual(api.viewing.styleIds,ids);
  }
});

test('round navigation includes gaps and named knockout stages without a collected index', async t => {
  const {dir}=await setup(t);
  const extra=[{...fixture,id:'old',round:22},{...fixture,id:'next',round:'Round of 16',date:'2027-03-05'}];
  await atomicAsset(dir,'fixtures',[fixture,...extra]);
  await rm(join(dir,'collected-index.js'));
  const {catalog}=await browserCatalog(dir);
  const loaded=await catalog.loadCatalog();
  assert.deepEqual([...loaded.roundsByLeague.pl],[22,25,'Round of 16']);
  assert.equal(catalog.roundName('cl', 'Round of 16'),'1/8 决赛');
  assert.equal(catalog.pickHeroIds([{id:'low',rating:7.9}]).size,0);
  assert.deepEqual([...catalog.pickHeroIds([{id:'a',rating:8},{id:'b',rating:8}])],['a']);
});

test('one round contains a rescheduled fixture once and old fixture links resolve to the played game', async t => {
  const {dir} = await setup(t);
  const old = {...fixture,id:'postponed-a',home:'rescheduled-club',status:'postponed'};
  const played = {...old,id:'replacement-a',date:'2027-03-01',status:'finished'};
  const unrelated = {...old,id:'not-replaced',away:'another-club'};
  await atomicAsset(dir,'fixtures',[old,played,unrelated]);
  const {catalog} = await browserCatalog(dir);
  const data = await catalog.loadCatalog();
  assert.equal(data.byId.get(old.id).id,played.id);
  assert.equal(data.byId.get(unrelated.id).id,unrelated.id);
  assert.equal(data.matches.some(m => m.id === old.id),false);
});
