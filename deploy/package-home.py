"""Write a clean POSIX tar stream for the home Linux installer."""
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tarfile
import tempfile

root, output = Path(__file__).resolve().parent.parent, Path(sys.argv[1])
archive_update = sys.argv[2:] == ['--archive-update']
data = root / 'public/ui/data'
prefix = 'document.currentScript.rate90Data = '
index = json.loads((data / 'process-ratings.js').read_text().strip()[len(prefix):-1])
assets = {'fixtures', 'teams', 'process-ratings'}
for entry in index['days'].values():
    for key in ['file', 'previewFile']:
        if item := entry.get(key):
            if not re.fullmatch(r'rounds/[\w-]+', item):
                raise ValueError('无效的归档路径')
            assets.add(item)

with tarfile.open(output, 'w:gz', format=tarfile.USTAR_FORMAT) as tar:
    def add(name, contents, mode=0o600):
        entry = tarfile.TarInfo(name)
        entry.mode = mode
        entry.size = len(contents)
        tar.addfile(entry, io.BytesIO(contents))
    for dest, source in {'install.sh': 'home-collector-install.sh', 'upgrade.sh': 'home-collector-upgrade.sh',
                         'home-service.sh': 'home-service.sh', 'publish-home.py': 'publish-home.py',
                         'github-known-hosts':'github-known-hosts'}.items():
        add(dest, (root/'deploy'/source).read_bytes())
    files = [root/'package.json', root/'scripts/collect.mjs', root/'scripts/pull-bsd-local.mjs', root/'data/bsd-sample.json']
    files += [p for p in (root/'server').glob('*.mjs') if not p.name.endswith('.test.mjs')]
    files += [data/(name+'.js') for name in sorted(assets)]
    identity = hashlib.sha256()
    for path in sorted(files):
        name = str(path.relative_to(root))
        content = path.read_bytes()
        add('release/'+name, content)
        identity.update(name.encode() + b'\0' + hashlib.sha256(content).digest())
    add('release/REVISION', ('pkg-' + identity.hexdigest() + '\n').encode())
    if archive_update:
        add('bsd-seed.py', (root/'deploy/bsd-seed.py').read_bytes())
        add('archive-timer.sh', (root/'deploy/archive-timer.sh').read_bytes())
        with tempfile.TemporaryDirectory() as tmp:
            snapshot = Path(tmp)/'bsd-raw.sqlite'
            subprocess.run([sys.executable, str(root/'deploy/bsd-seed.py'), 'snapshot',
                            str(root/'data/collector/bsd-raw.sqlite'), str(snapshot)], check=True)
            tar.add(snapshot, arcname='bsd-raw.sqlite', recursive=False)
        sys.exit(0)
    env = root/'.env.local'
    token = [line for line in env.read_bytes().splitlines() if re.match(rb'^(?:export\s+)?BSD_API_TOKEN=.+',line)] if env.is_file() else []
    if token: add('bsd.env', token[-1]+b'\n')
    seed = root/'dist/rate90-linux-seed.tar.gz'
    if seed.is_file():
        add('seed.tar.gz', seed.read_bytes())
    else:
        db = root/'data/collector/rate90.sqlite'
        if db.is_file():
            with tempfile.TemporaryDirectory() as tmp:
                snapshot = Path(tmp)/'rate90.sqlite'
                with sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True) as src, sqlite3.connect(snapshot) as dest:
                    src.backup(dest)
                blob=io.BytesIO()
                with tarfile.open(fileobj=blob,mode='w:gz',format=tarfile.USTAR_FORMAT) as nested:
                    nested.add(snapshot,arcname='rate90.sqlite',recursive=False)
                add('seed.tar.gz',blob.getvalue())
