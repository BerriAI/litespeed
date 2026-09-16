import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from fixtures import fixture_arguments, fixture_profile_hash, verify_fixtures


class FixtureTests(unittest.TestCase):
    def test_only_explicit_repository_fixtures_can_be_enabled(self):
        self.assertEqual(fixture_arguments({}), [])
        for value in [['../conftest'], ['external.plugin'], 'tests.local.conftest', [[]]]:
            with self.assertRaises(ValueError):
                fixture_arguments({'fixture_plugins': value})
        with self.assertRaises(ValueError):
            fixture_arguments({'fixture_plugins': ['tests.local.conftest'] * 2})

    def test_changed_fixture_invalidates_qualification_profile(self):
        plugin = 'tests.local.conftest'
        original = b'import pytest\n'
        case = {'fixture_plugins': [plugin], 'fixture_hashes': {plugin: hashlib.sha256(original).hexdigest()}}
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'tests/local/conftest.py'
            source.parent.mkdir(parents=True)
            source.write_bytes(original)
            verify_fixtures(case, root)
            previous = fixture_profile_hash(case)
            source.write_text('changed\n')
            with self.assertRaises(ValueError):
                verify_fixtures(case, root)
            case['fixture_hashes'][plugin] = hashlib.sha256(source.read_bytes()).hexdigest()
            self.assertNotEqual(previous, fixture_profile_hash(case))
            verify_fixtures(case, root)


if __name__ == '__main__':
    unittest.main()
