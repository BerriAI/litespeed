# Repeat relevant lessons at final review

A predeclared eight-trial development experiment compares v26 with one change: repeating the existing query-matched repair lessons for host-recorded changed paths when the model first tries to finish. Two tasks, two repetitions and two variants use the same Medium reasoning, 900-second cap and shared three-solver limit. Trial order is randomized with seed 27160927.

The trigger does not read new files, add a reviewer model, or change permissions. It asks for existing evidence and a minimal overlapping-input check only when a relevant distinction remains uncovered. [The patch](review-guides.patch) includes the runner integration and test. No additional lesson is introduced.

[The plan](plan.json) fixes exact source commits and success criteria. Both tasks require original acceptance and normal completion; router candidates additionally require the five previously published [precedence checks](../router-precedence/README.md), run through the guarded snapshot probe runner. This optional requirement appears on each router trial, not on the budget task. Prior training findings selected this hypothesis and these tasks; this cannot establish unseen-task generalization. Production remains v26 until evidence supports promotion.
