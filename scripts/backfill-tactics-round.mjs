import {createHash} from 'node:crypto';
import {access} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as pause} from 'node:timers/promises';
import {openQueue} from '../server/collector.mjs';
import {atomicAsset, editLaunchReview, readAsset} from '../server/collected-feed.mjs';
import {aiSettings} from '../server/prematch-ai.mjs';
import {generateTactics} from '../server/tactical-review.mjs';

// The six rounds on the site at rollout. A retry next month must keep this scope.
const rounds = {pl:11, ll:13, sa:12, bl:10, l1:11, cl:5};
export function roundIds(fixtures) {
  return new Set(fixtures.filter(f => Object.hasOwn(rounds,f.league) && f.round === rounds[f.league] &&
    f.date >= '2026-07-01' && f.date < '2027-07-01' && f.status === 'finished' &&
    !f.replacedBy && /^\d+$/.test(f.id) && f.day).map(f => Number(f.id)));
}

// Publish only tactical fields in the current snapshot. Hold the collector lock
// for the file writes, never while awaiting model responses.
export async function publishRoundReviews(db, dir, ids) {
  const index = await readAsset(dir,'collected-index');
  const fixtures = index.fixtures.filter(f => ids.has(Number(f.id)) && f.status === 'finished' && !f.replacedBy);
  const byId = new Map(fixtures.map(f => [String(f.id),f]));
  const results = db.prepare('SELECT side,result FROM tactical_reviews WHERE game_id=? AND result IS NOT NULL');
  let changed = false;
  let publishedSides = 0;
  for (const day of new Set(fixtures.map(f => f.day))) {
    const entry = index.days[day];
    if (!entry) continue;
    const feed = await readAsset(dir,entry.file);
    let changedDay = false;
    for (const match of feed.matches) {
      const fixture = byId.get(String(match.id));
      if (fixture?.day !== day) continue;
      const sides = results.all(Number(match.id));
      for (const {side,result} of sides) {
        match.details ??= {};
        match.details.tactics ??= {home:null,away:null};
        const current = match.details.tactics[side];
        const edited = await editLaunchReview(current ?? JSON.parse(result),day);
        if (current !== edited) {
          match.details.tactics[side] = edited;
          changedDay = true;
        }
      }
      const present = ['home','away'].filter(side => match.details?.tactics?.[side]).length;
      if (!present) continue;
      publishedSides += present;
      if (!fixture.tacticalCoverage) { fixture.tacticalCoverage = true; changed = true; }
    }
    if (!changedDay) continue;
    const hash = createHash('sha256').update(JSON.stringify(feed)).digest('hex').slice(0,20);
    const file = 'collected/'+day+'-'+hash;
    const preview = await readAsset(dir,entry.previewFile);
    await atomicAsset(dir,file,feed,true);
    await atomicAsset(dir,file+'-preview',preview,true);
    index.days[day] = {...entry,file,previewFile:file+'-preview'};
    changed = true;
  }
  if (changed) await atomicAsset(dir,'collected-index',index);
  return publishedSides;
}

async function main() {
  const app = resolve(process.cwd());
  const dir = join(app,'public/ui/data');
  const scopeDir = process.env.RATE90_TACTICS_SCOPE_DIR || dir;
  const ids = roundIds((await readAsset(scopeDir,'collected-index')).fixtures);
  console.log('本轮已完赛 '+ids.size+' 场，主客队共 '+ids.size*2+' 份复盘。');
  if (process.argv.includes('--list') || !ids.size) return;
  const state = resolve(process.env.RATE90_STATE_DIR || join(app,'data/collector'));
  const path = join(state,'rate90.sqlite');
  await access(path);
  const ai = aiSettings();
  const db = openQueue(path);
  const guard = new DatabaseSync(join(state,'worker-lock.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=10000');
    const base = {teams:await readAsset(dir,'teams')};
    for (const id of ai ? ids : []) {
      const report = await generateTactics(db,base,{ai,gameIds:[id],limit:2});
      if (report.attempted) console.log(JSON.stringify({id,...report}));
      if (report.errors.some(e => /AI HTTP (401|403|429)/.test(e.error))) break;
    }
    for (;;) {
      try { guard.exec('BEGIN IMMEDIATE'); break; }
      catch (error) { if (error.errcode !== 5) throw error; await pause(2000); }
    }
    const count = await publishRoundReviews(db,dir,ids);
    console.log('本轮已写入比赛日快照 '+count+'/'+ids.size*2+' 份复盘。');
    if (count !== ids.size*2) {
      if (!ai) console.error('已有复盘已检查。生成剩余复盘需要在 Linux 配置 RATE90_AI_KEY 或 OPENAI_API_KEY。');
      process.exitCode = 1;
    }
  } finally { guard.close(); db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
