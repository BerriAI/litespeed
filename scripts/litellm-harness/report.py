"""Export allowlisted measurements; raw transcripts and source snapshots remain private."""
import json
import os
from pathlib import Path
import statistics
import sys

root=Path(os.environ['LITELLM_CAMPAIGN_DIR'])
destination=Path(sys.argv[1])
destination.mkdir(parents=True,exist_ok=True)
analysis=json.loads((root/'analysis.json').read_text())
fields=['run','id','kind','label','promptRevision','snapshotRevision','taskPrompt','harnessVersion','harnessSha256','contextWindow','evaluationProtocol','effort','timeoutSeconds','compactions','seconds','timedOut','requests','reportedRequests','inputTokens','cachedTokens','outputTokens','computedUsd','acceptance','firstEditRound','exactRepeatedCalls','readCharacters','toolCounts']
runs=[{key:run.get(key) for key in fields} for run in analysis]
cases=json.loads((root/'cases.json').read_text())
tasks=[{key:case.get(key) for key in ['id','split','base','reference','prompt_revision','prompt','input_provenance','test_nodes','excluded_reference_nodes','oracle_note']} for case in cases]
ledger=json.loads((root/'spend.json').read_text())
priced=[record for record in ledger['records'] if isinstance(record.get('usage'),dict) and isinstance(record['usage'].get('completion_tokens'),(int,float))]
money={'ceilingUsd':ledger['limitUsd'],'committedUsd':ledger['committedUsd'],'pricedUsd':sum(record['chargedUsd'] for record in priced),'pricedRequests':len(priced),'admittedRequests':len(ledger['records']),'unpricedRequests':len(ledger['records'])-len(priced),'astraUsd':None}
(destination/'litellm-harness-results.json').write_text(json.dumps({'runs':runs,'tasks':tasks,'gatewayAccounting':money},indent=2)+'\n')
primary=[r for r in runs if r['label'].startswith('comparison-') and r['evaluationProtocol']==3 and r['snapshotRevision']==2]
lines=['# LiteLLM harness campaign results','','This is a retrospective repository-specific replay, using the same curated requirements for each solver. It is not a blind study or a production result. See the [protocol](../scripts/litellm-harness/README.md) and [machine-readable measurements](litellm-harness-results.json).','','## Recorded comparison','','All protocol-3 runs with a `comparison-` label are included below, including failures and timeouts. Protocol 3 uses the advertised DeepSeek context window and an allowlisted subprocess environment. Earlier baseline attempts remain in the development record. A passing row means all selected behavioral checks passed. A timeout can leave a passing partial patch; completion status is reported separately.','','| Task | Route | Trial | Checks passed | Seconds | Timed out | DeepSeek priced tokens, USD |','|---|---|---|---|---:|---|---:|']
def verdict(r):
    a=r.get('acceptance')
    if a is None:return 'Unscored'
    if a.get('timeout'):return 'Scoring timeout'
    return ('Pass' if a.get('passed') else 'Fail')+f" ({a.get('tests',0)-a.get('failures',0)-a.get('errors',0)-a.get('skipped',0)}/{a.get('tests',0)})"
for r in primary:
    route='Codex / Astra' if r['kind']=='codex' else f"LiteLLM harness {r.get('harnessVersion')} / DeepSeek"
    cost='Unavailable' if r['computedUsd'] is None else f"${r['computedUsd']:.4f}"
    lines.append(f"| {r['id']} | {route} | {r['label']} | {verdict(r)} | {r['seconds']:.1f} | {r['timedOut']} | {cost} |")
lines+=['','## Aggregate recorded runs','']
for kind in ['litellm-specific','codex']:
    selected=[r for r in primary if r['kind']==kind]
    if selected:
        accepted=sum(bool((r['acceptance'] or {}).get('passed')) and not r['timedOut'] for r in selected)
        lines.append(f"- {kind}: {accepted}/{len(selected)} completed runs pass all selected checks; median elapsed {statistics.median(r['seconds'] for r in selected):.1f} seconds. Repetitions of a task are correlated observations.")
lines+=['','## Development record','','These exploratory runs informed changes and task corrections. Do not treat them as held-out evidence or compare differing task revisions as an architecture improvement.','','| Run | Task revision | Result | Seconds | Requests |','|---|---:|---|---:|---:|']
for r in runs:
    if r not in primary:lines.append(f"| {r['run']} | {r['promptRevision']} | {verdict(r)} | {r['seconds']:.1f} | {r['requests'] if r['requests'] is not None else 'Unavailable'} |")
lines+=['','## Spending and limits','',f"The local gateway admitted {money['admittedRequests']} requests. Usage/header-priced charges total **${money['pricedUsd']:.4f}**. The ledger commits **${money['committedUsd']:.4f}**, including full conservative reservations for {money['unpricedRequests']} unpriced or in-flight requests, against a **${money['ceilingUsd']:.2f}** ceiling. Codex/Astra dollar charges are unavailable and are not included in that ceiling.",'','The study uses reconstructed historical source with a shared dependency environment and focused behavioral tests. The curator inspected references to validate requirements and remove helper-name coupling. Two tasks did not qualify because of reference/environment problems. Test tasks were not used for candidate iteration before its comparison; they are not a chronological future-PR split. No result establishes a universal quality or latency advantage.']
(destination/'litellm-harness-results.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'runs':len(runs),'comparisonRuns':len(primary),'gatewayAccounting':money}))
