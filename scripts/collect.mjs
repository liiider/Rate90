import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as pause} from 'node:timers/promises';
import {createBsdClient} from '../server/bsd.mjs';
import {collectSeason, getMeta, importArchivedEvents, openQueue, seedBackfill, setMeta, tick} from '../server/collector.mjs';
import {refreshPrematch} from '../server/prematch-worker.mjs';
import {generateTactics} from '../server/tactical-review.mjs';
import {loadBaseline, publishCollected} from '../server/publish-collected.mjs';

const state = resolve(process.env.RATE90_STATE_DIR || fileURLToPath(new URL('../data/collector/',import.meta.url)));
const publishOnly = process.argv.includes('--publish-only');
const season = process.argv.includes('--season');
const watch = !publishOnly && process.argv.includes('--watch');
const client = publishOnly ? null : createBsdClient(process.env.BSD_API_TOKEN);
await mkdir(state,{recursive:true});

function syncArchive(db, required) {
  const file = join(state,'bsd-raw.sqlite');
  if (!required && !existsSync(file)) return;
  const archive = new DatabaseSync(file,{readOnly:true});
  try {
    archive.exec('BEGIN');
    if (!archive.prepare("SELECT 1 FROM sqlite_master WHERE name='archive_meta'").get()) {
      if (required) throw Error('原始归档缺少增量基线');
      return;
    }
    const checkpoint = archive.prepare("SELECT value FROM archive_meta WHERE key='last_success'").get()?.value;
    if (!checkpoint && required) throw Error('原始归档尚未拉取完成');
    if (!checkpoint || (!required && checkpoint <= Number(getMeta(db,'archive:checkpoint') || 0))) return;
    const after = required ? 0 : Number(getMeta(db,'archive:observed') || 0);
    const report = importArchivedEvents(db,archive,after);
    setMeta(db,'archive:observed',report.through);
    setMeta(db,'archive:checkpoint',checkpoint);
    console.log(JSON.stringify({archive:report}));
  } finally { archive.close(); }
}

async function run() {
  // OS-backed SQLite write lock, released on exit, including an interrupted process.
  const guard = new DatabaseSync(join(state,'worker-lock.sqlite'));
  try {
    try { guard.exec('BEGIN IMMEDIATE'); }
    catch (error) {
      if (error.errcode !== 5 || publishOnly) throw error;
      if (season) throw new Error('采集器正在运行，结束后可继续赛季回填');
      return {ok:true};
    }
    const db = openQueue(join(state,'rate90.sqlite'));
    try {
      const base = await loadBaseline();
      const importRequested = process.argv.includes('--import-archive');
      if (importRequested || !publishOnly) syncArchive(db,importRequested);
      if (publishOnly) {
        await publishCollected(db,base);
        const preview=await refreshPrematch(db,base,null);
        console.log(JSON.stringify({prematch:preview}));
        return {ok:true};
      }
      seedBackfill(db,base.backfill,base.publishedIds);
      const report = season ? await collectSeason(db,client,{progress:console.log}) : await tick(db,client);
      await publishCollected(db,base);
      // Publish post-match updates even when a preview provider is unavailable.
      if (!season) {
        try {
          report.tactics=await generateTactics(db,base);
          if (report.tactics.generated) await publishCollected(db,base);
        } catch (error) {report.tactics={errors:[error.message]};}
        try {
          const last=Number(getMeta(db,'prematch:last')) || 0;
          if (!watch || Date.now()-last >= 5*60000) {
            const blocked=Number(getMeta(db,'bsd:retryAt'))>Date.now();
            report.prematch=await refreshPrematch(db,base,blocked?null:client,{allowInference:true});
            db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('prematch:last',String(Date.now()));
          }
        } catch (error) {report.prematch={errors:[error.message]};}
      }
      console.log(new Date().toISOString(),JSON.stringify(report));
      const next = db.prepare("SELECT MIN(due) AS due FROM games WHERE due IS NOT NULL AND phase!='backfill'").get().due;
      return {ok:!report.errors.length,next:Math.max(next ?? Infinity,Number(getMeta(db,'bsd:retryAt')) || 0)};
    } finally { db.close(); }
  } finally { guard.close(); }
}

do {
  let next;
  try {
    const result = await run();
    const ok = result.ok;
    next = result.next;
    if (!watch && !ok) process.exitCode = 1;
  } catch (error) {
    if (!watch) throw error;
    console.error(new Date().toISOString(),error.message);
  }
  if (watch) {
    const now = Date.now(), heartbeat = 300000 - now % 300000;
    await pause(Math.max(1,Math.min(heartbeat,(next ?? Infinity)-now)));
  }
} while (watch);
