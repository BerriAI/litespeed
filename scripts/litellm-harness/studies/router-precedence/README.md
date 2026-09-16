# Candidate IDs can pass tests while disagreeing with routing

The recorded control candidate passed the original one-case acceptance selection. A training critic identified a possible mismatch between unioned candidate IDs and the router's ordered deployment selection. [This five-case probe](probe.py) confirms two mismatches through the existing `get_available_deployment` entrypoint, without making provider requests.

| Implementation | Supplemental checks satisfied |
|---|---:|
| Starting snapshot | 3/5 |
| Recorded candidate, original acceptance passing | 3/5 |
| Human reference | 5/5 |

The candidate fixes unprefixed global wildcard names but includes a team wildcard when the global wildcard wins. It also introduces a regression: a named team deployment should shadow the global wildcard, but the candidate includes both. Its new test asserts the incorrect union. Existing source comments and `get_model_list` also describe or perform unions; those are poor substitutes for checking actual request selection.

[Qualification](qualification.json) includes expected candidates, observed candidates and the selected deployment. [Task metadata](task.json) identifies the snapshots. Apply [the recorded candidate patch](observed-candidate.patch) to a separate base checkout, then run the probe with `PYTHONPATH` pointing to that checkout, `LITELLM_LOCAL_MODEL_COST_MAP=True`, and `PYTHON_DOTENV_DISABLED=1`. Its per-case `pass` booleans are the verdict, not its process exit.

This is supplemental training evidence discovered after the run. It does not rewrite original acceptance results or the frozen feature-removal experiment. These five cases do not prove complete router correctness.

A [posthoc audit](historical-audit.json) of all ten completed protocol-6 router-candidate replays available at this checkpoint found ten original acceptance passes and zero complete supplemental passes. These include different training variants and are not ten independent tasks.
