// DOM regression suite for the checked-in snapshot. Run with Node and jsdom 26:
// npm install --no-save --package-lock=false jsdom@26 && node scripts/verify-ui.mjs
// RATE90_JSDOM can point to an existing jsdom installation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {JSDOM, ResourceLoader, VirtualConsole} = require(process.env.RATE90_JSDOM || 'jsdom');
const publicRoot = new URL('../public/', import.meta.url);
const home = 'https://rate90.test/index.html';
const mainMatch = '209642';
const taggedMatch = '209638';
const styles = ['关键先生','流畅配合'];

async function until(check, message) {
  const end = Date.now() + 6000;
  do {
    const result = check();
    if (result) return result;
    await delay(15);
  } while (Date.now() < end);
  assert.fail(message);
}

async function openApp(t, url, stored = {}, now = null, transformAsset = null) {
  const loaded = [];
  const errors = [];
  class LocalAssets extends ResourceLoader {
    fetch(address) {
      const target = new URL(address);
      const file = target.protocol === 'file:' ? target : new URL('.' + target.pathname, publicRoot);
      if ((!['file:', 'https:'].includes(target.protocol)) ||
          (target.protocol === 'https:' && target.origin !== new URL(home).origin) ||
          !file.href.startsWith(publicRoot.href)) {
        throw new Error('Unexpected resource ' + address);
      }
      const name = file.href.slice(publicRoot.href.length);
      loaded.push(name);
      const result = super.fetch(file.href);
      if (!transformAsset || !name.startsWith('ui/data/')) return result;
      return result.then(bytes => {
        const prefix = 'document.currentScript.rate90Data = ';
        const data = JSON.parse(bytes.toString().trim().slice(prefix.length,-1));
        transformAsset(name,data);
        return Buffer.from(prefix + JSON.stringify(data) + ';');
      });
    }
  }
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(await readFile(new URL('index.html', publicRoot), 'utf8'), {
    url, runScripts: 'dangerously', resources: new LocalAssets(), virtualConsole: console,
    beforeParse(w) {
      if (now !== null) w.Date.now = () => now;
      // jsdom provides <details> interaction and localStorage on HTTP origins.
      // It does not implement native dialogs, layout or scrolling.
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      w.scrollTo = () => {};
      if (new URL(url).protocol !== 'file:') {
        for (const [key, value] of Object.entries(stored)) w.localStorage.setItem(key, value);
      }
    }
  });
  const {window} = dom;
  const {document} = window;
  t.after(() => { window.close(); assert.deepEqual(errors, []); });
  await until(() => document.querySelector('#date-picker'), 'The application did not load');
  return {window, document, loaded};
}

function action(root, name, value) {
  const selector = '[data-act="' + name + '"]' + (value === undefined ? '' : '[data-val="' + value + '"]');
  const element = root.querySelector(selector);
  assert.ok(element, 'Missing control ' + selector);
  return element;
}

function card(document, id) {
  const entry = action(document.querySelector('#view'), 'details', id).closest('.match-card');
  assert.ok(entry, 'Missing match card for ' + id);
  return entry;
}

