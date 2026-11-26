#!/usr/bin/env python3
"""Publish a completed Rate90 snapshot to the site's existing production branch."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from seo_pages import generate_pages, read_asset

ASSET = 'public/ui/data/'
INDEX = 'collected-index.js'
REMOTE = 'git@github.com:liiider/Rate90.git'
SITE = 'https://r90.liderrr.cc/ui/data/collected-index.js'
PREFIX = b'document.currentScript.rate90Data = '
DAY_FILE = re.compile(r'collected/(\d{4}-\d{2}-\d{2})-([0-9a-f]{20})')


def git_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def parse_index(data):
    payload = data.strip()
    if not payload.startswith(PREFIX) or not payload.endswith(b';'):
        raise ValueError('无效的评分索引')
    result = json.loads(payload[len(PREFIX):-1])
    if not result.get('fixtures') or not result.get('days') or not result.get('updatedAt'):
        raise ValueError('评分快照不完整')
    return result


def active_files(index):
    if 'prematchFile' in index:
        stem = index['prematchFile']
        if not re.fullmatch(r'prematch-[0-9a-f]{20}', stem):
            raise ValueError('无效的赛前快照文件名')
        yield stem + '.js'
    for day, entry in index['days'].items():
        stem = entry['file']
        match = DAY_FILE.fullmatch(stem)
        if not match or match[1] != day or entry['previewFile'] != stem + '-preview':
            raise ValueError('无效的比赛日文件名')
        yield stem + '.js'
        yield stem + '-preview.js'


class Publisher:
    def __init__(self, app, state, remote=REMOTE, site=SITE):
        self.data = app / ASSET
        self.state = state
        self.cache = state / 'git'
        self.remote = remote
        self.site = site
        self.receipt = state / 'receipt.json'
        self.env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_AUTHOR_NAME='liiider',
                        GIT_AUTHOR_EMAIL='223864697+liiider@users.noreply.github.com',
                        GIT_COMMITTER_NAME='Rate90 publisher',
                        GIT_COMMITTER_EMAIL='223864697+liiider@users.noreply.github.com')
        self.env['GIT_SSH_COMMAND'] = shlex.join(['ssh', '-i', str(state / 'id_ed25519'),
            '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'ConnectTimeout=12', '-o', 'UserKnownHostsFile=' + str(state / 'known_hosts')])

    def git(self, *args, data=None):
        p = subprocess.run(['git', '--git-dir', str(self.cache), *args], input=data,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.env, timeout=150)
        if p.returncode:
            raise RuntimeError(p.stderr.decode(errors='replace').strip() or 'Git 发布失败')
        return p.stdout

    def head(self):
        if not self.cache.exists():
            self.git('init', '--bare', '--quiet')
        # Fetch trees and only materialize blobs actually used by the publisher.
        self.git('config', 'remote.origin.url', self.remote)
        self.git('config', 'remote.origin.promisor', 'true')
        self.git('config', 'remote.origin.partialclonefilter', 'blob:none')
        self.git('fetch', '--quiet', '--depth=1', '--filter=blob:none', 'origin', 'refs/heads/main')
        return self.git('rev-parse', 'FETCH_HEAD').decode().strip()

    def check_access(self):
        head = self.head()
        self.git('push', '--dry-run', 'origin', head + ':refs/heads/main')

    def record(self, value):
        tmp = self.receipt.with_suffix('.tmp')
        tmp.write_text(json.dumps(value))
        tmp.replace(self.receipt)

    def online(self, digest, seo_files):
        base = self.site.rsplit('/ui/data/', 1)[0]
        checks = [(self.site, digest), (base + '/sitemap.xml', git_blob(seo_files['public/sitemap.xml'])),
                  (base + '/en/', git_blob(seo_files['public/en/index.html']))]
        for url, expected in checks:
            request = Request(url + '?r=' + expected[:14], headers={'Cache-Control': 'no-cache'})
            try:
                with urlopen(request, timeout=20) as response:
                    if git_blob(response.read()) != expected:
                        return False
            except HTTPError as e:
                if e.code == 404:
                    return False
                raise
        return True

    def deploy(self):
        data = (self.data / INDEX).read_bytes()
        digest = git_blob(data)
        index = parse_index(data)
        seo_files = generate_pages(index, read_asset(self.data / 'teams.js'))
        seo = hashlib.sha256(''.join(path + git_blob(contents) for path, contents in sorted(seo_files.items())).encode()).hexdigest()
        last = json.loads(self.receipt.read_text()) if self.receipt.exists() else {}
        if last.get('live') == digest and last.get('seo') == seo:
            return True
        now = time.time()
        waiting = last.get('pending') == digest and last.get('seo') == seo
        if waiting:
            if self.online(digest, seo_files):
                self.record({'live': digest, 'seo': seo})
                print('RATE90_LIVE', digest[:12], flush=True)
                return True
            if now < last['retryAfter']:
                return False

        head = self.head()
        entries = self.git('ls-tree', '-r', head, '--', ASSET, 'public/en/', 'public/sitemap.xml', 'public/robots.txt').splitlines()
        existing = {}
        for entry in entries:
            metadata, name = entry.split(b'\t', 1)
            existing[name.decode()] = metadata.split()[2].decode()
        remote_digest = existing.get(ASSET + INDEX)
        changes = []
        def stage_file(path, content):
            sha = git_blob(content)
            if existing.get(path) == sha:
                return
            stored = self.git('hash-object', '-w', '--stdin', data=content).decode().strip()
            if stored != sha:
                raise ValueError('快照传输校验失败')
            changes.append(f'100644 {sha}\t{path}\n')

        if remote_digest != digest:
            if remote_digest:
                previous = parse_index(self.git('cat-file', 'blob', remote_digest))
                old_rule, new_rule = previous.get('ruleVersion'), index.get('ruleVersion')
                # Authorize this release's scoring migration, keeping downgrade and data checks.
                if (index['updatedAt'] < previous['updatedAt'] or
                    (old_rule != new_rule and (old_rule, new_rule) != ('rate90-1.1.0', 'rate90-1.2.0')) or
                    not {f['id'] for f in previous['fixtures']}.issubset(f['id'] for f in index['fixtures'])):
                    raise ValueError('服务器快照未追上正式站的版本、赛程或采集时间，等待下一次采集')
            for name in [*active_files(index), INDEX]:
                content = data if name == INDEX else (self.data / name).read_bytes()
                path = ASSET + name
                if name.startswith('prematch-') and (not content.startswith(PREFIX) or not content.endswith(b';\n') or
                        hashlib.sha256(content[len(PREFIX):-2]).hexdigest()[:20] != name[9:-3]):
                    raise ValueError('赛前快照校验失败')
                stage_file(path, content)
        for path, content in seo_files.items():
            stage_file(path, content)
        for path in existing:
            if re.fullmatch(r'public/en/teams/[^/]+/index\.html', path) and path not in seo_files:
                changes.append(f'0 {"0" * 40}\t{path}\n')
        if not changes and self.online(digest, seo_files):
            self.record({'live': digest, 'seo': seo})
            print('RATE90_LIVE', digest[:12], flush=True)
            return True
        # Allow the triggering deployment to finish before issuing a deployment retry.
        delay = 1200
        if changes or waiting:
            self.git('read-tree', head)
            self.git('update-index', '--index-info', data=''.join(changes).encode())
            tree = self.git('write-tree').decode().strip()
            commit = self.git('commit-tree', tree, '-p', head, '-m',
                              'Publish Rate90 match data ' + digest[:12]).decode().strip()
            if (self.data / INDEX).read_bytes() != data:
                return False
            self.git('push', '--quiet', self.remote, commit + ':refs/heads/main')
            print('RATE90_PUSHED', commit[:12], flush=True)
            if waiting:
                delay = min(21600, max(delay, last.get('delay', delay) * 2))
        self.record({'pending': digest, 'seo': seo, 'retryAfter': now + delay, 'delay': delay})
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--check-access', action='store_true')
    args = parser.parse_args()
    state = Path.home() / '.local/share/rate90-publish'
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    publisher = Publisher(Path.home() / 'Rate90', state)
    if args.check_access:
        with tempfile.TemporaryDirectory(dir=state) as check:
            publisher.cache = Path(check) / 'git'
            publisher.check_access()
        return
    with (state / 'lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        script_revision = Path(__file__).stat().st_ino
        signature = None
        retry = 0
        while True:
            try:
                stat = (publisher.data / INDEX).stat()
                current = (stat.st_ino, stat.st_mtime_ns, stat.st_size)
                if current != signature or time.monotonic() >= retry:
                    signature = current
                    complete = publisher.deploy()
                    retry = float('inf') if complete else time.monotonic() + 60
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
                if not args.watch:
                    raise
                print('RATE90_PUBLISH_RETRY', e, file=sys.stderr, flush=True)
                retry = time.monotonic() + 60
            if not args.watch:
                return
            time.sleep(5)
            if Path(__file__).stat().st_ino != script_revision:
                return


if __name__ == '__main__':
    main()
