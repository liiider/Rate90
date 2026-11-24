import {mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as pause} from 'node:timers/promises';
import {createBsdClient} from '../server/bsd.mjs';
import {collectSeason, getMeta, openQueue, seedBackfill, tick} from '../server/collector.mjs';
import {loadBaseline, publishCollected} from '../server/publish-collected.mjs';

const state = resolve(process.env.RATE90_STATE_DIR || fileURLToPath(new URL('../data/collector/',import.meta.url)));
const publishOnly = process.argv.includes('--publish-only');
const season = process.argv.includes('--season');
const watch = !publishOnly && process.argv.includes('--watch');
const client = publishOnly ? null : createBsdClient(process.env.BSD_API_TOKEN);
await mkdir(state,{recursive:true});

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
      if (publishOnly) {
        await publishCollected(db,base);
        return {ok:true};
      }
      seedBackfill(db,base.backfill,base.publishedIds);
      const report = season ? await collectSeason(db,client,{progress:console.log}) : await tick(db,client);
      await publishCollected(db,base);
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
