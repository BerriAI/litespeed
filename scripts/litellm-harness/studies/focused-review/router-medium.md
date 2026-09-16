**Defect 1 — unguarded `None` from global pattern router**

- **Minimal input:** `model="gpt-4o"`, `team_id="t1"`, `"gpt-4o"` not in `self.model_names`; `self.pattern_router.get_deployments_by_pattern("gpt-4o")` returns `None` (the supplied callers at `litellm/router.py:11759` explicitly check `is not None`, and `_try_early_resolve_deployments_for_model_not_in_names` uses truthiness at `litellm/router.py:12350-12355`); `team_pattern_routers["t1"]` has a wildcard match.
- **Expected requirement:** existing resolution semantics treat no global pattern match as “continue to team pattern routes,” as in `_try_early_resolve_deployments_for_model_not_in_names` at `litellm/router.py:12350-12362`.
- **Actual path:** `litellm/router.py:11196` does `*self.pattern_router.get_deployments_by_pattern(resolved)` without `or ()`. If that helper returns `None`, the splat raises `TypeError`, and the team-pattern branch at `litellm/router.py:11197` is never reached.
- **Violation:** team-scoped wildcard fallback is not preserved for a legal no-global-pattern result.

**Defect 2 — team named deployment is not allowed to shadow global wildcard candidates**

- **Minimal input:** `model="foo"`, `team_id="t1"`, `"foo"` not in `self.model_names`; `_get_all_deployments("foo", team_id="t1")` returns a team-specific deployment; `self.pattern_router.get_deployments_by_pattern("foo")` returns a global provider-qualified wildcard deployment such as `openai/*`.
- **Expected requirement:** existing resolution returns the team deployment and does not consult the global pattern router, because named team deployments intentionally shadow wildcard/pattern routes (`litellm/router.py:12338-12344`).
- **Actual path:** `litellm/router.py:11188-11198` unions `_get_all_deployments(...)`, global `get_deployments_by_pattern(...)`, and team `get_deployments_by_pattern(...)`, so the returned candidate ID set contains the global wildcard ID as well as the team deployment ID.
- **Violation:** the candidate set does not reflect the router’s existing team-scoped resolution precedence.

No other concrete violation is demonstrated from the supplied excerpts.