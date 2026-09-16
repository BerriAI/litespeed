"""Run a supplemental probe against an explicit snapshot, without bytecode reuse.

This is host-side evaluation infrastructure, not a solver tool. The probe prints
a JSON list of checks with boolean `pass` fields. This runner exits nonzero for
execution failures; inspect `passed` for the behavioral verdict.
"""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile


def run_probe(workspace, probe):
    workspace = Path(workspace).resolve(strict=True)
    probe = Path(probe).resolve(strict=True)
    package = workspace / 'litellm' / '__init__.py'
    if not package.is_file():
        raise ValueError('The selected workspace must contain the LiteLLM package, not only reference tests.')
    if any(name == 'litellm' or name.startswith('litellm.') for name in sys.modules):
        raise ValueError('Run each probe in a fresh interpreter.')
    previous_path, previous_cwd = sys.path[:], Path.cwd()
    previous_prefix, previous_write = sys.pycache_prefix, sys.dont_write_bytecode
    try:
        with tempfile.TemporaryDirectory(prefix='litellm-probe-cache-') as cache:
            # -B alone disables writes but can still read stale adjacent .pyc.
            sys.pycache_prefix = cache
            sys.dont_write_bytecode = True
            sys.path.insert(0, str(workspace))
            os.chdir(workspace)
            import litellm
            if Path(litellm.__file__).resolve() != package.resolve():
                raise ValueError('LiteLLM was imported from outside the selected snapshot.')
            captured = io.StringIO()
            with contextlib.redirect_stdout(captured):
                runpy.run_path(str(probe), run_name='__main__')
            count = 0
            for name, module in list(sys.modules.items()):
                if (name == 'litellm' or name.startswith('litellm.')) and getattr(module, '__file__', None):
                    Path(module.__file__).resolve().relative_to(workspace)
                    count += 1
            rows = json.loads(captured.getvalue().splitlines()[-1])
            if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) or type(row.get('pass')) is not bool for row in rows):
                raise ValueError('Probe must print a nonempty JSON list with boolean pass fields.')
            return {'rows': rows, 'passed': all(row['pass'] for row in rows),
                    'imports': {'packageOrigin': 'litellm/__init__.py',
                                'allLiteLLMModulesWithinWorkspace': True, 'moduleCount': count},
                    'bytecodePolicy': 'fresh cache path; reads from adjacent caches and all writes disabled'}
    finally:
        sys.path[:] = previous_path
        os.chdir(previous_cwd)
        sys.pycache_prefix, sys.dont_write_bytecode = previous_prefix, previous_write


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path)
    parser.add_argument('probe', type=Path)
    args = parser.parse_args()
    os.environ['LITELLM_LOCAL_MODEL_COST_MAP'] = 'True'
    os.environ['PYTHON_DOTENV_DISABLED'] = '1'
    print(json.dumps(run_probe(args.workspace, args.probe), indent=2))
