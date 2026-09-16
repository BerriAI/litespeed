"""Explicit incident identities; never infer exclusions from a patch's score."""
import json
from pathlib import Path


def incident_runs():
    record = Path(__file__).parent / 'studies' / 'host-sleep-transport' / 'incident.json'
    return {row['label']: 'host-sleep-transport' for row in json.loads(record.read_text())['affectedLabels']}
