# Focused fresh-review pilot

Four Flash calls reviewed two candidate patches using the task and selected source functions. They did not receive the human patch, hidden tests, acceptance results, previous critiques or the solver conversation. Function selection used known training failures, so this is a focused diagnostic, not a blind-review benchmark. Each case ran once with no reasoning and once with Medium reasoning, with a 16,384-token ceiling and no retries.

| Candidate | Effort | Delivered result | Verified finding |
|---|---|---|---|
| Langfuse trace/session IDs | None | Normal, 1,203 completion tokens | No; proposed witness has the same correct outcome on candidate and reference |
| Langfuse trace/session IDs | Medium | Limit reached, 16,384 completion tokens, empty answer | None delivered |
| Router candidate IDs | None | Normal, 774 completion tokens | No; one conditional allegation and one contradicted by actual routing |
| Router candidate IDs | Medium | Normal, 10,880 completion tokens | Named-team precedence violation, plus one false allegation |

The verified router finding is concrete: with a named team deployment and a global `openai/*` wildcard, the candidate reports both deployment IDs, but the router selects the team deployment and the exact human reference reports only that ID. This reproduces a known training counterexample without giving its expected outcome to the reviewer.

Both router reviews also suggested that `get_deployments_by_pattern` could return `None`, based on defensive callers. The omitted implementation explicitly returns a list or `[]`; the supposed missing guard is not a defect. The no-reasoning review's other-team witness likewise disagrees with both candidate and reference request selection. Witness results preserve these failed allegations, rather than counting them as additional defects.

[Assessment and usage](assessment.json), [plan](plan.json), [router witness](router-witness.py) and [Langfuse witness](langfuse-none-witness.py) are included. Witnesses run under the import-origin and bytecode guards in `probe_runner.py`; reference source is the exact archived commit used by the corresponding precedence study. A witness's `pass` field checks its stated expectation, so an expectation that fails identically on candidate and reference does not establish a candidate regression.

The exact [review prompt](review-prompt.txt), [router input](router-input.json), [Langfuse input](langfuse-input.json) and delivered answers are included for inspection. They contain source excerpts and candidate diffs, not solver transcripts or private reasoning. Send the prompt as the system message and the serialized input as the user message with the plan's effort and token limit to repeat a call. Gateway/model nondeterminism can change the answer.

This pilot supports source-backed, executable verification of review claims. One confirmed finding on two deliberately selected training cases does not establish reviewer recall, precision on future work, or a production judging policy. The fresh reviewer is not promoted to the production architecture.
