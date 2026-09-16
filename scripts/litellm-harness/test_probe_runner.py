import json
from pathlib import Path
import py_compile
import subprocess
import sys
import tempfile
import unittest


RUNNER = Path(__file__).with_name('probe_runner.py')


class ProbeRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir()
        self.probe = self.root / 'probe.py'
        self.probe.write_text('import json,litellm;print(json.dumps([{ "pass": litellm.value == 2 }]))')

    def package(self):
        package = self.workspace / 'litellm'
        package.mkdir()
        source = package / '__init__.py'
        source.write_text('value = 2\n')
        return source

    def run_probe(self):
        return subprocess.run([sys.executable, '-B', str(RUNNER), str(self.workspace), str(self.probe)], text=True, capture_output=True)

    def test_rejects_reference_tests_directory(self):
        result = self.run_probe()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not only reference tests', result.stderr)

    def test_validates_origin_and_does_not_write_bytecode(self):
        self.package()
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertTrue(data['passed'])
        self.assertEqual(data['imports']['moduleCount'], 1)
        self.assertEqual(list(self.workspace.rglob('*.pyc')), [])

    def test_ignores_valid_but_stale_unchecked_bytecode(self):
        source = self.package()
        source.write_text('value = 1\n')
        py_compile.compile(str(source), invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
        source.write_text('value = 2\n')
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['passed'])

    def test_failure_verdict_is_not_execution_error(self):
        self.package().write_text('value = 0\n')
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads(result.stdout)['passed'])

    def test_rejects_nonboolean_verdict(self):
        self.package()
        self.probe.write_text('print(\'[ { "pass": "false" } ]\')')
        result = self.run_probe()
        self.assertNotEqual(result.returncode, 0)

    def test_rejects_submodule_outside_workspace(self):
        self.package()
        outside = self.root / 'outside.py'
        outside.write_text('value=1')
        (self.workspace / 'litellm' / 'outside.py').symlink_to(outside)
        self.probe.write_text('import litellm.outside;print(\'[ { "pass": true } ]\')')
        result = self.run_probe()
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
