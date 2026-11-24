import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from './dev.mjs';

async function request(url, method = 'GET') {
  const response = {
    statusCode: 200,
    headers: new Headers(),
    setHeader(name, value) { this.headers.set(name, value); },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value);
    },
    end(body) { this.body = body?.toString() ?? ''; }
  };
  await handleRequest({method, url}, response);
  return response;
}

test('the local site serves the home page and every entry script with its declared type', async () => {
  const page = await request('/?view=all');
  assert.equal(page.statusCode, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const scripts = Array.from(page.body.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), m => m[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    const resource = await request(new URL(script, 'http://localhost/').pathname);
    assert.equal(resource.statusCode, 200, script);
    assert.match(resource.headers.get('content-type'), /javascript/);
  }
  const head = await request('/', 'HEAD');
  assert.equal(head.body, '');
  assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(page.body));
  assert.equal((await request('/world-cup-2022.html')).statusCode, 200);
  assert.equal((await request('/matchweek.html')).statusCode, 200);
});

test('static and API requests use the correct HTTP errors and allowed methods', async () => {
  assert.equal((await request('/ui/not-a-file.js')).statusCode, 404);
  assert.equal((await request('/%')).statusCode, 400);
  const write = await request('/', 'POST');
  assert.equal(write.statusCode, 405);
  assert.equal(write.headers.get('allow'), 'GET, HEAD');
  const apiWrite = await request('/api/matches', 'POST');
  assert.equal(apiWrite.statusCode, 405);
  assert.equal(apiWrite.headers.get('allow'), 'GET');
  const badDate = await request('/api/matches?date=2026-02-31');
  assert.equal(badDate.statusCode, 400);
  assert.equal(badDate.headers.get('cache-control'), 'no-store');
});

test('the home server returns the shipped match list and loads the same match with details', async () => {
  const url = '/api/matches?date=2026-11-22';
  const list = await request(url);
  assert.equal(list.statusCode, 200);
  assert.match(list.headers.get('content-type'), /application\/json/);
  const listMatch = JSON.parse(list.body).matches.find(m => m.id === '209642');
  assert.equal(listMatch?.rating, 6.6);
  assert.equal(listMatch.details, undefined);
  const full = await request(url + '&details=1');
  assert.equal(full.statusCode, 200);
  const match = JSON.parse(full.body).matches.find(m => m.id === listMatch.id);
  assert.equal(match.rating, listMatch.rating);
  assert.equal(match.details.lineups.home.players.length, 11);
  assert.equal(match.details.lineups.away.players.length, 11);
  assert.equal(match.details.score90, undefined);
});
