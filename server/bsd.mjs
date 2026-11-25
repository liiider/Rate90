import {pressureProfile, shotProfile, validScore} from './shot-profile.mjs';
import {projectMatchDetail} from './match-detail.mjs';
import {hasExtraTime, regulationStats} from './style-stats.mjs';

import {incidentReasons} from './style-tags.mjs';

const HOST = 'https://sports.bzzoiro.com';
export const LEAGUES = new Map([[1,'英超'],[3,'西甲'],[4,'意甲'],[5,'德甲'],[6,'法甲'],[7,'欧冠']]);
const hasNumber = Number.isFinite;

export function beijingDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

export function dayBounds(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('日期无效');
  const end = new Date(day + 'T04:00:00Z');
  if (!hasNumber(end.getTime()) || end.toISOString().slice(0,10) !== day) throw new RangeError('日期无效');
  return [new Date(end.getTime() - 86400000), end];
}

export function summarize(match) {
  const pressure = pressureProfile(match.momentum);
  const extraTime = hasExtraTime(match);
  const styleStats = regulationStats(match,extraTime);
  const scores = [match.home_score, match.away_score];
  const score90 = !extraTime && validScore(scores) ? scores : null;
  return {
    id:String(match.id), stage:LEAGUES.get(match.league?.id) || match.league?.name,
    kickoff:match.event_date, home:match.home_team, away:match.away_team,
    score90, incidentReasons:incidentReasons(match,extraTime), pressureMinutes:pressure?.values ?? null, styleStats,
    matchDetail:projectMatchDetail(match,styleStats,pressure?.values,extraTime), ...shotProfile(match,score90,pressure,extraTime)
  };
}

export function createBsdClient(token, fetchImpl = fetch) {
  if (!token) throw new Error('未配置 BSD_API_TOKEN');
  async function get(path, params) {
    const url = new URL(path, HOST);
    url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, {headers:{Authorization:'Token '+token,Accept:'application/json'},
      redirect:'error', signal:AbortSignal.timeout(8000)}).catch(error => {
      throw new Error('BSD 网络请求失败 (' + (error.cause?.code || error.name) + ')',{cause:error});
    });
    if (!response.ok) {
      const error = Object.assign(new Error('BSD HTTP '+response.status), {status:response.status});
      if (response.status === 429) {
        const value = response.headers?.get('retry-after')?.trim();
        const delay = /^\d+$/.test(value) ? Number(value)*1000 : Date.parse(value)-Date.now();
        if (Number.isSafeInteger(delay) && delay >= 0) error.retryAfterMs = delay;
      }
      throw error;
    }
    return response.json();
  }
  async function list(league, start, end, status) {
    const params = {league, date_from:start.toISOString().slice(0,10),
      date_to:new Date(+end - 1).toISOString().slice(0,10)};
    if (status) params.status = status;
    return (await fixtures(params,50)).filter(event=>{
      const at = Date.parse(event.event_date);
      return event.league?.id === league && Number.isSafeInteger(event.id) && at >= +start && at < +end &&
        (!status || event.status === status);
    });
  }
  async function event(id, full = false) {
    const result = await get('/api/events/' + id + '/', full ? {full:'true'} : {});
    if (result.id !== id) throw new Error('BSD 场次不一致');
    return result;
  }
  async function fixtures(params,maxPages=100) {
    const matches = [];
    let cursor = {page:1};
    const seen = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const tag = new URLSearchParams(cursor).toString();
      if (seen.has(tag)) throw new Error('BSD 赛程分页游标重复');
      seen.add(tag);
      const answer = await get('/api/events/', {...params,...cursor});
      if (!Array.isArray(answer.results)) throw new Error('BSD 赛程格式异常');
      matches.push(...answer.results);
      if (!answer.next) return matches;
      if (!answer.results.length) throw new Error('BSD 赛程未读取完整');
      if (answer.next === true) { cursor = {page:page+1}; continue; }
      // The live v1 endpoint advances offset even when page stays at 1.
      const next = String(answer.next);
      const query = new URL(/^(page|offset|limit)=/.test(next) ? '?'+next : next, HOST+'/api/events/').searchParams;
      cursor = {};
      for (const key of ['page','limit','offset']) {
        if (query.has(key) && /^\d+$/.test(query.get(key))) cursor[key]=query.get(key);
      }
      if (cursor.page == null && cursor.offset == null) throw new Error('BSD 赛程分页游标无效');
    }
    throw new Error('BSD 赛程分页超过 '+maxPages+' 页');
  }
  async function season(league) {
    const payload = await get('/api/v2/leagues/'+league+'/season/',{});
    const current = payload && Object.hasOwn(payload,'season') ? payload.season : payload;
    if (!Number.isSafeInteger(current?.id) || current.id <= 0) throw new Error('BSD 赛季 ID 无效 '+league);
    return current;
  }
  return {list, event, season,
    seasonFixtures: (league,season) => fixtures({league,season}),
    standings: (league,season) => get('/api/v2/leagues/'+league+'/standings/',{season_id:season}),
    teamFixtures: (team,from,to) => fixtures({team,date_from:from,date_to:to}),
    legInfo: id => get('/api/v2/events/'+id+'/',{})
  };
}

export async function loadDay(day, token, fetchImpl = fetch) {
  const [start,end] = dayBounds(day);
  const client = createBsdClient(token, fetchImpl);
  const groups = await Promise.all([...LEAGUES.keys()].map(league => client.list(league, start, end, 'finished')));
  const fixtures=[...new Map(groups.flat().map(m=>[m.id,m])).values()];
  const matches=[];
  let failed=0;
  for(let i=0;i<fixtures.length;i+=4) {
    const batch=await Promise.all(fixtures.slice(i,i+4).map(async fixture=>{
      try {
        const detail=await client.event(fixture.id, true);
        return summarize(detail);
      } catch {
        failed++;
        return summarize({...fixture,shotmap:null});
      }
    }));
    matches.push(...batch);
  }
  if (failed>0 && failed===fixtures.length) throw new Error('未取得比赛详情');
  return {day,source:'BSD',updatedAt:new Date().toISOString(),partial:failed>0,matches};
}
