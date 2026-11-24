import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadDay, summarize} from './bsd.mjs';
import {formatFeed, rateMatch, ruleVersion} from './recommend.mjs';
import {getFeed} from '../api/matches.mjs';

const archive = JSON.parse(await readFile(new URL('../data/bsd-sample.json', import.meta.url), 'utf8'));
const first = archive.matches[0];
const event = {id:1, league:{id:1}, event_date:'2026-11-21T15:00:00Z', status:'finished',
  home_team:'Home', away_team:'Away', home_score:0, away_score:0};
const shot = (min, home, type = 'miss', xg = 0.18, extra = {}) => ({min, home, type, xg, ...extra});
const rateShots = (shots, fields) => rateMatch(summarize({...event, ...fields, shotmap:shots}));

test('all 12 archived games have bounded reproducible component scores, unaffected by reference ratings', () => {
  for (const m of archive.matches) {
    const result = rateMatch(m);
    const parts = Object.values(result.analysis.components);
    assert.equal(parts.reduce((a, p) => a + p.weight, 0), 100);
    assert.ok(parts.every(p => p.points >= 0 && p.points <= p.weight));
    const tenths = parts.reduce((a, p) => a + Math.round(10 * p.points), 0);
    assert.equal(result.rating, Math.round(tenths / 10) / 10);
    assert.deepEqual(result, rateMatch({...m, home:'Other', rating:0.1, chanceSides:[...m.chanceSides].reverse()}));
  }
  assert.equal(rateMatch(archive.matches.find(m => m.id === '213755')).rating, 8.1);
});

test('same totals: sustained opportunities and stronger opposition earn independent points', () => {
  const base = {...first, shotsByWindow:[8,8,8,8,8,8], xgCount:48, xg90:3, chanceSides:[3,3]};
  const spread = rateMatch({...base, chancesByWindow:[1,1,1,1,1,1]});
  const burst = rateMatch({...base, chancesByWindow:[0,0,6,0,0,0]});
  const oneSide = rateMatch({...base, chancesByWindow:[1,1,1,1,1,1], chanceSides:[6,0]});
  assert.ok(spread.analysis.components.continuity.points > burst.analysis.components.continuity.points);
  assert.ok(spread.rating > oneSide.rating);
  assert.equal(oneSide.analysis.components.exchanges.points, 0);
});

test('reject malformed process data and do not infer a rating from the final score', () => {
  for (const patch of [
    {shotsByWindow:null}, {chancesByWindow:[0]}, {chanceSides:[-1,9]}, {chanceSides:[0,0]},
    {xgCount:1}, {xg90:null}, {xg90:-1}, {chancesByWindow:[4,0,0,1,2,1]}
  ]) assert.equal(rateMatch({...first, ...patch}).rating, null);
  assert.equal(rateMatch(summarize({...event, home_score:5, away_score:4})).recommendation, '资料不足');
  assert.equal(rateShots([shot(10, true, 'goal', null)]).rating, null);
  assert.equal(rateShots([shot(10, null)]).rating, null);
});

test('BSD own goals count once in highlights and the score timeline, with no attacking attempt or xG', () => {
  const shots = [shot(5,true,'goal',0.25),shot(75,false,'save',0)];
  for (const home of [true,false]) {
    const own = shot(85,home,'goal',null,{gtype:'own',xgot:null});
    const fields = {...event,home_score:home ? 2 : 1,away_score:home ? 0 : 1};
    const match = summarize({...fields,shotmap:[...shots,own]});
    const evidence = match.shotEvidence;
    assert.equal(match.xg90,0.25);
    assert.equal(match.xgCount,2);
    assert.deepEqual(match.shotsByWindow,[1,0,0,0,1,0]);
    assert.deepEqual(match.chancesByWindow,[1,0,0,0,0,0]);
    assert.deepEqual(match.chanceSides,[1,0]);
    assert.equal(evidence.onTarget,2);
    assert.equal(evidence.highlightCount,2);
    assert.equal(evidence.timeline.source,'shotmap');
    assert.equal(evidence.timeline.equalizers,home ? 0 : 1);
    assert.ok(Number.isFinite(rateMatch(match).rating));
    assert.deepEqual(summarize({...fields,shotmap:[...shots,{...own,xg:0.9,xgot:1}]}),match);
    assert.equal(rateShots([own,shot(90,true,'miss',null)],fields).rating,null);
  }
});

