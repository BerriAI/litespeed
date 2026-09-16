# Matched reasoning effort experiment

[Plan](plan.json): four harder qualified training tasks, Medium versus High, two attempts each, with the v22 harness fixed. Each run has a 900-second limit and uses the same three shared solver slots. The public copy removes local worktree paths and names Medium as the reporting control; original trial identities, commits and order are retained.

Use `study.py` after `analyze.py` for both datasets. Compare only fully observed task pairs. Prioritize completed behavioral fixes; report the router task's private-helper-coupled failure separately from its eight behavioral checks. Token-derived costs omit unreported requests and do not replace the budget ledger. This is development selection, not held-out evaluation or an Astra comparison.

## Complete development result

| Setting | Successful attempts | Mean seconds | Token-priced total |
|---|---:|---:|---:|
| Medium | 6/8 | 581.92 | $1.2034 |
| High | 5/8 | 652.54 | $1.1669 |

The quality difference is confined to the budget task: Medium solved both attempts, High one. Both settings solved both MCP-auth and Responses attempts, and neither solved the router task under the frozen acceptance criteria. High added 70.62 seconds per attempt on average across matched tasks. Its token-priced aggregate happened to be slightly lower; higher effort does not translate mechanically into higher request cost.

**Continue with Medium for development comparisons.** These four selected tasks provide no reason to raise Flash effort by default. The descriptive task-bootstrap success interval for High minus Medium is [-0.375, 0], based on just four previously inspected tasks; it is not a general confidence guarantee. The separate feature-task effort study remains in progress. The product still preserves the user's selected reasoning effort, and this result does not change any earlier frozen comparison.
