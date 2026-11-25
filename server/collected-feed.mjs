import {randomUUID} from 'node:crypto';
import {access, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {storedMatchDetail} from './match-detail.mjs';
import {ruleVersion} from './recommend.mjs';
import {styleLabels} from './style-tags.mjs';

export const assetDirectory = fileURLToPath(new URL('../public/ui/data/',import.meta.url));
export const prefix = 'document.currentScript.rate90Data = ';

// Older base schedules marked completed games only by including an imported rating.
export const isFinishedFixture = f => f.status === 'finished' || (f.status == null && Number.isFinite(f.rating));

export async function atomicAsset(dir,name,data,immutable = false) {
  const path = join(dir,name+'.js'), text = prefix + JSON.stringify(data) + ';\n';
  try {
    if (immutable) { await access(path); return; }
    if (await readFile(path,'utf8') === text) return;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temp = path+'.'+randomUUID()+'.tmp';
  try { await writeFile(temp,text); await rename(temp,path); }
  finally { await rm(temp,{force:true}); }
}

export async function readAsset(dir,name) {
  const source = (await readFile(join(dir,name+'.js'),'utf8')).trim();
  if (!source.startsWith(prefix) || !source.endsWith(';')) throw new Error('无效的评分快照');
  return JSON.parse(source.slice(prefix.length,-1));
}

export async function optionalIndex(dir,name) {
  try { return await readAsset(dir,name); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

let launchCopy;
export async function editLaunchReview(review, day) {
  if (!review?.nodes?.length || day < '2026-11-21' || day > '2026-11-25') return review;
  launchCopy ??= readAsset(assetDirectory,'tactical-edits-20261125').catch(error => {
    launchCopy = null;
    throw error;
  });
  const edits = await launchCopy;
  let changed = false;
  const nodes = review.nodes.map(node => {
    const analysis = Object.hasOwn(edits,node.analysis) ? edits[node.analysis] : node.analysis;
    const comment = Object.hasOwn(edits,node.comment) ? edits[node.comment] : node.comment;
    if (analysis === node.analysis && comment === node.comment) return node;
    changed = true;
    return {...node,analysis,comment};
  });
  return changed ? {...review,nodes} : review;
}

const idsByLabel = new Map(Object.entries(styleLabels).map(([id,label]) => [label,id]));

function publishedCard(card,details) {
  const {id,stage,kickoff,home,away,rating,recommendation,viewing} = card;
  const styleIds = Array.isArray(viewing?.styleIds) ? viewing.styleIds.filter(id => Object.hasOwn(styleLabels,id)) :
    (viewing?.styles ?? []).map(label => idsByLabel.get(label)).filter(Boolean);
  const publicCard = {id,stage,kickoff,home,away,rating,recommendation,
    viewing:{styles:styleIds.map(id => styleLabels[id]),styleIds},topPick:false};
  if (details) publicCard.details = storedMatchDetail(card.details,viewing?.pressure);
  return publicCard;
}

function matchesById(fixtures) {
  return new Map((fixtures ?? []).map(fixture => [fixture.id,fixture]));
}

function newerOrEqual(timestamp,reference) {
  const earlier = Date.parse(reference);
  return !Number.isFinite(earlier) || Date.parse(timestamp) >= earlier;
}

function changedKickoff(a,b) {
  return !!(a?.time && b?.time && (a.date !== b.date || a.time !== b.time));
}

export async function storedFeed(day,details,dir = assetDirectory) {
  const [index,archive] = await Promise.all(['collected-index','process-ratings'].map(name => optionalIndex(dir,name)));
  const [collected,round] = await Promise.all([index,archive].map(manifest => {
    const entry = manifest?.days?.[day];
    return entry ? readAsset(dir,(!details && entry.previewFile) || entry.file) : null;
  }));
  const covered = index?.coveredDays?.includes(day) ?? false;
  if (!collected && !round && !covered) return null;

  const observed = matchesById(index?.fixtures), archived = matchesById(archive?.fixtures);
  const rows = new Map(), combinedSources = new Set();
  for (const card of round?.matches ?? []) {
    const fixture = observed.get(card.id), frozen = archived.get(card.id);
    const newer = fixture && newerOrEqual(fixture.observedAt ?? fixture.capturedAt,frozen?.capturedAt);
    if (newer && (fixture.status !== 'finished' || fixture.replacedBy || fixture.day !== day || changedKickoff(fixture,frozen))) continue;
    rows.set(card.id,card);
  }
  for (const card of collected?.matches ?? []) {
    const fixture = observed.get(card.id), frozen = archived.get(card.id);
    if (fixture && (fixture.status !== 'finished' || fixture.replacedBy || fixture.day !== day)) continue;
    if (frozen && !newerOrEqual(fixture?.observedAt ?? fixture?.capturedAt,frozen.capturedAt) &&
        (frozen.status !== 'finished' || frozen.day !== day || changedKickoff(fixture,frozen))) continue;
    const existing = rows.get(card.id);
    if (!existing) {
      rows.set(card.id,card);
      continue;
    }
    const keepScore = Number.isFinite(existing.rating) && (!fixture || !Number.isFinite(card.rating) ||
      fixture.capturedAt === null || !newerOrEqual(fixture.capturedAt,frozen?.capturedAt));
    const selected = keepScore ? existing : card;
    const stylesAt = fixture?.stylesCapturedAt ?? fixture?.capturedAt;
    const newStyles = stylesAt && newerOrEqual(stylesAt,frozen?.capturedAt) && Array.isArray(card.viewing?.styleIds);
    const styles = newStyles ? card : existing;
    if (styles !== selected && styles.viewing) {
      const {styleIds,styles:labels} = styles.viewing;
      rows.set(card.id,{...selected,viewing:{...selected.viewing,styleIds,styles:labels}});
      combinedSources.add(round);
      combinedSources.add(collected);
    } else rows.set(card.id,selected);
    if (details && selected !== card && card.details?.tactics) {
      const merged=rows.get(card.id);
      rows.set(card.id,{...merged,details:{...merged.details,tactics:card.details.tactics}});
      combinedSources.add(round);
      combinedSources.add(collected);
    }
  }
  const matches = [...rows.values()].map(card => publishedCard(card,details))
    .sort((a,b) => (b.rating ?? -1)-(a.rating ?? -1) || a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));
  for (const match of matches) {
    const tactics = match.details?.tactics;
    if (!tactics) continue;
    const edited = {...tactics};
    for (const side of Object.keys(tactics)) edited[side] = await editLaunchReview(tactics[side],day);
    match.details.tactics = edited;
  }
  if (matches.length) matches[0].topPick = matches[0].recommendation === '看全场';
  const feeds = [collected,round].filter(Boolean);
  const selected = new Set(rows.values());
  const contributing = feeds.filter(feed => combinedSources.has(feed) || feed.matches.some(card => selected.has(card)));
  const sources = contributing.length ? contributing : feeds;
  const sampleOnly = sources.length > 0 && sources.every(feed => feed.sampleOnly === true);
  const timestamps = sources.map(feed => Date.parse(feed.updatedAt ?? feed.capturedOn)).filter(Number.isFinite);
  const updatedAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : index?.updatedAt ?? null;
  const capturedOn = sampleOnly && sources.find(feed => feed.capturedOn)?.capturedOn;
  const partial = sampleOnly || (covered ? matches.some(m => m.rating === null) : sources.some(feed => feed.partial));
  return {day,source:'BSD',mode:sampleOnly ? 'sample' : 'stored',updatedAt,
    ...(capturedOn ? {capturedOn} : {}),sampleOnly,partial,ruleVersion,matches};
}
