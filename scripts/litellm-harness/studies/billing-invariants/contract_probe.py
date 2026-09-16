"""Prospectively combine two frozen billing diagnostics for the new study.

Earlier studies and their oracles remain unchanged. The model does not receive
this probe. Run against an explicit snapshot through the shared probe runner.
"""
import contextlib
import io
import json
from pathlib import Path
import runpy

source = Path(__file__).resolve().parent.parent / 'multi-module-development'
rows = []
for name, filename, count in [('representation', 'representation_probe.py', 7),
                              ('public-path', 'public_path_probe.py', 5)]:
    captured = io.StringIO()
    with contextlib.redirect_stdout(captured):
        runpy.run_path(str(source / filename), run_name='__main__')
    checks = json.loads(captured.getvalue().splitlines()[-1])
    if len(checks) != count:
        raise ValueError('A frozen component probe changed its check count.')
    rows.extend({**check, 'name': name + '/' + check['name']} for check in checks)
print(json.dumps(rows))