test('an own goal with no attacking shots supplies a timeline but no process rating', () => {
  const own = shot(47,true,'goal',null,{gtype:'own',period:1});
  const raw = {...event,home_score:1,shotmap:[own,{...own,min:98,period:3},{...own,min:120,period:5}]};
  const match = summarize(raw);
  assert.equal(match.xg90,0);
  assert.equal(match.xgCount,0);
  assert.equal(match.extraShots,0);
  assert.equal(match.shotEvidence.highlightCount,1);
  assert.equal(match.shotEvidence.timeline.source,'shotmap');
  assert.equal(rateMatch(match).rating,null);
  assert.equal(summarize({...raw,shotmap:[]}).xg90,null);
});

test('regulation time includes added time in its own half and excludes extra time and kicks', () => {
  const raw = {...event, extra_time_score:{home:1,away:0}, shotmap:[
    shot(48, true, 'miss', 0.2, {period:1}), shot(46, true, 'miss', 0.2, {period:2}),
    shot(95, false, 'post', 0.1, {period:2}), shot(98, true, 'goal', 0.7, {period:3}),
    shot(121, false, 'goal', null, {sit:'shootout'})
  ]};
  const m = summarize(raw);
  assert.deepEqual(m.shotsByWindow, [0,0,1,1,0,1]);
  assert.equal(m.xg90, 0.5);
  assert.equal(m.extraShots, 1);
  assert.equal(m.score90, null);
  assert.equal(rateMatch(m).analysis.suspenseMethod, 'late-chances-only');
  assert.equal(rateMatch(summarize({...raw, shotmap:[shot(97,true)]})).rating, null);
});

test('one attempt counts once; post-shot improvement, missing xGOT, penalties and xG provenance stay distinguishable', () => {
  const shots = [
    shot(12, true, 'goal', 0.03, {xgot:0.7, xg_estimated:false}), shot(30, false, 'save', 0.2, {xgot:0.5}),
    shot(50, true, 'post', 0.05), shot(65, false, 'save', 0.5, {xgot:null, xg_estimated:true}),
    shot(75, false, 'miss', 0.76, {sit:'penalty'})
  ];
  const match = summarize({...event, home_score:1, shotmap:shots});
  const e = match.shotEvidence, r = rateMatch(match);
  assert.equal(r.analysis.chanceCount, 5);
  assert.deepEqual([e.onTarget, e.measuredOnTarget, match.difficultSaves, e.proxySaves, e.woodwork, e.highlightCount], [3,2,1,1,1,4]);
  assert.deepEqual([e.executionLifts, e.estimatedXg, e.unknownXgSource, e.penaltyShots], [2,1,3,1]);
  assert.equal(r.analysis.threatXg, 1.16);
  assert.equal(rateShots(shots.map(s => ({...s, sit:'assisted'})), {home_score:1}).analysis.components.threat.points >
    r.analysis.components.threat.points, true);
});

test('verified equalizers, reversals and late goals outperform an early settled scoreline', () => {
  const late = [shot(1,true,'goal'),shot(75,false,'goal'),shot(92,false,'goal')];
  const early = [shot(1,false,'goal'),shot(2,false,'goal'),shot(90,true,'goal')];
  const fields = {home_score:1, away_score:2};
  const detail = summarize({...event, ...fields, shotmap:[...late].reverse()});
  assert.deepEqual(detail.shotEvidence.timeline, {closeMinutes:90, lateCloseMinutes:15, equalizers:1, leadReversals:1, lateSwingGoals:1, source:'shotmap'});
  assert.ok(rateShots(late,fields).analysis.components.suspense.points > rateShots(early,fields).analysis.components.suspense.points);
  const mismatched = rateShots(late,{home_score:2,away_score:1});
  assert.equal(mismatched.analysis.suspenseMethod, 'final-margin-and-late-chances');
  assert.equal(rateShots([shot(88,true,'goal'),shot(88,false,'goal')],{home_score:1,away_score:1}).analysis.suspenseMethod, 'final-margin-and-late-chances');
});

