# Frozen feature-removal study

**Infrastructure interruption:** 95 unaffected evaluated allocations; 25 allocations affected by the [host-sleep/transport incident](../host-sleep-transport/README.md). Original scores remain in `variants` and `trials`; `qualityEligibleVariants` and paired comparisons exclude every incident allocation regardless of score. No replacements have been substituted. Paid admission is paused.

This is development evidence, not a held-out comparison. The [plan](plan.json)
was recorded before the 160 solver trials: 16 tasks, five variants and two
attempts per variant/task. It preserves the seeded launch order. Three shared
solver slots and one grader limit host load; individual trials have 900 seconds
and request Medium reasoning from `fireworks_ai/deepseek-v4p1-flash`.

## Reconstruct the inputs

The two catalogs contain the exact solver requirements and selected test names.
Use each with `LITELLM_CASE_CATALOG` and a separate `LITELLM_CAMPAIGN_DIR` as
described in the [workbench instructions](../../README.md). The `original`
catalog corresponds to dataset `""` in the plan. The `training2` catalog is the
second dataset. The [qualification record](qualification.json) preserves the
failing-base/passing-reference checks; rerun qualification in your environment.
Test counts include parameterized cases. Requirements are retrospective and
curated from public changes, not original pre-merge issues.

Every variant starts at commit
`f75ab327c649cec9719ac03847f171854d2e32ae`, which is in this PR's history.
Create a separate worktree at that commit, then apply the named patch from the
plan. `control` has no patch. Patch SHA-256 and the resulting runner/harness
source hashes are recorded in the plan; each patch was checked against that
base. Install dependencies from its lockfile. Commit the reconstructed source
and record your actual commit before starting a run. The original experiment
commit IDs identify recorded results; replay does not require those private
branches to remain accessible.

Use the current workbench's `batch.py` to launch the frozen runtime paths, with
one shared lock directory and the same capacity for both datasets. Use fresh
labels for new attempts and retain interrupted allocations. For `study.py`,
create a local copy of the plan with your reconstructed commit IDs and labels;
do not overwrite the original plan or mix new runs into its results.

## Interpretation constraints

- The study is still running. Do not choose a winner from whichever trials
  finished first. Compare complete repeated task pairs.
- The Bedrock session-tags oracle includes exact tuple representation and error
  wording. Its original host note incorrectly claimed both were supplied to
  the solver: only the tuple requirement was explicit. Six checks require an
  unstated error-message substring. The catalog retains the recorded input and
  metadata for audit; those wording failures are not six semantic defects.
  A later [tag-order audit](../bedrock-tag-order/README.md) found a second
  contradiction: the prompt asks for sorted tags at direct assume-role paths,
  while four reference tests require the caller's unsorted sequence. A correct
  permutation must not be described as missing tags from those failures alone.
- The router-strategy oracle includes a test calling a new private helper by
  name. Keep that coupling separate from direct-entrypoint behavior failures.
  Its frozen generic metadata incorrectly says new private-helper tests were
  excluded; the recorded node list actually retains this check. Future catalog
  generation no longer makes that unsupported default claim. Frozen inputs and
  scores remain unchanged.
- Removing a guide is a test of these particular learned guides, not proof
  that repository memory in general helps or hurts.
- Mid-study, the public batch scheduler gained FIFO admission after its older
  polling loop starved queued experiments. Frozen solver sources and the
  three-slot capacity did not change. Queued time is outside recorded solver
  duration; desktop wall times remain observational.
- Reserved evaluation catalogs and outcomes are deliberately absent while
  candidate selection is ongoing. They are not inputs to this study.

## Metering-gateway outage

The [critic scheduling record](critic-scheduling.json) also distinguishes solver slots from optional model critiques. Earlier sequential windowed critiques could issue a fourth model request alongside three solvers. Remaining critiques now use the same shared queue; the change interrupted no paid request and preserves all completed syntheses. The three-solver limit itself did not change. Timing remains observational on a shared host and provider.

The current plan explicitly replaces allocations affected by the verified gateway heap failure, regardless of their patch scores. [The outage audit](../gateway-memory/outage.json) records every original attempt and its admitted-request count; `plan-before-gateway-oom.json` preserves the previous identities. Source commits, tasks, effort, deadlines and concurrency are unchanged. Replacements use new `-oom1` labels. Original partial work, failed allocations and charges stay in the campaign-wide report; complete-pair summaries use the amended plan. These are infrastructure replacements, not selection of a better model attempt.
