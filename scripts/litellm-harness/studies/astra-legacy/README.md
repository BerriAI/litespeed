# Astra diagnostic on the legacy streaming task

The [plan](plan.json) runs two High-effort Codex/Astra attempts on the already inspected legacy streaming training case, using the same 900-second limit, filesystem boundary, fixtures and 24 qualified real-endpoint checks as the [Flash guide study](../streaming-contract/README.md). This asks whether the difficult contract also trips up the baseline model. It is a development diagnosis chosen after observing Flash failures. It cannot estimate future quality or a fair randomized latency difference. Neither solver receives the withheld probe or merged patch. Astra account dollar cost is unavailable.

This diagnostic does not alter previous Flash scores or use the chronological reserved dataset. Results retain normal completion, original 16-check acceptance and supplemental 24-check acceptance separately.

## Completed diagnostic

| Attempt | Normal completion | Original checks | Real-adapter checks | Seconds |
|---|---|---:|---:|---:|
| `e413f841` | Yes | 16/16 | 24/24 | 393.53 |
| `1b1e4b4c` | Yes | 16/16 | 24/24 | 565.01 |

Both attempts pass the declared conditions. [Full results](results.json). Dollar cost remains unavailable. This rules out describing the streaming contract as universally unachievable in 900 seconds, but does not isolate model ability from harness or reasoning effort. These attempts use High reasoning; the Flash guide comparison uses Medium.

### What the implementations did

Both Astra patches adapt the existing endpoint translation rather than assemble a new generic native response. Their small guardrail wrappers receive the assembled response from the existing streaming path, invoke the legacy hook, rescan any replacement through the same endpoint translator, and let the existing stream write-back guard reject unsupported changes. The first patch reuses the existing text/tool-shape checks; the second also explicitly deep-copies the response before invoking a mutating legacy hook. Both use resolved inherited methods when deciding whether a legacy hook exists. These facts come from the candidate diffs, not a model-written critique.

The command transcripts also show related suite checks after implementation, correction of a wrong test assumption about unknown-route fallback, and successful final check commands. One attempt reports 251 related tests; the other reports 252 plus a final 53-case subset. Those model-run checks are distinct from host acceptance. A trace strategy is a candidate lesson, not a controlled explanation of the win: the Flash guide already mentioned translation reuse and one guided patch did pass the real endpoints. More prose alone has not shown a reliable benefit.

Both attempts used protocol 6 and retain its [runtime-artifact reachability limitation](../runtime-artifact-isolation/README.md). No matching access was found in the recorded-command audit, which cannot prove nonaccess. The untouched chronological comparison must use protocol 7 or stronger.
