const HOST = 'https://sports.bzzoiro.com';
const LEAGUES = new Map([[1,'英超'],[3,'西甲'],[4,'意甲'],[5,'德甲'],[6,'法甲'],[7,'欧冠']]);
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
  const result = {
    id: String(match.id), stage: LEAGUES.get(match.league?.id) || match.league?.name,
    kickoff: match.event_date, home: match.home_team, away: match.away_team,
    score90: !match.extra_time_score && !match.penalty_shootout &&
      [match.home_score,match.away_score].every(hasNumber) ? [match.home_score,match.away_score] : null,
    shotsByWindow: null, chancesByWindow: null, chanceSides: null, xg90: null, xgCount: 0,
    xgotCount: 0, difficultSaves: 0, extraShots: 0
  };
  if (!Array.isArray(match.shotmap) || !match.shotmap.length) return result;
  const bins = Array(6).fill(0), chances = Array(6).fill(0), sides = [0,0];
  let xg = 0;
  for (const s of match.shotmap) {
    if (s.period === 5 || /shoot.?out/i.test(s.sit || '')) continue;
    if (!hasNumber(s.min) || s.min < 0) return {...result, shotsByWindow:null};
    if (s.period === 3 || s.period === 4 || (match.extra_time_score && s.min > 90)) {
      result.extraShots++;
      continue;
    }
    const bin = Math.min(5, Math.floor(Math.max(0, s.min - 1) / 15));
    bins[bin]++;
    if (hasNumber(s.xg)) { xg += s.xg; result.xgCount++; }
    if (hasNumber(s.xgot)) result.xgotCount++;
    if (s.type === 'save' && s.xgot >= 0.35) result.difficultSaves++;
    if (s.type === 'goal' || s.type === 'post' || s.xg >= 0.15 || s.xgot >= 0.35) {
      chances[bin]++;
      if (typeof s.home === 'boolean') sides[s.home ? 0 : 1]++;
    }
  }
  const n = bins.reduce((a,b)=>a+b,0);
  if (n === 0) return result;
  Object.assign(result, {shotsByWindow:bins, chancesByWindow:chances, chanceSides:sides,
    xg90:result.xgCount === n ? Number(xg.toFixed(2)) : null});
  return result;
}

export async function loadDay(day, token, fetchImpl = fetch) {
  const [start,end] = dayBounds(day);
  if (!token) throw new Error('未配置 BSD_API_TOKEN');
  async function get(path, params) {
    const url = new URL(path, HOST);
    url.search = new URLSearchParams(params).toString();
    const response = await fetchImpl(url, {headers:{Authorization:'Token '+token,Accept:'application/json'},
      redirect:'error', signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('BSD HTTP '+response.status);
    return response.json();
  }
  const groups = await Promise.all([...LEAGUES.keys()].map(async league => {
    const games = [];
    for(let offset=0;;offset+=100) {
      const page=await get('/api/events/', {league,status:'finished',date_from:start.toISOString().slice(0,10),
        date_to:end.toISOString().slice(0,10),limit:100,offset});
      if (!Array.isArray(page.results)) throw new Error('BSD 缺少赛程列表');
      for (const m of page.results) {
        const at=Date.parse(m.event_date);
        if (m.league?.id===league && m.status==='finished' && at>=+start && at<+end && Number.isSafeInteger(m.id)) games.push(m);
      }
      if (!page.next || !page.results.length) break;
    }
    return games;
  }));
  const fixtures=[...new Map(groups.flat().map(m=>[m.id,m])).values()];
  const matches=[];
  let failed=0;
  for(let i=0;i<fixtures.length;i+=4) {
    const batch=await Promise.all(fixtures.slice(i,i+4).map(async fixture=>{
      try {
        const detail=await get('/api/events/'+fixture.id+'/',{full:'true'});
        if (detail.id!==fixture.id) throw new Error('场次不一致');
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
