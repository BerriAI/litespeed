"""Compare candidate membership with actual offline deployment selection."""
import json
from litellm import Router


def deployment(name, model, identity, **info):
    return {"model_name": name,
            "litellm_params": {"model": model, "api_key": "synthetic", "api_base": "https://example.invalid"},
            "model_info": {"id": identity, **info}}


rows = []
models = [deployment("group", "openai/gpt-4o", "direct"),
          deployment("openai/*", "openai/*", "global-wild"),
          deployment("team-pattern", "openai/gpt-4o", "team-wild", team_id="team-a", team_public_model_name="openai/*"),
          deployment("team-exact", "openai/gpt-4o", "team-named", team_id="team-b", team_public_model_name="gpt-4o")]
router = Router(model_list=models)
for name, model, team, expected in [
    ("unprefixed-global", "gpt-4o", None, ["global-wild"]),
    ("direct-group", "group", None, ["direct"]),
    ("global-before-team-wildcard", "gpt-4o", "team-a", ["global-wild"]),
    ("named-team-before-global", "gpt-4o", "team-b", ["team-named"]),
]:
    actual = sorted(router.get_candidate_model_ids_for_route(model=model, team_id=team))
    selected = router.get_available_deployment(model=model, messages=[], request_kwargs={"metadata": {"user_api_key_team_id": team}})["model_info"]["id"]
    rows.append({"case": name, "expected": expected, "candidates": actual, "selected": selected,
                 "pass": actual == expected and selected in expected})
router = Router(model_list=[deployment("*", "openai/*", "default")])
actual = sorted(router.get_candidate_model_ids_for_route(model="openai/unknown-model"))
selected = router.get_available_deployment(model="openai/unknown-model", messages=[])["model_info"]["id"]
rows.append({"case": "default", "expected": ["default"], "candidates": actual, "selected": selected,
             "pass": actual == ["default"] and selected == "default"})
print(json.dumps(rows))
