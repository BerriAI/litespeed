# Budget recovery: test relative values and both cache layers

**One-task development experiment; not promoted.**

A completed budget replay (`4e9901d0`) repaired the expired Redis counter to the expected 0.35, but the same acceptance test found the in-memory copy still at 0.6. The candidate reused a monotonic helper that only raises the local value. Its own regression used a database floor of 100 against an old reservation of 5.5, so that test could not expose stale local values above the recovered total.

The [candidate](candidate.patch) adds one matched guide lesson: use stale values above and below the target; inspect Redis and the local copy independently; follow the authoritative atomic update result while preserving concurrent increments and unreachable-Redis behavior. This is a hypothesis to verify in current source, not a direction to lower counters indiscriminately.

The [plan](plan.json) freezes both runtimes, randomizes two repetitions per arm, and requires normal completion plus all five existing checks. Guide activation, chosen regression values, cost and time remain separate evidence. All 17 existing navigator tests and TypeScript checking pass. The task was already used for diagnosis; this cannot establish future generalization or an Astra win.

## First candidate observation

Candidate repetition 2 (`e215e803`) finished normally in 787.96 seconds with 4/5 checks passing. Its initial navigation note contained the new lesson in full, including stale values above and below the recovered total and separate Redis/local assertions. The expiry check still found local spend 0.6 instead of 0.35. Control repetition 2 (`13ed67d6`) finished in 463.61 seconds with 5/5. Repetition 1 subsequently finished; the complete comparison is below.

The candidate's own settlement regression used local 0.4 and recovered total 0.55, so the existing maximum-only repair looked correct. A separate release regression explicitly expected local 0.4 to remain above the recovered Redis value 0.25 and justified this as conservative fallback behavior. Showing the desired counterexample in context did not ensure the model used it to challenge the inherited helper. This observation argues against treating guide delivery as evidence that its checks were performed. The original acceptance result remains unchanged, and the guide is unpromoted.

## Complete result and decision

Across both repetitions, control completed successfully **2/2**, while the added guide completed successfully **1/2**. Mean elapsed time was 532.48 seconds for control and 754.42 seconds for the guide (+221.94 seconds). Token-priced totals were $0.1880 and $0.2188 respectively; these totals do not replace the campaign ledger. Every attempt finished normally.

**Reject promotion.** This one previously inspected task gives no evidence of benefit from the extra wording. It does not establish that such value comparisons are unhelpful; it establishes that delivering this particular lesson did not reliably make the solver perform them. No between-task uncertainty interval is available from one task. See [the complete trial results](results.json).
