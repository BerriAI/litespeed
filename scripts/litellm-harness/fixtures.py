"""Explicit, pre-existing repository fixtures for otherwise isolated pytest runs."""
import hashlib
import json
from pathlib import Path
import re


def fixture_arguments(case):
    plugins = case.get('fixture_plugins', [])
    if not isinstance(plugins, list) or any(not isinstance(p, str) or not re.fullmatch(r'tests(?:\.[A-Za-z_]\w*)+\.conftest', p) for p in plugins):
        raise ValueError('Use explicit repository test conftest modules as fixture plugins.')
    if len(set(plugins)) != len(plugins):
        raise ValueError('Fixture plugins must be a unique list.')
    return [argument for plugin in plugins for argument in ['-p', plugin]]


def fixture_profile_hash(case):
    fixture_arguments(case)
    payload = [case.get('fixture_plugins', []), sorted(case.get('fixture_hashes', {}).items())]
    return hashlib.sha256(json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def verify_fixtures(case, workspace):
    fixture_arguments(case)
    root = Path(workspace).resolve()
    plugins = case.get('fixture_plugins', [])
    if set(case.get('fixture_hashes', {})) != set(plugins):
        raise ValueError('Capture every declared fixture before qualification.')
    for plugin in plugins:
        source = (root / (plugin.replace('.', '/') + '.py')).resolve()
        if not source.is_relative_to(root) or hashlib.sha256(source.read_bytes()).hexdigest() != case['fixture_hashes'][plugin]:
            raise ValueError('The fixture source changed; requalify the task.')
