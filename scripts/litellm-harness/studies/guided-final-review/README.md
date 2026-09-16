# Repeat relevant lessons at final review

A predeclared eight-trial development experiment compares v26 with one change: repeating the existing query-matched repair lessons for host-recorded changed paths when the model first tries to finish. Two tasks, two repetitions and two variants use the same Medium reasoning, 900-second cap and shared three-solver limit. Trial order is randomized with seed 27160927.

The trigger does not read new files, add a reviewer model, or change permissions. It asks for existing evidence and a minimal overlapping-input check only when a relevant distinction remains uncovered. [The patch](review-guides.patch) includes the runner integration and test. No additional lesson is introduced.

[The plan](plan.json) fixes exact source commits and success criteria. Both tasks require original acceptance and normal completion; router candidates additionally require the five previously published [precedence checks](../router-precedence/README.md), run through the guarded snapshot probe runner. This optional requirement appears on each router trial, not on the budget task. Prior training findings selected this hypothesis and these tasks; this cannot establish unseen-task generalization. The frozen control is v26; repeating guides at final review remains experimental.

## Complete result and decision

Both arms achieved **1/4** successful attempts under the predeclared combined criteria. All four router attempts passed their original acceptance check but failed the supplemental precedence checks; both arms solved one of their two budget attempts. Mean elapsed time was 358.43 seconds for control and 391.28 seconds with repeated guides (+32.85 seconds). Token-priced totals were $0.3687 and $0.6700 respectively, separate from campaign accounting.

**Reject promotion.** Repeating the lessons at final review did not close the known gaps on these two development tasks. The descriptive task bootstrap's [0, 0] observed quality difference is a consequence of two equal task results, not proof of equivalence on future tasks. [Complete results](results.json) retain every attempt and the original/supplemental outcomes.
