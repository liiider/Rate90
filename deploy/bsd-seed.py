"""Build a consistent full archive seed, or merge one into a Linux collector."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from urllib.parse import parse_qs, urlsplit


def read_only(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)


def verify(db):
    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
        raise ValueError('SQLite 完整性检查失败')
    if db.execute('SELECT 1 FROM captures LEFT JOIN bodies USING(hash) WHERE bodies.hash IS NULL LIMIT 1').fetchone():
        raise ValueError('归档包含无响应正文的记录')
    for digest, body in db.execute('SELECT hash,json FROM bodies'):
        if hashlib.sha256(body.encode()).hexdigest() != digest:
            raise ValueError('BSD 响应摘要不符')
    latest = dict(db.execute('SELECT path,max(observed_at) FROM captures GROUP BY path'))
    def payload(path):
        at = latest[path]
        return json.loads(db.execute('SELECT json FROM captures JOIN bodies USING(hash) WHERE path=? AND observed_at=?',
                                     (path, at)).fetchone()[0])
    finished = set()
    leagues = {1, 3, 4, 5, 6, 7}
    for league in leagues:
        season = payload(f'/api/v2/leagues/{league}/season/')
        sid = (season.get('season') or season)['id']
        cursor = f'/api/events/?league={league}&season={sid}&page=1'
        seen = set()
        while cursor:
            if cursor in seen:
                raise ValueError('归档赛程分页重复')
            seen.add(cursor)
            page = payload(cursor)
            for game in page['results']:
                if not game.get('replaced_by') and game.get('season', {}).get('id') == sid and game['status'] == 'finished':
                    finished.add(game['id'])
            link = page.get('next')
            cursor = None
            if link:
                query = parse_qs(urlsplit(str(link)).query)
                paging = '&'.join(f'{k}={int(query[k][0])}' for k in ('page','limit','offset') if k in query)
                if link is True:
                    paging = f'page={len(seen)+1}'
                cursor = f'/api/events/?league={league}&season={sid}&{paging}'
    if not finished:
        raise ValueError('全量归档缺少已完赛赛程')
    for game_id in finished:
        detail = payload(f'/api/events/{game_id}/?full=true')
        available = payload(f'/api/v2/events/{game_id}/availability/').get('available', {})
        if detail['id'] != game_id or detail['status'] != 'finished':
            raise ValueError(f'归档比赛状态不符 {game_id}')
        if available.get('player_stats'):
            latest[f'/api/v2/events/{game_id}/player-stats/']
        if detail.get('lineups') and available.get('heatmaps') is not False:
            latest[f'/api/v2/events/{game_id}/heatmaps/']
    print(f'全量基线核验通过，{len(finished)} 场已完赛，{db.execute("SELECT count(*) FROM captures").fetchone()[0]} 条原始响应。',
          flush=True)


def snapshot(source, dest):
    with closing(read_only(source)) as src, closing(sqlite3.connect(dest)) as out:
        src.backup(out)
        verify(out)
        with out:
            out.execute('CREATE TABLE IF NOT EXISTS archive_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL)')
            out.execute("INSERT OR IGNORE INTO archive_meta SELECT 'last_success', max(observed_at) FROM captures")


def merge(source, dest):
    if not source.is_file():
        raise FileNotFoundError(source)
    with closing(sqlite3.connect(dest, timeout=90)) as db:
        db.execute('ATTACH DATABASE ? AS seed', (source.resolve().as_uri()+'?mode=ro',))
        db.execute('BEGIN IMMEDIATE')
        try:
            for table in ('bodies','captures','throttle','archive_meta'):
                ddl = db.execute("SELECT sql FROM seed.sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()[0]
                if not db.execute("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                    db.execute(ddl)
            if db.execute('SELECT 1 FROM main.captures c JOIN seed.captures s USING(path,observed_at) WHERE c.hash<>s.hash LIMIT 1').fetchone():
                raise ValueError('同一时点的 BSD 响应冲突')
            if db.execute('SELECT 1 FROM main.bodies b JOIN seed.bodies s USING(hash) WHERE b.json<>s.json LIMIT 1').fetchone():
                raise ValueError('BSD 响应正文冲突')
            db.execute('INSERT OR IGNORE INTO main.bodies SELECT * FROM seed.bodies')
            db.execute('INSERT OR IGNORE INTO main.captures SELECT * FROM seed.captures')
            inserted = db.execute('SELECT changes()').fetchone()[0]
            db.execute('INSERT INTO main.throttle SELECT * FROM seed.throttle WHERE 1 ON CONFLICT(id) DO UPDATE SET until_ms=max(until_ms,excluded.until_ms)')
            db.execute("INSERT INTO main.archive_meta SELECT * FROM seed.archive_meta WHERE key='last_success' ON CONFLICT(key) DO UPDATE SET value=max(value,excluded.value)")
            db.commit()
        except BaseException:
            db.rollback()
            raise
        print(f'Linux 归档新增 {inserted} 条，共 {db.execute("SELECT count(*) FROM main.captures").fetchone()[0]} 条。', flush=True)


if __name__ == '__main__':
    action, src, dst = sys.argv[1:]
    {'snapshot': snapshot, 'merge': merge}[action](Path(src), Path(dst))
