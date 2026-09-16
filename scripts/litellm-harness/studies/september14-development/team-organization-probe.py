"""Posthoc endpoint diagnostic with coherent joined/separate database reads.

Supports both valid retrieval shapes. Real endpoint membership/admin gates run;
only database operations and the auth user lookup boundary are substituted.
This is additional development evidence, never replacement study acceptance.
"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import Request
from litellm.proxy._types import LiteLLM_OrganizationTable, LiteLLM_TeamTable, LitellmUserRoles, Member, UserAPIKeyAuth
from litellm.proxy.management_endpoints import team_endpoints


class TeamRow(LiteLLM_TeamTable):
    litellm_organization_table: LiteLLM_OrganizationTable | None = None


async def observe(role, models, *, has_org=True, org_exists=True):
    org = LiteLLM_OrganizationTable(organization_id="org-1", budget_id="budget-1", models=models,
                                   created_by="admin", updated_by="admin") if has_org and org_exists else None
    team = TeamRow(team_id="team-1", organization_id="org-1" if has_org else None,
                   members_with_roles=[Member(user_id="team-admin", role="admin"), Member(user_id="member", role="user")])
    calls = []

    async def find_team(*, where, include=None):
        assert where == {"team_id": "team-1"}
        calls.append("team.find_unique")
        return team.model_copy(update={"litellm_organization_table": org if (include or {}).get("litellm_organization_table") else None})

    async def find_org(*, where, **kwargs):
        assert where == {"organization_id": "org-1"}
        calls.append("organization.find_unique")
        return org

    db = SimpleNamespace(
        litellm_teamtable=SimpleNamespace(find_unique=find_team),
        litellm_organizationtable=SimpleNamespace(find_unique=find_org),
        litellm_usertable=SimpleNamespace(find_many=AsyncMock(return_value=[])),
        litellm_teammembership=SimpleNamespace(find_many=AsyncMock(return_value=[])),
    )
    prisma = SimpleNamespace(db=db, get_data=AsyncMock(return_value=[]))
    callers = {
        "proxy-admin": UserAPIKeyAuth(user_id="proxy-admin", user_role=LitellmUserRoles.PROXY_ADMIN),
        "team-admin": UserAPIKeyAuth(user_id="team-admin", user_role=LitellmUserRoles.INTERNAL_USER),
        "org-admin": UserAPIKeyAuth(user_id="org-admin", user_role=LitellmUserRoles.INTERNAL_USER),
        "member": UserAPIKeyAuth(user_id="member", user_role=LitellmUserRoles.INTERNAL_USER),
        "team-key": UserAPIKeyAuth(team_id="team-1"),
        "other-team-key": UserAPIKeyAuth(team_id="team-2"),
        "other-org-admin": UserAPIKeyAuth(user_id="other-org-admin", user_role=LitellmUserRoles.INTERNAL_USER),
        "unrelated-user": UserAPIKeyAuth(user_id="unrelated", user_role=LitellmUserRoles.INTERNAL_USER),
    }

    async def user_lookup(*, user_id, **kwargs):
        memberships = []
        if user_id in {"org-admin", "other-org-admin"}:
            memberships = [SimpleNamespace(organization_id="org-1" if user_id == "org-admin" else "org-2",
                                           user_role=LitellmUserRoles.ORG_ADMIN.value)]
        return SimpleNamespace(organization_memberships=memberships)

    expected = models if role in {"proxy-admin", "team-admin", "org-admin"} and has_org and org_exists else None
    denied = role in {"other-team-key", "other-org-admin", "unrelated-user"}
    before = team.model_dump()
    with patch("litellm.proxy.proxy_server.prisma_client", prisma), patch("litellm.proxy.auth.auth_checks.get_user_object", user_lookup):
        try:
            response = await team_endpoints.team_info(
                http_request=Request({"type": "http", "method": "GET", "path": "/team/info", "headers": []}),
                team_id="team-1", key_limit=None, user_api_key_dict=callers[role])
            info = response["team_info"]
            data = info.model_dump()
            actual = data.get("organization_models", "<absent>")
            passed = not denied and actual == expected and info.team_id == "team-1" and team.model_dump() == before
            return {"pass": passed, "expected": expected, "actual": actual, "databaseCalls": calls,
                    "callerInputUnchanged": team.model_dump() == before}
        except Exception as exc:
            code = getattr(exc, "code", getattr(exc, "status_code", None))
            return {"pass": denied and str(code) == "403", "expected": "403" if denied else expected,
                    "errorType": type(exc).__name__, "error": str(exc), "code": code, "databaseCalls": calls}


async def main():
    rows = []
    for role in ["proxy-admin", "team-admin", "org-admin", "member", "team-key"]:
        for name, models in [("empty", []), ("sentinel", ["all-proxy-models"]), ("concrete", ["model-a", "model-b"])]:
            rows.append({"name": role + ":" + name, **await observe(role, models)})
    for role in ["other-team-key", "other-org-admin", "unrelated-user"]:
        rows.append({"name": role + ":denied", **await observe(role, ["model-a"])})
    for role in ["proxy-admin", "team-admin"]:
        for name, options in [("no-org", {"has_org": False}), ("missing-org", {"org_exists": False})]:
            rows.append({"name": role + ":" + name, **await observe(role, [], **options)})
    print(json.dumps(rows))


asyncio.run(main())
