"""Render crawlable, spoiler-free English guides from an existing public snapshot."""
import argparse
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from html import escape
import json
from pathlib import Path
import posixpath
import re
import unicodedata
from urllib.parse import urlencode

BASE = 'https://r90.liderrr.cc'
PREFIX = 'document.currentScript.rate90Data = '
LEAGUES = {
    'pl': ('Premier League', 'premier-league'), 'll': ('La Liga', 'la-liga'),
    'sa': ('Serie A', 'serie-a'), 'bl': ('Bundesliga', 'bundesliga'),
    'l1': ('Ligue 1', 'ligue-1'), 'cl': ('Champions League', 'champions-league'),
}
TAGS = {
    'heavyweights': 'Heavyweight clash', 'rivalry': 'Rivalry', 'talisman': 'Standout player',
    'flashpoint-player': 'Flashpoint player', 'contested-call': 'Contested call',
    'var-spotlight': 'VAR spotlight', 'end-to-end': 'End-to-end', 'team-move': 'Team move',
    'keeper-show': 'Keeper show', 'late-drama': 'Late drama', 'highlight-reel': 'Highlight reel',
}
CHINA = timezone(timedelta(hours=8))


def read_asset(path):
    text = path.read_text(encoding='utf-8').strip()
    if not text.startswith(PREFIX) or not text.endswith(';'):
        raise ValueError('Invalid public data asset: ' + path.name)
    return json.loads(text[len(PREFIX):-1])


def file_path(path):
    return 'public/' + path.lstrip('/') + ('index.html' if path.endswith('/') else '')


def relative(page, dest):
    return posixpath.relpath(file_path(dest), posixpath.dirname(file_path(page)))


def slug(name):
    plain = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', plain).strip('-') or 'team'


def team_url(key, name):
    suffix = key if re.fullmatch(r'[0-9]+', key) else sha256(key.encode()).hexdigest()[:10]
    return f'/en/teams/{slug(name)}-{suffix}/'


def league_url(code):
    return f'/en/leagues/{LEAGUES[code][1]}/'


def link(page, dest, label):
    return f'<a href="{escape(relative(page, dest), quote=True)}">{escape(label)}</a>'


def match_link(page, match):
    query = urlencode({'lang': 'en', 'league': match['league'], 'round': match.get('round') or '', 'match': match['id']})
    return escape(relative(page, '/index.html') + '?' + query, quote=True)


def kickoff(match):
    try:
        return datetime.fromisoformat(match['date'] + 'T' + (match.get('time') or '12:00')).replace(tzinfo=CHINA).astimezone(timezone.utc)
    except (TypeError, ValueError, KeyError):
        return None


def rated_season(index):
    as_of = datetime.fromisoformat(index['updatedAt'].replace('Z', '+00:00')).astimezone(timezone.utc)
    start_year = as_of.year - (as_of.month < 7)
    start, end = date(start_year, 7, 1), date(start_year + 1, 7, 1)
    matches = {}
    for f in index.get('fixtures', []):
        at = kickoff(f)
        rating = f.get('rating')
        if (f.get('status') != 'finished' or f.get('replacedBy') or f.get('league') not in LEAGUES or
                isinstance(rating, bool) or not isinstance(rating, (int, float)) or not 0 <= rating <= 10 or
                not at or not start <= date.fromisoformat(f['date']) < end or at > as_of or not f.get('home') or not f.get('away') or not f.get('id')):
            continue
        matches[str(f['id'])] = {**f, 'id': str(f['id']), 'home': str(f['home']), 'away': str(f['away']), 'at': at}
    return as_of, f'{start_year}/{str(start_year + 1)[-2:]}', list(matches.values())


def ranking(rows):
    return sorted(rows, key=lambda m: (-m['rating'], -m['at'].timestamp(), m['id']))


def display_name(key, teams):
    return str(teams.get(key, {}).get('en') or key)


