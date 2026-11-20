"""K Garden central access: ERPNext decides who may use ConstructionERP, as what, on which projects."""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.modules.users import kgarden_access as kg


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("KGARDEN_ACCESS_ENABLED", "true")
    monkeypatch.setenv("KGARDEN_LOCAL_LOGIN", "breakglass@kgarden.test")
    monkeypatch.delenv("KGARDEN_ROLE_MAP", raising=False)


def test_everything_is_off_by_default(monkeypatch):
    monkeypatch.delenv("KGARDEN_ACCESS_ENABLED", raising=False)
    assert not kg.enabled()
    assert kg.password_login_allowed("anyone@kgarden.test")
    assert not kg.is_kgarden({"kg_app": "CERP"})


@pytest.mark.parametrize(
    ("kg_role", "local"),
    [
        ("superadmin", "admin"),
        ("admin", "admin"),
        ("project_manager", "manager"),
        ("approver", "manager"),
        ("accountant", "editor"),
        ("purchaser", "editor"),
        ("viewer", "viewer"),
    ],
)
def test_erpnext_roles_map_to_local_roles(on, kg_role, local):
    assert kg.role_for({"kg_access": True, "kg_role": kg_role}) == local


@pytest.mark.parametrize(
    "userinfo",
    [
        {"kg_access": False, "kg_role": "admin"},
        {"kg_access": True, "kg_role": None},
        {"kg_access": True, "kg_role": "janitor"},
    ],
)
def test_no_access_or_unknown_role_is_refused(on, userinfo):
    with pytest.raises(HTTPException) as exc:
        kg.role_for(userinfo)
    assert exc.value.status_code == 403


def test_role_map_can_be_overridden(on, monkeypatch):
    monkeypatch.setenv("KGARDEN_ROLE_MAP", '{"purchaser": "manager"}')
    assert kg.role_for({"kg_access": True, "kg_role": "purchaser"}) == "manager"
    assert kg.role_for({"kg_access": True, "kg_role": "viewer"}) == "viewer"


def test_password_login_only_for_break_glass_accounts(on):
    assert kg.password_login_allowed("BreakGlass@kgarden.test")
    assert not kg.password_login_allowed("buyer@kgarden.test")


def test_subject_falls_back_to_email_when_frappe_leaves_sub_empty(on):
    assert kg.subject({"sub": None, "email": "a@kgarden.test"}) == "a@kgarden.test"
    assert kg.subject({"sub": "s-1", "email": "a@kgarden.test"}) == "s-1"


def test_project_scope(on):
    p1, p2 = uuid.uuid4(), uuid.uuid4()
    assert kg.project_ids({"kg_scopes": []}) is None  # no scope: every project
    assert kg.project_ids(
        {"kg_scopes": ["PROJ-1", "PROJ-2", "PROJ-X"], "kg_scope_refs": {"PROJ-1": str(p1), "PROJ-2": str(p2)}}
    ) == [p1, p2]
    # access_changes uses scopes / scope_refs
    assert kg.project_ids({"scopes": ["PROJ-1"], "scope_refs": {"PROJ-1": str(p1)}}) == [p1]


def test_setup_problem_when_dotenv_is_not_exported(monkeypatch):
    # The rest of the app reads .env itself; this module only sees the process environment.
    monkeypatch.delenv("KGARDEN_ACCESS_ENABLED", raising=False)
    problem = kg.setup_problem(True, {"KGARDEN_ACCESS_ENABLED": "true"})
    assert problem and "not in the process environment" in problem


def test_setup_problem_when_oidc_runs_without_central_access(monkeypatch):
    monkeypatch.delenv("KGARDEN_ACCESS_ENABLED", raising=False)
    problem = kg.setup_problem(True, {})
    assert problem and "default role" in problem
    assert kg.setup_problem(False, {}) is None  # plain local install: nothing to warn about


def test_setup_problem_without_the_access_api_key(on, monkeypatch):
    monkeypatch.delenv("KGARDEN_ACCESS_API_KEY", raising=False)
    assert "KGARDEN_ACCESS_API_KEY" in (kg.setup_problem(True, {}) or "")
    monkeypatch.setenv("KGARDEN_ACCESS_API_KEY", "key")
    assert kg.setup_problem(True, {}) is None


# ── OIDC sign-in (UserService.oidc_login) ──────────────────────────────────

import pytest_asyncio  # noqa: E402

from tests._pg import transactional_session  # noqa: E402


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest.mark.asyncio
async def test_a_returning_oidc_user_signs_in_again(session):
    """A second sign-in with an unchanged role used to fall into 'No matching account found'."""
    from app.config import get_settings
    from app.modules.users.service import UserService

    svc = UserService(session, get_settings())
    kw = {
        "oidc_sub": "kg-sub-1",
        "oidc_issuer": "http://erp.test",
        "email": "buyer@kgarden.test",
        "full_name": "Buyer",
        "auto_create": True,
        "role_from_groups": "editor",
    }
    first = await svc.oidc_login(**kw)
    again = await svc.oidc_login(**kw)
    assert first.access_token and again.access_token


@pytest.mark.asyncio
async def test_oidc_role_follows_the_provider_on_every_sign_in(session):
    from sqlalchemy import select

    from app.config import get_settings
    from app.modules.users.models import User
    from app.modules.users.service import UserService

    svc = UserService(session, get_settings())
    base = {
        "oidc_sub": "kg-sub-2",
        "oidc_issuer": "http://erp.test",
        "email": "pm@kgarden.test",
        "full_name": "PM",
        "auto_create": True,
    }
    await svc.oidc_login(**base, role_from_groups="editor")
    await svc.oidc_login(**base, role_from_groups="manager")
    user = (await session.execute(select(User).where(User.oidc_sub == "kg-sub-2"))).scalar_one()
    assert user.role == "manager"
