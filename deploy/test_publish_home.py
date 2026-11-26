import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

module = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-home.py'))
pub = importlib.util.module_from_spec(module)
module.loader.exec_module(pub)


def cmd(*args, cwd=None):
    return subprocess.check_output(['git', *args], cwd=cwd, stderr=subprocess.PIPE).decode().strip()


class PublicationTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.app = self.root / 'app'
        self.app.mkdir()
        self.remote = self.root / 'remote.git'
        cmd('init', '-q', '--bare', '-b', 'main', str(self.remote))
        cmd('init', '-q', '-b', 'main', str(self.app))
        cmd('config', 'user.email', 'test@example.invalid', cwd=self.app)
        cmd('config', 'user.name', 'test', cwd=self.app)
        (self.app / 'README').write_text('keep')
        cmd('add', 'README', cwd=self.app)
        cmd('commit', '-qm', 'Initial site', cwd=self.app)
        cmd('push', '-q', str(self.remote), 'main', cwd=self.app)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.publisher = pub.Publisher(self.app, self.state, self.remote.as_uri())
        self.live = ''
        self.publisher.online = lambda digest, seo: digest == self.live
        self.data = self.app / pub.ASSET
        (self.data / 'collected').mkdir(parents=True)
        (self.data / 'teams.js').write_bytes(pub.PREFIX + b'[];\n')
        self.stem = 'collected/2026-11-23-' + '1' * 20
        self.write(1)
        (self.data / (self.stem+'.js')).write_text('day detail')
        (self.data / (self.stem+'-preview.js')).write_text('day preview')
        (self.app / '.env.local').write_text('private')
        (self.data / 'collected/stale.js').write_text('unused')
        self.head = lambda: cmd('--git-dir', str(self.remote), 'rev-parse', 'main')

    def write(self, generation, rule='1'):
        index = dict(ruleVersion=rule, updatedAt=f'2026-11-{generation:02}T00:00:00Z',
                     fixtures=[{'id':'1'}], days={'2026-11-23':dict(file=self.stem, previewFile=self.stem+'-preview')})
        raw = pub.PREFIX + json.dumps(index).encode() + b';\n'
        (self.data/pub.INDEX).write_bytes(raw)
        return pub.git_blob(raw)

    def test_atomic_push_receipt_and_retry(self):
        self.publisher.check_access()
        old = self.head()
        self.assertFalse(self.publisher.deploy())
        published = self.head()
        self.assertNotEqual(old, published)
        tree = cmd('--git-dir', str(self.remote), 'ls-tree', '-r', '--name-only', 'main').splitlines()
        seo = pub.generate_pages(pub.parse_index((self.data/pub.INDEX).read_bytes()), [])
        self.assertEqual(set(tree), {'README', pub.ASSET+pub.INDEX, pub.ASSET+self.stem+'.js',
                                      pub.ASSET+self.stem+'-preview.js', *seo})
        self.assertFalse(self.publisher.deploy())
        self.assertEqual(self.head(), published)
        receipt = json.loads(self.publisher.receipt.read_text())
        self.publisher.record({**receipt, 'retryAfter': 0})
        self.assertFalse(self.publisher.deploy())
        retried = self.head()
        self.assertNotEqual(retried, published)
        self.live = self.write(1)
        self.assertTrue(self.publisher.deploy())
        self.assertEqual(self.head(), retried)
        self.publisher.online = lambda *_: self.fail('unchanged snapshot contacted production')
        self.assertTrue(self.publisher.deploy())

    def test_guides_include_only_rated_completed_matches_and_generate_stable_links(self):
        index = {'updatedAt':'2026-11-25T10:00:00Z','fixtures':[
            {'id':str(i),'league':'pl','home':'1','away':'2','status':'finished','date':'2026-11-22',
             'time':'18:00','rating':8.5,'round':11,'home_score':99,'away_score':88,
             'styleIds':['end-to-end']} for i in range(5)] + [
            {'id':'future','league':'pl','home':'1','away':'2','status':'scheduled','date':'2026-11-22','rating':10},
            {'id':'old','league':'pl','home':'1','away':'2','status':'finished','date':'2026-11-22','rating':9,'replacedBy':'2'}]}
        teams=[{'id':'1','en':'Team & One'},{'id':'2','en':'Team Two'}]
        pages=pub.generate_pages(index,teams)
        self.assertIn(b'Team &amp; One', pages['public/en/weekend/index.html'])
        self.assertIn(b'End-to-end', pages['public/en/weekend/index.html'])
        self.assertIn(b'100%', pages['public/en/rankings/index.html'])
        self.assertIn(b'lang=en', pages['public/en/teams/team-one-1/index.html'])
        self.assertIn(b'https://r90.liderrr.cc/en/teams/team-one-1/', pages['public/sitemap.xml'])
        for contents in pages.values():
            self.assertNotIn(b'99-88',contents)
            self.assertNotIn(b'match=future',contents)
            self.assertNotIn(b'match=old',contents)

    def test_prematch_only_update(self):
        self.publisher.deploy()
        head = self.head()
        index = pub.parse_index((self.data / pub.INDEX).read_bytes())
        payload = b'{"rounds":[],"picks":{}}'
        name = 'prematch-' + hashlib.sha256(payload).hexdigest()[:20]
        index['prematchFile'] = name
        (self.data / pub.INDEX).write_bytes(pub.PREFIX + json.dumps(index).encode() + b';\n')
        asset = self.data / (name + '.js')
        asset.write_bytes(pub.PREFIX + b'{};\n')
        with self.assertRaises(ValueError):
            self.publisher.deploy()
        self.assertEqual(self.head(), head)
        asset.write_bytes(pub.PREFIX + payload + b';\n')
        self.publisher.deploy()
        self.assertEqual(cmd('--git-dir', str(self.remote), 'show', 'main:' + pub.ASSET + asset.name),
                         asset.read_text().strip())

    def test_missing_data_and_stale_seed_do_not_replace_main(self):
        self.write(3)
        self.publisher.deploy()
        head = self.head()
        self.write(2)
        with self.assertRaises(ValueError):
            self.publisher.deploy()
        self.write(4)
        (self.data/(self.stem+'.js')).unlink()
        with self.assertRaises(FileNotFoundError):
            self.publisher.deploy()
        self.assertEqual(self.head(), head)
        (self.data/(self.stem+'.js')).write_text('day detail')
        self.publisher.deploy()
        self.assertNotEqual(self.head(), head)

    def test_scoring_upgrade_accepts_current_data_and_rejects_rollback(self):
        self.write(3, 'rate90-1.1.0')
        self.publisher.deploy()
        self.write(2, 'rate90-1.2.0')
        with self.assertRaises(ValueError):
            self.publisher.deploy()
        self.write(3, 'rate90-1.2.0')
        self.publisher.deploy()
        head = self.head()
        self.write(4, 'rate90-1.1.0')
        with self.assertRaises(ValueError):
            self.publisher.deploy()
        self.assertEqual(self.head(), head)

    def test_non_fast_forward_keeps_the_other_commit_and_retries(self):
        old = self.head()
        original = self.publisher.git
        def race(*args, **kwargs):
            if args[0] == 'push' and self.head() == old:
                (self.app/'README').write_text('concurrent edit')
                cmd('commit', '-qam', 'Concurrent change', cwd=self.app)
                cmd('push', '-q', str(self.remote), 'main', cwd=self.app)
            return original(*args, **kwargs)
        self.publisher.git = race
        with self.assertRaises(RuntimeError):
            self.publisher.deploy()
        self.assertFalse(self.publisher.receipt.exists())
        self.assertFalse(self.publisher.deploy())
        self.assertEqual(cmd('--git-dir', str(self.remote), 'show', 'main:README'), 'concurrent edit')


if __name__ == '__main__':
    unittest.main()
