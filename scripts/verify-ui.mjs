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
const migu = 'https://www.miguvideo.com/';
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

async function openApp(t, url, stored = {}, now = null) {
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
      loaded.push(file.href.slice(publicRoot.href.length));
      return super.fetch(file.href);
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
  const watch = action(entry, 'watch');
  assert.equal(watch.href, migu);
  assert.equal(watch.target, '_blank');
  assert.ok(!action(entry, 'details').contains(watch), 'Watch link nested in details button');
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
  assert.deepEqual([...document.querySelectorAll('.round-group')].map(el => el.dataset.league).sort(),['bl','l1','ll','pl','sa']);
  assert.ok([...document.querySelectorAll('.round-group')].every(el => el.dataset.round === '10'));
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
  assert.deepEqual([...reasons.querySelectorAll('b')].map(el => el.textContent),styles);
  assert.ok([...reasons.querySelectorAll('small')].every(el => el.textContent.length > 5));
  await until(() => linked.document.querySelector('.starters li'),'The linked match did not load');
});

test('lineups and substitutes are spoiler-free; peek confirmation reveals stats and cards for that match', async t => {
  const {document} = await openApp(t, home + '?view=date&date=2026-11-21&match=' + mainMatch);
  const overlay = document.querySelector('#overlay');
  await until(() => overlay.querySelectorAll('.starters li').length === 22, 'Expected both complete starting lineups');
  for (const [side, formation, coach, captain] of [
    ['home', '4-2-3-1', 'Enzo Maresca', 'Rúben Dias'],
    ['away', '4-3-3', 'Álvaro Arbeloa', 'Calvin Bassey']
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
  assert.doesNotMatch(visibleText(overlay), /Rayan Cherki|116\.6|119\.0|揭晓|全场比分/);
  action(overlay,'detailTab','substitutes').click();
  assert.match(visibleText(overlay.querySelector('[data-panel="substitutes"]')), /Rayan Cherki/);
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
  for (const value of ['116.6','射门','射正','xG','控球','传中','抢断']) assert.ok(statsText.includes(value),value);
  assert.doesNotMatch(statsText,/全场比分|乌龙球/);
  const minutes = [...overlay.querySelectorAll('.pressure-chart svg rect title')].map(item => Number.parseInt(item.textContent, 10));
  // The archived provider response for 209642 ends in minute 89.
  assert.deepEqual(minutes, Array.from({length: 89}, (_, i) => i + 1));
  action(overlay,'detailTab','events').click();
  const eventText = visibleText(overlay.querySelector('[data-panel="events"]'));
  for (const value of ['换人','黄牌','E. Fernández']) assert.ok(eventText.includes(value),value);
  assert.doesNotMatch(eventText,/进球|点球大战|全场比分/);
  action(overlay, 'close').click();
  action(document,'league','sa').click();
  action(document.querySelector('#view'), 'details', '210170').click();
  await until(() => overlay.querySelectorAll('.starters li').length === 22, 'Expected Como lineup');
  action(overlay,'detailTab','stats').click();
  assert.ok(overlay.querySelector('[data-panel="guard"]'));
  action(overlay,'confirmPeek','stats').click();
  const stats = overlay.querySelector('[data-panel="stats"]');
  assert.doesNotMatch(visibleText(stats), /跑动距离|公里|\bkm\b/i);
});

test('only a watch click records the match, repeated clicks persist once after reload and removing restores unwatched state', async t => {
  const {document, window} = await openApp(t, home + '?view=date&date=2026-11-21', {
    'rate90.v2.bookmarks': JSON.stringify([mainMatch])
  });
  const overlay = document.querySelector('#overlay');
  const stored = () => Object.fromEntries(Object.entries(window.localStorage));
  const before = stored();
  action(document.querySelector('#view'), 'details', mainMatch).click();
  await until(() => overlay.querySelector('.starters li'), 'Lineup failed to load');
  action(overlay, 'close').click();
  assert.deepEqual(stored(), before);
  action(document, 'watched').click();
  assert.equal(overlay.querySelectorAll('[data-act="removeWatched"]').length, 0);
  action(overlay, 'close').click();

  const outbound = [];
  window.addEventListener('click', event => {
    const link = event.target.closest('a[data-act="watch"]');
    if (!link) return;
    assert.equal(event.defaultPrevented, false, 'Watch navigation was canceled by the site');
    outbound.push(link.href);
    event.preventDefault(); // Record the destination without opening the external service.
  });
  for (let i = 0; i < 2; i++) action(card(document, mainMatch), 'watch').click();
  assert.deepEqual(outbound, [migu, migu]);
  assert.equal(overlay.open, false);
  const reloaded = await openApp(t, window.location.href, stored());
  action(reloaded.document, 'watched').click();
  const history = reloaded.document.querySelector('#overlay');
  assert.equal(history.querySelectorAll('[data-act="removeWatched"]').length, 1);
  action(history, 'removeWatched', mainMatch).click();
  assert.equal(history.querySelectorAll('[data-act="removeWatched"]').length, 0);
  const again = await openApp(t, window.location.href, Object.fromEntries(Object.entries(reloaded.window.localStorage)));
  action(again.document, 'watched').click();
  assert.equal(again.document.querySelector('#overlay').querySelectorAll('[data-act="removeWatched"]').length, 0);
});

test('direct-file entry supports the old top link and hash-addressed match details', async t => {
  const index = new URL('index.html', publicRoot);
  const legacy = await openApp(t, index.href + '#view=top');
  const groups = [...legacy.document.querySelectorAll('.round-group')];
  assert.equal(new Set(groups.map(el => el.dataset.league)).size,6);
  assert.equal(new Set(groups.map(el => el.dataset.league + '/' + el.dataset.round)).size,groups.length);
  const games = [...legacy.document.querySelectorAll('.match-card [data-act="details"]')].map(el => el.dataset.val);
  assert.equal(new Set(games).size,games.length);
  assert.equal(games.length,(await legacy.window.Rate90.catalog.loadCatalog()).matches.length);
  assert.equal(legacy.document.querySelector('#round-picker').value,'all');
  assertRanking(legacy.document.querySelector('.round-group[data-league="pl"]'));
  const linked = await openApp(t, index.href + '#view=date&date=2026-11-21&match=' + mainMatch);
  const overlay = linked.document.querySelector('#overlay');
  await until(() => overlay.open && overlay.querySelectorAll('.starters li').length === 22, 'File hash did not restore match details');
  assert.equal(action(overlay, 'watch').href, migu);
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
  assert.equal(document.querySelectorAll('.preview-round').length,6);
  assert.equal(document.querySelectorAll('.preview-row').length,66);
  action(document,'toggleCal').click();
  action(document,'pickDate','2026-11-25').click();
  assert.ok(document.querySelectorAll('.preview-row').length>0);
  assert.ok([...document.querySelectorAll('.preview-row time')].every(t=>t.textContent.startsWith('11月25日')));
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
