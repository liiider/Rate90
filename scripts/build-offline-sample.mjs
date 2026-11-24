import {readFile, writeFile} from 'node:fs/promises';
import {beijingDate} from '../server/bsd.mjs';
import {formatFeed, ruleVersion} from '../server/recommend.mjs';

const target = new URL('../public/ui/data/', import.meta.url);
const sample = JSON.parse(await readFile(new URL('../data/bsd-sample.json', import.meta.url), 'utf8'));
const byDay = new Map();
for (const match of sample.matches) {
  // A Beijing viewing day ends at noon, exclusive.
  const day = beijingDate(new Date(Date.parse(match.kickoff) + 12 * 3600000));
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(match);
}

function save(name, data) {
  return writeFile(new URL(name + '.js', target), 'document.currentScript.rate90Data = ' + JSON.stringify(data, null, 2) + ';\n');
}

const index = {ruleVersion, matches:{}};
for (const [day, matches] of byDay) {
  const feed = {day, source:sample.source, mode:'sample', sampleOnly:true, capturedOn:sample.capturedOn, partial:false, matches};
  const cards = formatFeed(feed);
  await save('sample-' + day, cards);
  await save('sample-' + day + '-details', formatFeed(feed, true));
  for (const card of cards.matches) {
    if (card.rating !== null) index.matches[card.id] = {day, rating:card.rating, styles:card.viewing?.styles ?? [], chances:card.viewing?.chances ?? null};
  }
}
await save('process-ratings', index);