function visibleText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('details:not([open]) > :not(summary), [hidden], [aria-hidden="true"], script, style')
    .forEach(child => child.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

function assertRanking(group) {
  const ratings = [...group.querySelectorAll('.match-card .score-block')].map(score => {
    const value = Number.parseFloat(score.textContent);
    return Number.isFinite(value) ? value : -1;
  });
  assert.ok(ratings.length > 1);
  assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
}

function assertMainCard(document) {
  const entry = card(document, mainMatch);
  assert.match(visibleText(entry), /曼城/);
  assert.match(visibleText(entry), /富勒姆/);
  assert.equal(entry.querySelector('.score-block').textContent.trim(), '6.5');
  const tagged = card(document,taggedMatch);
  for (const label of styles) {
    const icon = tagged.querySelector('[aria-label="' + label + '"]');
    assert.ok(icon?.querySelector('svg') || icon?.matches('svg'), 'Missing icon ' + label);
    assert.ok(!visibleText(tagged).includes(label), 'Visible text on icon-only card: ' + label);
  }
  assert.equal(entry.querySelector('[data-act="watch"]'),null);
  assert.doesNotMatch(visibleText(entry), /超燃必看|看看集锦|焦点之战|评分来源|可跳过|无剧透看点/);
}

test('dates resolve to whole competition rounds and selectors preserve card scores', async t => {
  const {document, window, loaded} = await openApp(t, home + '?view=date&date=2026-11-21');
  assert.equal(action(document,'league','all').getAttribute('aria-pressed'),'true');
  assert.deepEqual([...document.querySelectorAll('.round-group')].map(el => el.dataset.league + '/' + el.dataset.round).sort(),
    ['bl/10','l1/11','ll/13','pl/11','sa/12']);
  assertMainCard(document);
  assert.ok(action(document,'prevRound').disabled && action(document,'nextRound').disabled);
  assert.equal(document.querySelectorAll('[data-act="search"],[data-act="view"],.step-btn,.shortcut-hint,#snapshot-date').length,0);
  action(document,'league','pl').click();
  action(document,'toggleCal').click();
  action(document,'pickDate','2026-11-22').click();
  const group = document.querySelector('.round-group');
  assert.equal(group.dataset.round,'11');
  assert.equal(group.querySelectorAll('.match-card').length,10);
  assertRanking(group);
  assertMainCard(document);
  const select = document.querySelector('#round-picker');
  select.value = '10';
  select.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert.equal(document.querySelector('.round-group').dataset.round,'10');
  assert.ok(!loaded.some(x => /ui\/data\/(collected|rounds)\//.test(x)));
  action(document,'league','all').click();
  const currentGroups = [...document.querySelectorAll('.round-group')];
  assert.deepEqual(currentGroups.map(el=>el.dataset.league).sort(),['bl','cl','l1','ll','pl','sa']);
  const catalog = await window.Rate90.catalog.loadCatalog();
  for (const group of currentGroups) {
    const league = group.dataset.league;
    assert.equal(group.dataset.round,String(window.Rate90.catalog.latestPlayedRound(catalog,league)));
  }
  action(document,'toggleCal').click();
  for (const month of ['10','09','08','07']) action(document,'calMonth','2026-' + month).click();
  const early = action(document,'pickDate','2026-07-08');
  assert.match(early.title,/暂无评分/);
  early.click();
  assert.equal(document.activeElement,action(document,'toggleCal'));
  assert.equal(document.querySelectorAll('.round-group').length,1);
  assert.equal(document.querySelector('.round-group').dataset.league,'cl');
  assert.equal(document.querySelector('.round-group').dataset.round,'Qualification Round 1');
  assert.equal(action(document,'league','all').getAttribute('aria-pressed'),'true');
  assert.equal(document.querySelector('.round-group').querySelectorAll('.match-card').length,28);
  action(document,'method').click();
  const overlay = document.querySelector('#overlay');
  assert.match(overlay.textContent,/满分 10 分/);
  action(overlay,'close').click();
  const linked = await openApp(t,home + '?match=' + taggedMatch);
  const reasons = linked.document.querySelector('#overlay .detail-hero-tags');
  assert.deepEqual([...reasons.querySelectorAll('b')].map(el => el.textContent),[...catalog.byId.get(taggedMatch).styles]);
  assert.ok([...reasons.querySelectorAll('small')].every(el => el.textContent.length > 5));
  await until(() => linked.document.querySelector('.starters li'),'The linked match did not load');
});

test('each spoiler tab unlocks separately per match and the tactical panel displays one team', async t => {
  const oldAnalysis = '3比1后，穆里尼奥在70分钟用卡马文加换下居莱尔，80分钟再用卜拉欣·迪亚斯换下迪奥曼德。两次换人之间，埃因霍温仅有一次被封堵的射门；这些记录不足以证明皇马主动回收了防线。';
  const review = name => ({score:7,nodes:[{time:'终场',analysis:name,comment:'点评'}]});
  const {document} = await openApp(t, home + '?view=date&date=2026-11-21&match=' + mainMatch,{},null,(name,data)=>{
    if (name === 'ui/data/collected-index.js') data.fixtures.find(f=>f.id===mainMatch).tacticalCoverage=true;
    if (!name.startsWith('ui/data/collected/') || name.endsWith('-preview.js')) return;
    const match=data.matches.find(m=>m.id===mainMatch);
    if (match?.details) {
      match.details.tactics={home:review('主队独立分析'),away:review('客队独立分析')};
      match.details.tactics.home.nodes.unshift({time:'70′–80′',analysis:oldAnalysis,comment:'领先时保留向前接应点。'});
    }
  });
  const overlay = document.querySelector('#overlay');
  await until(() => overlay.querySelectorAll('.starters li').length === 22, 'Expected both complete starting lineups');
  await until(() => overlay.querySelector('.starters')?.textContent.includes('鲁本·迪亚斯'), 'Expected Chinese squad names');
  for (const [side, formation, coach, captain] of [
    ['home', '4-2-3-1', '恩佐·马雷斯卡', '鲁本·迪亚斯'],
    ['away', '4-3-3', '阿尔瓦罗·阿韦洛亚', '巴锡']
  ]) {
    const team = overlay.querySelector('.lineup-team[data-side="' + side + '"]');
    assert.equal(team.querySelectorAll('.starters li').length, 11);
    assert.match(team.querySelector('.formation').textContent, new RegExp(formation));
    assert.ok(team.querySelector('.coach').textContent.includes(coach));
    const captainMark = team.querySelector('.starters .captain');
    assert.ok(captainMark?.closest('li').textContent.includes(captain));
    assert.ok([...team.querySelectorAll('.starters li')].every(row => /^\d+$/.test(row.querySelector('.shirt-number')?.textContent)));
  }
  assert.equal(overlay.querySelector('.detail-hero-tags'),null);
  assert.doesNotMatch(visibleText(overlay), /切尔基|116\.6|119\.0|揭晓|全场比分/);
  action(overlay,'detailTab','substitutes').click();
  assert.match(visibleText(overlay.querySelector('[data-panel="substitutes"]')), /切尔基/);
  action(overlay,'detailTab','stats').click();
  assert.ok(overlay.querySelector('[data-panel="guard"]'));
  assert.equal(document.activeElement,action(overlay,'cancelPeek'));
  assert.equal(overlay.querySelector('.match-stats'), null);
  action(overlay,'cancelPeek').click();
  assert.equal(document.activeElement,action(overlay,'detailTab','substitutes'));
  assert.ok(overlay.querySelector('[data-panel="substitutes"]'));
  action(overlay,'detailTab','stats').click();
  action(overlay,'confirmPeek','stats').click();
  assert.equal(document.activeElement,action(overlay,'detailTab','stats'));
  const statsText = visibleText(overlay.querySelector('[data-panel="stats"]'));
  for (const value of ['116.6','射门','射正','预期进球','控球','传中','抢断']) assert.ok(statsText.includes(value),value);
  assert.doesNotMatch(statsText,/全场比分|乌龙球|xG/);
  const minutes = [...overlay.querySelectorAll('.pressure-chart svg rect title')].map(item => Number.parseInt(item.textContent, 10));
  // The archived provider response for 209642 ends in minute 89.
  assert.deepEqual(minutes, Array.from({length: 89}, (_, i) => i + 1));
  action(overlay,'detailTab','events').click();
  assert.ok(overlay.querySelector('[data-panel="guard"]'));
  action(overlay,'confirmPeek','events').click();
  const eventText = visibleText(overlay.querySelector('[data-panel="events"]'));
  for (const value of ['换人','黄牌','费尔南德斯']) assert.ok(eventText.includes(value),value);
  assert.doesNotMatch(eventText,/进球|点球大战|全场比分/);
  assert.equal(action(overlay,'detailTab','events').textContent,'比赛动态');
  action(overlay,'detailTab','tactics').click();
  assert.ok(overlay.querySelector('[data-panel="guard"]'));
  assert.doesNotMatch(overlay.textContent,/主队独立分析|客队独立分析/);
  action(overlay,'confirmPeek','tactics').click();
  assert.match(overlay.textContent,/主队独立分析/);
  assert.match(overlay.textContent,/埃因霍温只完成一脚射门/);
  assert.doesNotMatch(overlay.textContent,/不足以证明/);
  assert.doesNotMatch(overlay.textContent,/客队独立分析/);
  action(overlay,'tacticalSide','away').click();
  assert.match(overlay.textContent,/客队独立分析/);
  assert.doesNotMatch(overlay.textContent,/主队独立分析/);
  action(overlay,'detailTab','stats').click();
  assert.ok(overlay.querySelector('[data-panel="stats"]'));
  action(overlay,'detailTab','tactics').click();
  assert.match(overlay.textContent,/客队独立分析/);
  action(overlay, 'close').click();
  action(document,'league','sa').click();
  action(document.querySelector('#view'), 'details', '210170').click();
  await until(() => overlay.querySelectorAll('.starters li').length === 22, 'Expected Como lineup');
  for (const tab of ['events','tactics']) {
    action(overlay,'detailTab',tab).click();
    assert.ok(overlay.querySelector('[data-panel="guard"]'));
    action(overlay,'cancelPeek').click();
  }
  action(overlay,'detailTab','stats').click();
  assert.ok(overlay.querySelector('[data-panel="guard"]'));
  action(overlay,'confirmPeek','stats').click();
  const stats = overlay.querySelector('[data-panel="stats"]');
  assert.doesNotMatch(visibleText(stats), /跑动距离|公里|\bkm\b/i);
});

test('wheeling over substitutions and cards uses the event panel scroll boundaries', async t => {
  const {document, window} = await openApp(t, home + '?match=' + mainMatch);
  const overlay = document.querySelector('#overlay');
  await until(() => overlay.querySelector('.starters li'), 'Expected match details');
  action(overlay, 'detailTab', 'events').click();
  action(overlay, 'confirmPeek', 'events').click();
  const panel = overlay.querySelector('[data-panel="events"]');
  // jsdom does not calculate layout. Model 500 pixels of available scrolling.
  Object.defineProperties(panel, {clientHeight: {value: 300}, scrollHeight: {value: 800}});
  for (const selector of ['.tl-sub-in', '.tl-icon.is-card']) {
    const target = panel.querySelector(selector);
    assert.ok(target, selector);
    for (const [top, deltaY, allowed] of [
      [0, -50, false], [0, 50, true], [250, -50, true], [250, 50, true],
      [500, -50, true], [500, 50, false]
    ]) {
      panel.scrollTop = top;
      const wheel = new window.WheelEvent('wheel', {bubbles: true, cancelable: true, deltaY});
      assert.equal(target.dispatchEvent(wheel), allowed, `${selector} at ${top}, wheel ${deltaY}`);
    }
  }
});

test('language switches teams, match details and guard labels and survives a reload', async t => {
  const {document, window} = await openApp(t, home + '?view=date&date=2026-11-21');
  assert.equal(document.documentElement.lang,'zh-CN');
  const route = window.location.href;
  action(document,'lang').click();
  assert.equal(document.documentElement.lang,'en');
  assert.equal(window.location.href,route);
  assert.match(visibleText(card(document,mainMatch)),/Manchester City/);
  assert.match(visibleText(card(document,mainMatch)),/Fulham/);
  assert.equal(document.querySelector('[data-act="watched"]'),null);
  const saved = Object.fromEntries(Object.entries(window.localStorage));
  const reloaded = await openApp(t, home + '?match=' + mainMatch, saved);
  const page = reloaded.document;
  const overlay = page.querySelector('#overlay');
  await until(() => overlay.querySelector('.starters li'),'Expected English lineups');
  assert.equal(page.documentElement.lang,'en');
  assert.match(overlay.querySelector('.coach').textContent,/Enzo Maresca/);
  assert.match(overlay.querySelector('.starters').textContent,/Rúben Dias/);
  assert.equal(action(overlay,'detailTab','lineups').textContent,'Lineups');
  action(overlay,'detailTab','events').click();
  assert.equal(action(overlay,'confirmPeek','events').textContent,'Take a peek');
  action(overlay,'close').click();
  action(page,'lang').click();
  assert.equal(page.documentElement.lang,'zh-CN');
  assert.match(visibleText(page.querySelector('#view')),/曼城/);
});

test('direct-file entry supports the old top link and hash-addressed match details', async t => {
  const index = new URL('index.html', publicRoot);
  const legacy = await openApp(t, index.href + '#view=top');
  const groups = [...legacy.document.querySelectorAll('.round-group')];
  assert.equal(new Set(groups.map(el => el.dataset.league)).size,6);
  assert.equal(new Set(groups.map(el => el.dataset.league + '/' + el.dataset.round)).size,groups.length);
  assert.equal(legacy.document.querySelector('#round-picker').value,'current');
  assert.equal(groups.length,6);
  const allRounds = await openApp(t, index.href + '#round=all');
  const games = [...allRounds.document.querySelectorAll('.match-card [data-act="details"]')].map(el => el.dataset.val);
  assert.equal(new Set(games).size,games.length);
  assert.equal(games.length,(await allRounds.window.Rate90.catalog.loadCatalog()).matches.length);
  assert.equal(allRounds.document.querySelector('#round-picker').value,'all');
  assertRanking(legacy.document.querySelector('.round-group[data-league="pl"]'));
  const linked = await openApp(t, index.href + '#view=date&date=2026-11-21&match=' + mainMatch);
  const overlay = linked.document.querySelector('#overlay');
  await until(() => overlay.open && overlay.querySelectorAll('.starters li').length === 22, 'File hash did not restore match details');
  assert.equal(overlay.querySelector('[data-act="watch"]'),null);
});

test('back and forward reopen the linked match; closing a direct link removes the match from the URL', async t => {
  const {document, window} = await openApp(t, home + '?view=date&date=2026-11-21');
  const overlay = document.querySelector('#overlay');
  action(document.querySelector('#view'), 'details', mainMatch).click();
  const matchParam = () => new URL(window.location.href).searchParams.get('match');
  assert.equal(matchParam(), mainMatch);
  window.history.back();
  await until(() => !overlay.open && matchParam() === null, 'Back did not restore the match list');
  window.history.forward();
  await until(() => overlay.open && matchParam() === mainMatch && overlay.querySelector('.starters li'), 'Forward did not restore the same match');

  const direct = await openApp(t, window.location.href);
  const shared = direct.document.querySelector('#overlay');
  await until(() => shared.querySelector('.starters li'), 'Direct match details did not finish loading');
  action(shared, 'close').click();
  assert.equal(shared.open, false);
  assert.equal(new URL(direct.window.location.href).searchParams.get('match'), null);
});

test('one round picker selects upcoming and historical fixtures and survives scope and history changes',async t=>{
  const now=Date.parse('2026-11-23T09:00:00Z');
  const {document,window}=await openApp(t,home+'?league=pl',{},now);
  const picker=()=>document.querySelector('#round-picker');
  const select=value=>{
    picker().value=value;
    picker().dispatchEvent(new window.Event('change',{bubbles:true}));
  };
  await until(()=>[...picker().options].some(o=>o.value==='next' && /12/.test(o.textContent)),'Upcoming round labels did not load');
  assert.equal(picker().options[0].textContent,'全部轮次');
  assert.equal(picker().querySelector('option[value="next"]').textContent,'第 12 轮');
  assert.equal(picker().querySelector('option[value="following"]').textContent,'第 13 轮');
  assert.equal(document.querySelector('.watch-mode,[data-act="future"],[data-act="historyView"]'),null);
  select('next');
  await until(()=>document.querySelector('.preview-row'),'Future schedule did not load');
  assert.equal(document.querySelectorAll('.preview-row').length,10);
  assert.equal(picker().value,'next');
  action(document,'nextRound').click();
  assert.equal(picker().value,'following');
  assert.match(document.querySelector('.preview-round').textContent,/13/);
  action(document,'league','all').click();
  assert.equal(picker().value,'current');
  select('following');
  assert.equal(document.querySelectorAll('.preview-round').length,6);
  assert.equal(document.querySelectorAll('.preview-row').length,66);
  const catalog = await window.Rate90.catalog.loadCatalog();
  const prematch = await window.Rate90.catalog.loadPrematch(catalog.prematchFile);
  const nextPl = window.Rate90.upcoming.sections(prematch,{league:'pl',horizon:1},now)[0];
  const upcomingDate = window.Rate90.upcoming.day(nextPl.games[0]);
  action(document,'toggleCal').click();
  action(document,'pickDate',upcomingDate).click();
  assert.ok(document.querySelectorAll('.preview-row').length>0);
  assert.ok([...document.querySelectorAll('.preview-row time')].every(t=>t.textContent.startsWith(window.Rate90.catalog.cnDate(upcomingDate))));
  window.history.back();
  await until(()=>picker().value==='following','Back did not restore the second future round');
  select('10');
  assert.ok(document.querySelector('.round-group[data-round="10"]'));
  select('all');
  assert.equal(picker().value,'all');
});

test('upcoming picks distinguish an empty selection, an unassessed date and a league-specific selection',async t=>{
  const now=Date.parse('2026-11-23T09:00:00Z');
  const {window,document}=await openApp(t,home,{},now);
  const {catalog,upcoming}=window.Rate90;
  const data=await catalog.loadCatalog();
  const feed=await catalog.loadPrematch(data.prematchFile);
  const first=feed.rounds.find(r=>r.league==='pl').games[0];
  const other={...feed.rounds.find(r=>r.league==='cl').games[0],kickoff:first.kickoff};
  const date=upcoming.day(first);
  const scope='date/'+date, record={ids:[first.id,other.id],items:[]};
  const preview={rounds:[],extra:[first,other],picks:{[scope]:record}};
  const render=league=>{
    const sections=upcoming.sections(preview,{date,league},now);
    const panel=document.createElement('div');
    panel.innerHTML=upcoming.view({...data,prematch:preview},sections);
    return panel;
  };
  assert.match(render('all').textContent,/暂无全场推荐/);
  assert.doesNotMatch(render('pl').textContent,/暂无全场推荐/);
  preview.picks[scope+'/pl']={ids:[first.id],items:[{id:first.id,reason:'双方近期都在末段创造机会。'}]};
  assert.equal(render('pl').querySelectorAll('.pick-card').length,1);
  assert.equal(render('pl').querySelector('.pick-reason').textContent,'双方近期都在末段创造机会。');
  assert.equal(render('cl').querySelector('.pick-card'),null);
});
