"""K Garden central access: people and their ConstructionERP access are managed in ERPNext.

ERPNext (the K Garden core) is the OIDC provider. Its userinfo carries the person's access to this
app (app CERP): ``kg_access``, ``kg_role`` (viewer, purchaser, approver, project_manager,
accountant, admin; ``superadmin`` for K Garden super admins), ``kg_scopes`` (ERPNext Projects) and
``kg_scope_refs`` (those projects' ConstructionERP ids). With ``KGARDEN_ACCESS_ENABLED`` on:

* sign-in through ERPNext maps ``kg_role`` to the local role on every login and refuses a person
  without access (ERPNext already refuses them at its own sign-in page);
* project scope becomes membership of a "K Garden access" team in each granted project, so the
  existing project access checks apply unchanged; no scope means every project;
* password login is kept only for break-glass accounts (``KGARDEN_LOCAL_LOGIN``);
* a background task polls ERPNext's ``access_changes`` and ends the sessions of people who lost
  access or got another role (``password_changed_at`` is the session kill switch).

Everything is a no-op while ``KGARDEN_ACCESS_ENABLED`` is off.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

DEFAULT_ROLE_MAP = {
    "superadmin": "admin",
    "admin": "admin",
    "project_manager": "manager",
    "approver": "manager",
    "accountant": "editor",
    "purchaser": "editor",
    "viewer": "viewer",
}
TEAM_NAME = "K Garden access"
TEAM_MARK = "kgarden_access"


def enabled() -> bool:
    return os.environ.get("KGARDEN_ACCESS_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}


def role_map() -> dict[str, str]:
    raw = os.environ.get("KGARDEN_ROLE_MAP", "").strip()
    if not raw:
        return dict(DEFAULT_ROLE_MAP)
    try:
        return {**DEFAULT_ROLE_MAP, **json.loads(raw)}
    except (json.JSONDecodeError, TypeError):
        logger.warning("KGARDEN_ROLE_MAP is not a JSON object; using the default role map")
        return dict(DEFAULT_ROLE_MAP)


def is_kgarden(userinfo: dict) -> bool:
    """Userinfo from the K Garden core carries the kg_* access claims."""
    return enabled() and "kg_app" in userinfo


def subject(userinfo: dict) -> str:
    """Stable subject: Frappe only fills ``sub`` for social-login users, so fall back to the email."""
    return str(userinfo.get("sub") or userinfo.get("email") or "")


def role_for(userinfo: dict) -> str:
    """The local role ERPNext grants this person here, or 403 when it grants none."""
    if not userinfo.get("kg_access") or not userinfo.get("kg_role"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="บัญชีนี้ไม่มีสิทธิ์เข้าใช้ ConstructionERP")
    role = role_map().get(str(userinfo["kg_role"]))
    if not role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"บทบาท {userinfo['kg_role']} จาก ERPNext ยังไม่ได้กำหนดใน ConstructionERP",
        )
    return role


def password_login_allowed(email: str) -> bool:
    if not enabled():
        return True
    allowed = {e.strip().lower() for e in os.environ.get("KGARDEN_LOCAL_LOGIN", "").split(",") if e.strip()}
    return email.strip().lower() in allowed


def project_ids(userinfo_or_change: dict) -> list[uuid.UUID] | None:
    """ConstructionERP project ids granted, or ``None`` for every project (no scope)."""
    scopes = userinfo_or_change.get("kg_scopes", userinfo_or_change.get("scopes")) or []
    if not scopes:
        return None
    refs = userinfo_or_change.get("kg_scope_refs", userinfo_or_change.get("scope_refs")) or {}
    ids = []
    for scope in scopes:
        with contextlib.suppress(ValueError, TypeError):
            ids.append(uuid.UUID(str(refs.get(scope))))
    return ids


async def sync_projects(session, user_id: uuid.UUID, granted: list[uuid.UUID] | None) -> None:
    """Make the person a member of exactly the granted projects through their K Garden access team.

    Only memberships in K Garden access teams are touched: memberships people were given inside
    ConstructionERP itself are left as they are.
    """
    from sqlalchemy import select

    from app.modules.projects.models import Project
    from app.modules.teams.models import Team, TeamMembership

    if granted is None:
        granted = list((await session.execute(select(Project.id))).scalars())
    wanted = set(granted)

    teams = {
        t.project_id: t
        for t in (await session.execute(select(Team).where(Team.name == TEAM_NAME))).scalars()
        if (t.metadata_ or {}).get(TEAM_MARK)
    }
    for project_id in wanted - set(teams):
        if await session.get(Project, project_id) is None:
            continue  # granted in ERPNext but not (or no longer) in ConstructionERP
        team = Team(project_id=project_id, name=TEAM_NAME, is_active=True, metadata_={TEAM_MARK: True})
        session.add(team)
        await session.flush()
        teams[project_id] = team

    current = {
        m.team_id: m
        for m in (
            await session.execute(
                select(TeamMembership).where(
                    TeamMembership.user_id == user_id,
                    TeamMembership.team_id.in_([t.id for t in teams.values()] or [uuid.uuid4()]),
                )
            )
        ).scalars()
    }
    for project_id, team in teams.items():
        member = current.get(team.id)
        if project_id in wanted and member is None:
            session.add(TeamMembership(team_id=team.id, user_id=user_id, role="member"))
        elif project_id not in wanted and member is not None:
            await session.delete(member)
    await session.flush()


async def _user_by_sub_or_email(session, sub: str, email: str):
    from sqlalchemy import or_, select

    from app.modules.users.models import User

    return (
        (await session.execute(select(User).where(or_(User.oidc_sub == sub, User.email == email.lower().strip()))))
        .scalars()
        .first()
    )


async def reactivate(session, sub: str, email: str) -> None:
    """ERPNext granted access again: a person switched off here when access was removed may sign in."""
    user = await _user_by_sub_or_email(session, sub, email)
    if user is not None and not user.is_active and (user.oidc_sub or "") in {"", sub}:
        user.is_active = True
        await session.flush()


async def sync_projects_for(session, sub: str, granted: list[uuid.UUID] | None) -> None:
    from sqlalchemy import select

    from app.modules.users.models import User

    user = (await session.execute(select(User).where(User.oidc_sub == sub))).scalar_one_or_none()
    if user is not None:
        await sync_projects(session, user.id, granted)
        await session.commit()


# ── Following access changes made in ERPNext ────────────────────────────────


async def apply_change(session, change: dict) -> str | None:
    """Apply one access change to the local user; returns what happened, or None."""
    from sqlalchemy import select

    from app.modules.users.models import User

    email = str(change.get("user") or "").lower()
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not user.oidc_sub:
        return None  # never signed in here through ERPNext
    now = datetime.now(UTC)
    if not change.get("granted"):
        if not user.is_active:
            return None
        user.is_active = False
        user.password_changed_at = now  # every token issued before now is refused
        await sync_projects(session, user.id, [])
        return "access removed"
    role = role_map().get(str(change.get("role")))
    if not role:
        return None
    changed = role != user.role or not user.is_active
    user.role = role
    user.is_active = True
    await sync_projects(session, user.id, project_ids(change))
    if changed:
        user.password_changed_at = now  # sign in again with the new role
        return f"role {role}"
    return None


async def poll_once(since: str) -> str:
    """Read access changes since ``since`` (ERPNext local time) and apply them; returns the new cursor."""
    from app.database import async_session_factory

    base = os.environ.get("KGARDEN_ERP_URL", "").rstrip("/")
    auth = f"token {os.environ.get('KGARDEN_ACCESS_API_KEY', '')}:{os.environ.get('KGARDEN_ACCESS_API_SECRET', '')}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base}/api/method/kgarden.access.api.access_changes",
            params={"app_code": os.environ.get("KGARDEN_APP_CODE", "CERP"), "since": since},
            headers={"Authorization": auth, "Accept": "application/json"},
        )
    resp.raise_for_status()
    changes = resp.json().get("message") or []
    latest = since
    async with async_session_factory() as session:
        for change in changes:
            latest = max(latest, str(change.get("changed_at") or since)[:19])
            result = await apply_change(session, change)
            if result:
                logger.info("K Garden access: %s -> %s", change.get("user"), result)
        await session.commit()
    return latest


async def watch_access(every_seconds: float) -> None:
    since = (datetime.now(UTC) + timedelta(hours=7) - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    while True:
        try:
            since = await poll_once(since)
        except Exception as exc:  # noqa: BLE001 - keep polling; ERPNext may be briefly away
            logger.warning("K Garden access poll failed: %s", exc)
        await asyncio.sleep(every_seconds)


_task: asyncio.Task | None = None


def setup_problem(oidc_enabled: bool, env_file: dict[str, str | None]) -> str | None:
    """Why central access would not work as set up, or None when it is fine.

    The rest of the app reads ``backend/.env`` itself, but this module reads the process
    environment. A process started without exporting ``.env`` therefore still signs people in
    through ERPNext, only as plain OIDC: everyone gets the default role, no project scope, and
    access removed in ERPNext does not end their sessions here.
    """
    if not enabled():
        file_value = str(env_file.get("KGARDEN_ACCESS_ENABLED") or "").strip().lower()
        if file_value in {"1", "true", "yes", "on"}:
            return (
                "KGARDEN_ACCESS_ENABLED is on in .env but not in the process environment, so K Garden "
                "central access is OFF: export .env (or pass it to the container) and restart"
            )
        if oidc_enabled:
            return (
                "OIDC sign-in is on but KGARDEN_ACCESS_ENABLED is not: people signing in through "
                "ERPNext get the default role and no project scope, and losing access in ERPNext "
                "does not end their sessions here"
            )
        return None
    if not os.environ.get("KGARDEN_ACCESS_API_KEY"):
        return (
            "KGARDEN_ACCESS_API_KEY is not set: access removed or changed in ERPNext will not end "
            "sessions here until the person signs in again"
        )
    return None


def _warn_on_setup_problem() -> None:
    from dotenv import dotenv_values

    from app.config import _find_env_file, get_settings

    env_file: dict[str, str | None] = {}
    for path in _find_env_file():
        env_file = {**dotenv_values(path), **env_file}  # backend/.env wins, as in Settings
    problem = setup_problem(bool(get_settings().oidc_enabled), env_file)
    if problem:
        logger.warning("K Garden access: %s", problem)


def start_watcher() -> None:
    """Start the access-change poller once per process (no-op while central access is off)."""
    global _task
    with contextlib.suppress(Exception):  # a warning must never stop the app starting
        _warn_on_setup_problem()
    if not enabled() or not os.environ.get("KGARDEN_ACCESS_API_KEY") or (_task and not _task.done()):
        return
    every = float(os.environ.get("KGARDEN_ACCESS_POLL_SECONDS", "60"))
    _task = asyncio.get_event_loop().create_task(watch_access(every))
    logger.info("K Garden access: following ERPNext access changes every %ss", every)
