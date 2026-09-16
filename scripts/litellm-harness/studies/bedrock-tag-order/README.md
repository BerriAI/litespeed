# Bedrock session-tag ordering contradiction

The frozen task says that `get_credentials`, `_auth_with_aws_role`, and the IRSA assume-role paths must forward a tuple of tags sorted by `Key`. Four human-reference tests call `_auth_with_aws_role` directly and require the original unsorted order instead. Their STS test double raises `AccessDenied` when the sequence differs, even when all tag values are present.

The latest appended-job candidate sorts those tags. Its raw result is 24/34 and a 901.023-second timeout. Four failures are these order-sensitive test-double denials; six others require an error-message substring absent from the task. Original scores and the timeout are unchanged.

The [diagnostic](probe.py) sends unsorted tags through direct, external-ID, IRSA cross-account and IRSA same-account calls. It records the STS arguments without rejecting a permutation, checks all tag values and assumed credentials, and reports tuple shape and ordering separately.

| Snapshot | Tag values/credentials | STS tuple | Sent key order |
|---|---:|---|---|
| Pre-fix base | 0/4 | Parameter unsupported | — |
| Exact merged reference | 4/4 | Yes | `team, env` |
| Candidate | 4/4 | Yes | `env, team` |

[Qualification](qualification.json) records exact base/reference commits, guarded module origins, fresh bytecode policy and candidate status. This confirms a contradiction between the curated task and the reference oracle. It does not turn the diagnostic into a replacement 34-check score or establish a completed solution. The narrower tag-value check intentionally does not pretend that the merged reference satisfies the prompt's stronger sorting requirement at these direct helper boundaries.

Frozen study requirements and tests are retained for audit. Do not teach a production harness to preserve a particular mock's tag order merely to improve these raw scores. Future benchmark curation must state where canonical ordering is required and where forwarding caller order is allowed, then qualify that stated contract against the reference.
