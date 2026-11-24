import {storedFeed} from '../server/collected-feed.mjs';
import {readFile} from 'node:fs/promises';
import {beijingDate, dayBounds, loadDay} from '../server/bsd.mjs';
import {formatFeed} from '../server/recommend.mjs';

async function sampleFor(day) {
  const [start,end]=dayBounds(day);
  const sample=JSON.parse(await readFile(new URL('../data/bsd-sample.json',import.meta.url),'utf8'));
  const matches=sample.matches.filter(m=>{const at=Date.parse(m.kickoff);return at>=+start && at<+end;});
  return {day,source:'BSD',mode:'sample',sampleOnly:true,capturedOn:sample.capturedOn,partial:false,matches};
}

export async function getFeed(url, token, load = loadDay, stored = storedFeed) {
  const day=url.searchParams.get('date')??beijingDate();
  dayBounds(day);
  const source=url.searchParams.get('source')??'stored';
  if (!['sample','live','stored'].includes(source)) throw new RangeError('来源无效');
  const reveal=url.searchParams.get('reveal')==='1';
  if (source==='sample') return formatFeed(await sampleFor(day),reveal);
  if (source==='stored') {
    const collected=await stored(day,reveal);
    if (collected) return collected;
    const sample=await sampleFor(day);
    if (sample.matches.length) return formatFeed(sample,reveal);
    throw Object.assign(new Error('本日暂无已采集的数据'),{code:'NO_SNAPSHOT'});
  }
  try {
    const live=await load(day,token);
    return formatFeed({...live,mode:'live',sampleOnly:false},reveal);
  } catch(error) {
    const cached=await sampleFor(day);
    if (!cached.matches.length) throw error;
    return formatFeed({...cached,update:'upstream-unavailable'},reveal);
  }
}

export default async function matches(req,res) {
  if (req.method!=='GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'仅支持 GET'});
  }
  try {
    const data=await getFeed(new URL(req.url,'http://localhost'),process.env.BSD_API_TOKEN);
    const cacheable=['live','stored'].includes(data.mode) && !data.partial;
    res.setHeader('Cache-Control',cacheable?'public, s-maxage=600, stale-while-revalidate=900':'no-store');
    return res.status(200).json(data);
  } catch(error) {
    const invalid=error instanceof RangeError;
    res.setHeader('Cache-Control','no-store');
    return res.status(invalid?400:503).json({error:invalid?'查询参数无效':error.code==='NO_SNAPSHOT'?'本日暂无已采集的数据':'暂时无法更新 BSD 比赛'});
  }
}