test('incident reconstruction requires a matching score; pressure uses well-covered neighbouring spells', () => {
  const shots = Array.from({length:12}, (_, i) => shot(1 + 7*i, i % 2 === 0));
  const incidents = [{type:'goal', is_home:false, minute:55}, {type:'goal', is_home:true, minute:87}];
  const momentum = Array.from({length:90}, (_,i) => ({m:i+1,v:Math.floor(i/5)%2 ? -10 : 10}));
  const fields = {...event, home_score:1,away_score:1,shotmap:shots,incidents};
  const rich = summarize({...fields,momentum});
  assert.equal(rich.shotEvidence.timeline.source, 'incidents');
  assert.equal(rich.shotEvidence.timeline.lateSwingGoals, 1);
  assert.equal(rich.shotEvidence.pressure.swings, 17);
  const oneSide = summarize({...fields,momentum:momentum.map(v=>({...v,v:10}))});
  assert.ok(rateMatch(rich).analysis.components.exchanges.points > rateMatch(oneSide).analysis.components.exchanges.points);
  assert.equal(summarize({...fields,momentum:momentum.slice(0,60)}).shotEvidence.pressure, null);
  assert.equal(summarize({...fields,incidents:incidents.slice(0,1)}).shotEvidence.timeline, null);
  const ambiguous = [
    {type:'goal',is_home:true,minute:80}, {type:'goal',is_home:true,minute:80,period_second:2101},
    {type:'goal',is_home:false,minute:80,period_second:2110}
  ];
  assert.equal(summarize({...fields,home_score:2,incidents:ambiguous}).shotEvidence.timeline, null);
});

test('public list is spoiler-free, ties share rank and missing games sort last', () => {
  const rows = [{...first,id:'c',xg90:null}, {...first,id:'b'}, {...first,id:'a'}];
  const feed = {matches:rows};
  const plain = formatFeed(feed), revealed = formatFeed(feed,true);
  assert.deepEqual(plain.matches.map(m => m.id), ['a','b','c']);
  assert.deepEqual(plain, formatFeed({matches:[...rows].reverse()}));
  assert.deepEqual(revealed.matches.map(m=>m.details.processRank), [1,1,null]);
  assert.deepEqual(revealed.matches.map(m=>m.details.goalsOnlyRank), [1,1,1]);
  for (const [i, card] of plain.matches.entries()) {
    const {details, ...same} = revealed.matches[i];
    assert.deepEqual(card, same);
    assert.deepEqual(Object.keys(card).sort(), ['id','stage','kickoff','home','away','rating','recommendation','topPick','viewing'].sort());
  }
});

test('API sample, vendor fixture transport and offline feeds all use the same scoring entry point', async () => {
  const url = new URL('http://localhost/api/matches?date=2026-11-22&source=live');
  const raw = {...event, shotmap:[shot(10,true),shot(52,false)]};
  const fetchVendor = async upstream => {
    const detail = upstream.pathname.endsWith('/1/');
    const firstPage = upstream.searchParams.get('page') === '1';
    const league = upstream.searchParams.get('league');
    const result = detail ? raw : {results:league === '1' && !firstPage ? [event] : [], next:null};
    if (!detail && league === '1' && firstPage) Object.assign(result,{results:[{...event,id:2,status:'live'}],next:'page=2'});
    return {ok:true, json:async () => result};
  };
  const live = await getFeed(url, 'fixture', (day, token) => loadDay(day, token, fetchVendor));
  assert.equal(live.mode,'live');
  assert.equal(live.matches.length,1);
  assert.equal(live.matches[0].rating,rateMatch(summarize(raw)).rating);
  const backup = await getFeed(url, null, async()=>{ throw Error('offline'); });
  assert.equal(backup.update,'upstream-unavailable');
  for (const date of ['2026-11-05','2026-11-22']) {
    for (const reveal of [false,true]) {
      url.search = new URLSearchParams({date,source:'sample',reveal:reveal?'1':'0'});
      const sample = await getFeed(url);
      assert.equal(sample.ruleVersion,ruleVersion);
      const file = '../public/ui/data/sample-'+date+(reveal?'-details':'')+'.js';
      const script = await readFile(new URL(file,import.meta.url),'utf8');
      assert.deepEqual(JSON.parse(script.slice(script.indexOf(' = ')+3,script.lastIndexOf(';'))), sample);
    }
  }
});