def match_table(page, rows, teams, limit=20):
    if not rows:
        return '<p class="guide-empty">No completed matches with ratings in this period yet.</p>'
    items = []
    for m in ranking(rows)[:limit]:
        home, away = (display_name(m[side], teams) for side in ('home', 'away'))
        tags = ', '.join(TAGS[t] for t in m.get('styleIds', []) if t in TAGS)
        tag_html = f'<span class="guide-tags">{escape(tags)}</span>' if tags else ''
        when = m['at'].strftime('%d %b %Y, %H:%M UTC') if m.get('time') else m['date']
        items.append(f'<li class="guide-match"><a href="{match_link(page, m)}">'
                     f'<span class="guide-meta">{escape(LEAGUES[m["league"]][0])} · {escape(when)}</span>'
                     f'<span class="guide-teams">{escape(home)} <span>vs</span> {escape(away)}</span>'
                     f'<span class="guide-rating" aria-label="Replay rating {m["rating"]:.1f} out of 10">{m["rating"]:.1f}</span>'
                     f'{tag_html}</a></li>')
    return '<ul class="guide-matches">' + ''.join(items) + '</ul>'


def page_html(page, title, description, body, season, updated):
    nav = [('/index.html', 'Match browser'), ('/en/', 'Replay guide'),
           ('/en/weekend/', 'Weekend'), ('/en/rankings/', 'Team rankings')]
    navigation = ''.join(link(page, dest, label) if dest != '/index.html' else
                         f'<a href="{escape(relative(page, dest), quote=True)}?lang=en">{label}</a>' for dest, label in nav)
    competitions = ''.join(link(page, league_url(code), name) for code, (name, _) in LEAGUES.items())
    canonical = BASE + page
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} | Rate90</title><meta name="description" content="{escape(description, quote=True)}">
<link rel="canonical" href="{canonical}"><meta property="og:title" content="{escape(title, quote=True)} | Rate90">
<meta property="og:description" content="{escape(description, quote=True)}"><meta property="og:url" content="{canonical}">
<meta name="theme-color" content="#09090a"><link rel="icon" href="{relative(page, '/ui/mark.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="{relative(page, '/ui/replay-guide.css')}"></head>
<body><header class="guide-header"><a class="guide-brand" href="{relative(page, '/index.html')}?lang=en"><span>90</span> Rate<strong>90</strong></a>
<nav aria-label="Replay guides">{navigation}</nav></header>
<main class="guide-main"><h1>{escape(title)}</h1><p class="guide-intro">{escape(description)}</p>
<p class="guide-date">{escape(season)} season · Updated {escape(updated)}</p>{body}
<nav class="guide-leagues" aria-label="Competitions">{competitions}</nav></main>
<footer class="guide-footer">Rate90 · Spoiler-free football replay ratings</footer>
<script defer src="{relative(page, '/ui/analytics.js')}"></script></body></html>\n'''


def generate_pages(index, team_rows):
    as_of, season, matches = rated_season(index)
    updated = as_of.strftime('%d %b %Y')
    teams = {str(t['id']): t for t in team_rows if 'id' in t}
    by_league, by_team = defaultdict(list), defaultdict(list)
    for m in matches:
        by_league[m['league']].append(m)
        for side in ('home', 'away'):
            by_team[m[side]].append(m)
    team_paths = {key: team_url(key, display_name(key, teams)) for key in by_team}
    pages = {}

    def add(path, title, description, body):
        pages[path] = page_html(path, title, description, body, season, updated).encode()

    # The current weekend starts Friday UTC, or the most recent Friday during the week.
    friday = as_of.date() - timedelta(days=(as_of.weekday() - 4) % 7)
    weekend_end = friday + timedelta(days=3)
    weekend = [m for m in matches if friday <= m['at'].date() < weekend_end]
    recent = [m for m in matches if as_of-timedelta(days=7) <= m['at']]
    hub = '/en/'
    add(hub, 'Best football matches to watch without spoilers',
        'Choose a football replay by its watchability rating and match style. Explore the Champions League and Europe’s top five leagues.',
        '<h2>Top matches from the last seven days</h2>' + match_table(hub, recent, teams, 12) +
        '<h2>Find more matches</h2><p>' + link(hub, '/en/weekend/', 'Latest weekend') + ' · ' +
        link(hub, '/en/rankings/', 'Season team rankings') + '</p>')
    w = '/en/weekend/'
    add(w, 'Best football matches from the latest weekend',
        'Spoiler-free replay recommendations across six competitions, ranked by match watchability.',
        f'<h2>{friday:%d %b} – {(weekend_end-timedelta(days=1)):%d %b %Y} (UTC)</h2>' + match_table(w, weekend, teams, 20))

    for code, (name, _) in LEAGUES.items():
        path = league_url(code)
        rows = by_league[code]
        keys = {m[side] for m in rows for side in ('home', 'away')}
        team_links = ''.join(link(path, team_paths[key], display_name(key, teams)) for key in sorted(keys, key=lambda k: display_name(k, teams).casefold()))
        add(path, f'Best {name} matches to watch in {season}',
            f'Find the most watchable {name} replays this season, with match ratings and spoiler-free style tags.',
            f'<h2>Top rated matches · {len(rows)} rated</h2>' + match_table(path, rows, teams) +
            (f'<h2>Teams</h2><nav class="guide-leagues" aria-label="Teams">{team_links}</nav>' if keys else ''))

    for key, rows in by_team.items():
        name, path = display_name(key, teams), team_paths[key]
        mean = sum(m['rating'] for m in rows)/len(rows)
        count = sum(m['rating'] >= 8 for m in rows)
        add(path, f'Best {name} matches to watch in {season}',
            f'Explore {name}’s highest-rated football replays with no final scores or results revealed.',
            f'<h2>Season replays</h2><p class="guide-summary">{len(rows)} rated matches · {mean:.1f} average replay rating · {count} full-match picks</p>' +
            match_table(path, rows, teams))

    path = '/en/rankings/'
    tables = []
    for code, (name, _) in LEAGUES.items():
        if code == 'cl':
            continue
        grouped = defaultdict(list)
        for m in by_league[code]:
            for side in ('home', 'away'):
                grouped[m[side]].append(m['rating'])
        standings = [(key, len(scores), sum(s >= 8 for s in scores)/len(scores), sum(scores)/len(scores))
                     for key, scores in grouped.items() if len(scores) >= 5]
        standings.sort(key=lambda r: (-r[2], -r[3], display_name(r[0], teams).casefold()))
        rows = ''.join(f'<tr><td>{link(path, team_paths[key], display_name(key, teams))}</td><td>{n}</td><td>{share:.0%}</td><td>{avg:.1f}</td></tr>'
                       for key, n, share, avg in standings)
        table = ('<div class="guide-table-wrap"><table><thead><tr><th>Team</th><th>Rated</th><th>Full-match picks</th><th>Avg.</th></tr></thead>'
                 f'<tbody>{rows}</tbody></table></div>' if rows else '<p class="guide-empty">More rated matches are needed.</p>')
        tables.append(f'<h2>{escape(name)}</h2>' + table)
    add(path, 'Football team watchability rankings',
        'Which teams play the most entertaining matches? Compare top-five league teams by the share of rated games scoring at least 8.0 and average replay rating. Minimum five rated league matches.',
        ''.join(tables))

    files = {file_path(path): data for path, data in pages.items()}
    urls = ''.join(f'<url><loc>{escape(BASE + path)}</loc></url>' for path in sorted(pages))
    files['public/sitemap.xml'] = ('<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f'<url><loc>{BASE}/</loc></url>{urls}</urlset>\n').encode()
    files['public/robots.txt'] = f'User-agent: *\nAllow: /\nSitemap: {BASE}/sitemap.xml\n'.encode()
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    data = args.root / 'public/ui/data'
    files = generate_pages(read_asset(data/'collected-index.js'), read_asset(data/'teams.js'))
    for path, contents in files.items():
        file = args.root/path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(contents)
    print(f'Generated {len(files)-2} guide pages and sitemap.')


if __name__ == '__main__':
    main()
