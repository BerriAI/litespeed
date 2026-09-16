# Budget recovery: test relative values and both cache layers

**One-task development experiment; not promoted.**

A completed budget replay (`4e9901d0`) repaired the expired Redis counter to the expected 0.35, but the same acceptance test found the in-memory copy still at 0.6. The candidate reused a monotonic helper that only raises the local value. Its own regression used a database floor of 100 against an old reservation of 5.5, so that test could not expose stale local values above the recovered total.

The [candidate](candidate.patch) adds one matched guide lesson: use stale values above and below the target; inspect Redis and the local copy independently; follow the authoritative atomic update result while preserving concurrent increments and unreachable-Redis behavior. This is a hypothesis to verify in current source, not a direction to lower counters indiscriminately.

The [plan](plan.json) freezes both runtimes, randomizes two repetitions per arm, and requires normal completion plus all five existing checks. Guide activation, chosen regression values, cost and time remain separate evidence. All 17 existing navigator tests and TypeScript checking pass. The task was already used for diagnosis; this cannot establish future generalization or an Astra win.
