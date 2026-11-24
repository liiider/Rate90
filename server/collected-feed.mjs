import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ruleVersion} from './recommend.mjs';

export const assetDirectory = fileURLToPath(new URL('../public/ui/data/',import.meta.url));
export const prefix = 'document.currentScript.rate90Data = ';

export async function readAsset(dir,name) {
  const source = (await readFile(join(dir,name+'.js'),'utf8')).trim();
  if (!source.startsWith(prefix) || !source.endsWith(';')) throw new Error('无效的评分快照');
  return JSON.parse(source.slice(prefix.length,-1));
}

export async function storedFeed(day,reveal,dir = assetDirectory) {
  const index = await readAsset(dir,'collected-index');
  const entry = index.days[day];
  if (entry) {
    if (!reveal && entry.previewFile) return readAsset(dir,entry.previewFile);
    const feed = await readAsset(dir,entry.file);
    if (!reveal) feed.matches = feed.matches.map(({details,...card}) => card);
    return feed;
  }
  if (index.coveredDays.includes(day)) {
    return {day,source:'BSD',mode:'stored',updatedAt:index.updatedAt,partial:false,sampleOnly:false,ruleVersion,matches:[]};
  }
  return null;
}
