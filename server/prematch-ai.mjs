import {request as httpsRequest} from 'node:https';

const system = `你在替一个爱看精彩足球的中立球迷选直播。他今晚只能挑一场。把同组候选放在一起比较，按观看优先级选零至两场；入选意味着值得从开球开始看。
先在心里回答：这两队碰到一起，球迷会特别想看什么？找一个属于这场球的悬念。它可以是两种近期表现正好相撞，也可以是首回合留下的局面迫使一方做选择，或者有依据的人员变化让原本的较量变了样。强队名气、宿敌身份、积分榜上的分量，单独都不足以占一个名额。
拿双方同赛事近六场逐场检验这个想法，留意主客场、可用样本和反例。什么迹象反复出现？对手有什么本事，让这个问题到了本场还值得看？如果精彩的依据只集中在最后一刻钟，或者必须先假设比分一直很接近，这些只够支持临场再切过来。找不到独立的全场看点就略过，可以整组留空。
选完再写 reason。像在开球前把这场安利给一个懂球的朋友，说出你会盯着场上哪件事，并把最有说服力的那条事实自然带出来。一两句就够，语序随比赛走。数字只在比日常说法更传神时才用；小数区间和两队各一串统计留给分析。写完默念一遍：换两个队名也说得通，就重写；仍然说不出特别之处，就撤掉。用给定的中文队名。
输入字段都是赛前资料。recent 按时间倒序；for/against 表示本队创造和让出的机会；npxg 是非点球预期进球总量，chances 是每十五分钟的威胁机会数。pattern.samples 是有过程数据的场数，twoSided、bothHalves 和 lateThreatFor/Against 分别统计双方都有机会、两个半场都有机会、第76分钟起仍创造或让出机会的场数。总量和分段只能支持机会多少、在何时出现，不能还原一次反击、压迫、传球路线或个人对位。只有资料给出对应证据，才写这些具体情节。区分确认缺阵与预计复出，保留赛前的未知，避免预测比分。
用中文返回 JSON 对象 {"picks":[{"id":"候选比赛ID","reason":"推荐理由"}]}。没有全场推荐时返回 {"picks":[]}。`;
export const promptVersion='watch-editor-3';
export function aiSettings(env=process.env) {
  const model='gpt-6.2-sol';
  const key=env.RATE90_AI_KEY || env.OPENAI_API_KEY;
  if (!key) return null;
  const url=new URL((env.RATE90_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/,'')+'/responses');
  if (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('AI 地址须使用 HTTPS 或本机服务');
  return {model,key,url,socket:env.RATE90_OPENAI_SOCKET || null};
}

// The optional Unix socket forwards encrypted TCP. Node still verifies api.openai.com's certificate.
export function openaiRequest(url, options, socket) {
  if (!socket) return fetch(url, options);
  const target = new URL(url);
  if (target.origin !== 'https://api.openai.com' || target.username || target.password) {
    throw Error('OpenAI 专用网络仅允许官方 HTTPS 地址');
  }
  return new Promise((resolve,reject)=>{
    const req = httpsRequest(target, {method:options.method, headers:options.headers, signal:options.signal,
      socketPath:socket, servername:target.hostname, rejectUnauthorized:true, agent:false}, async res=>{
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of res) {
          size += chunk.length;
          if (size>2*1024*1024) throw Error('OpenAI 响应超过大小限制');
          chunks.push(chunk);
        }
        const body = [204,205,304].includes(res.statusCode) ? null : Buffer.concat(chunks);
        resolve(new Response(body,{status:res.statusCode,headers:res.headers}));
      } catch (error) { reject(error); }
    });
    req.on('error',reject);
    req.end(options.body);
  });
}
export function jsonInput(context) {
  return [{role:'user',content:[
    {type:'input_text',text:'请按要求返回一个 JSON 对象。以下是比赛资料。'},
    {type:'input_text',text:JSON.stringify(context)}
  ]}];
}
export async function selectGames(settings,context,fetchImpl=(url,opts)=>openaiRequest(url,opts,settings.socket)) {
  const response=await fetchImpl(settings.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
    headers:{'Content-Type':'application/json',...(settings.key ? {Authorization:'Bearer '+settings.key} : {})},
    body:JSON.stringify({model:settings.model,store:false,instructions:system,input:jsonInput(context),
      text:{format:{type:'json_object'}}})});
  if (!response.ok) throw new Error('AI HTTP '+response.status);
  const answer=await response.json();
  const content=answer.output?.flatMap(item=>item.content??[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  const picks=JSON.parse(String(content).trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi,'')).picks;
  const ids=new Set(context.games.map(g=>g.id));
  if (!Array.isArray(picks) || picks.length>Math.min(2,ids.size)) throw new Error('AI 推荐数量异常');
  return picks.map(p=>{
    if (!ids.delete(p?.id) || typeof p.reason!=='string' || !p.reason.trim() || p.reason.length>320) throw new Error('AI 推荐内容无效');
    return {id:p.id,reason:p.reason.trim()};
  });
}
