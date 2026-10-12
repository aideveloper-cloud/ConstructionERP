# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Approval center queue (Thai edition, Mango "Approve" style).

One list that answers "what do I have to approve", built on the existing
engine (routes / steps / instances). Each row carries what an approver needs
to decide without opening the document: the document line (number, amount,
project, requester, from :mod:`targets`), the whole chain with the steps the
amount skips, and whether *this* caller may decide the current step - the
same entitlement rule :meth:`ApprovalRouteService.submit_decision` enforces,
so a button shown here is a button that works.

Tabs:
    mine       pending, current step decidable by the caller
    waiting    pending, held by someone else
    submitted  started by the caller (any status)
    history    the caller recorded a decision on it

Scope follows the dashboard inbox: an admin sees everything, everyone else
only instances whose route project and document project they can access.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.approval_routes.models import Instance, Route, Step, StepState
from app.modules.approval_routes.schemas import DecisionSubmit, InstanceCreate
from app.modules.approval_routes.service import (
    ApprovalRouteService,
    _caller_role_satisfies,
    _to_decimal,
    step_applies,
)
from app.modules.approval_routes.targets import TargetSummary, resolve_target, resolve_targets

TABS = ("mine", "waiting", "submitted", "history")
# Recent instances considered for one queue read. The queue is a work list,
# not an archive; the history tab shows the latest decisions only.
_SCAN_LIMIT = 1000


def _uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except (ValueError, TypeError):
        return None


async def _user_names(session: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    from app.modules.users.models import User  # noqa: PLC0415

    rows = (await session.execute(select(User.id, User.full_name, User.email).where(User.id.in_(ids)))).all()
    return {uid: (name or email or "").strip() for uid, name, email in rows}


async def _project_names(session: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    from app.modules.projects.models import Project  # noqa: PLC0415

    rows = (await session.execute(select(Project.id, Project.name).where(Project.id.in_(ids)))).all()
    return dict(rows)


async def build_queue(
    session: AsyncSession,
    *,
    user_id: str,
    caller_role: str | None,
    accessible_project_ids: set[uuid.UUID] | None,
    tab: str = "mine",
    target_kind: str | None = None,
    project_id: uuid.UUID | None = None,
    q: str | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    """The caller's approval queue for ``tab`` plus the count of every tab.

    ``accessible_project_ids`` is ``None`` for an admin (no project filter).
    """
    if tab not in TABS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Unknown tab: {tab!r}")
    me = _uuid(user_id)
    service = ApprovalRouteService(session)
    now = datetime.now(UTC)

    instances = list(
        (await session.execute(select(Instance).order_by(Instance.started_at.desc()).limit(_SCAN_LIMIT))).scalars()
    )
    if not instances:
        return {"tab": tab, "items": [], "counts": dict.fromkeys(TABS, 0)}

    route_ids = {i.route_id for i in instances}
    routes = {r.id: r for r in (await session.execute(select(Route).where(Route.id.in_(route_ids)))).scalars()}
    steps_by_route: dict[uuid.UUID, list[Step]] = {}
    for s in (await session.execute(select(Step).where(Step.route_id.in_(route_ids)))).scalars():
        steps_by_route.setdefault(s.route_id, []).append(s)
    for lst in steps_by_route.values():
        lst.sort(key=lambda s: s.ordinal)
    states_by_instance = await service.list_step_states_for_instances([i.id for i in instances])
    targets = await resolve_targets(session, [(i.target_kind, i.target_id) for i in instances])

    # ── Scope: route project and document project must both be reachable ──
    def visible(inst: Instance) -> bool:
        if accessible_project_ids is None:
            return True
        route = routes.get(inst.route_id)
        if route is not None and route.project_id is not None and route.project_id not in accessible_project_ids:
            return False
        target = targets.get((inst.target_kind, inst.target_id))
        if target is not None and target.project_id is not None and target.project_id not in accessible_project_ids:
            return False
        return True

    instances = [i for i in instances if visible(i)]

    # ── Can the caller decide the current step? (same rule as the engine) ──
    async def can_decide(inst: Instance) -> bool:
        if inst.status != "pending" or me is None:
            return False
        step = next((s for s in steps_by_route.get(inst.route_id, []) if s.ordinal == inst.current_step_ordinal), None)
        if step is None:
            return False
        already = any(
            st.step_id == step.id and st.approver_user_id == me and st.decision != "pending"
            for st in states_by_instance.get(inst.id, [])
        )
        if already:
            return False
        entitled = await service.entitled_deciders(inst, step, now=now)
        if entitled is not None:
            return me in entitled
        return bool(step.approver_role) and _caller_role_satisfies(caller_role, step.approver_role)

    decidable: dict[uuid.UUID, bool] = {}
    for inst in instances:
        decidable[inst.id] = await can_decide(inst)

    def in_tab(inst: Instance, name: str) -> bool:
        if name == "mine":
            return inst.status == "pending" and decidable[inst.id]
        if name == "waiting":
            return inst.status == "pending" and not decidable[inst.id]
        if name == "submitted":
            return me is not None and inst.started_by == me
        # history
        return me is not None and any(
            st.approver_user_id == me and st.decision != "pending" for st in states_by_instance.get(inst.id, [])
        )

    # ── Filters (kind / project / text) apply to the list and the counts ──
    needle = (q or "").strip().lower()

    def passes_filters(inst: Instance) -> bool:
        if target_kind and inst.target_kind != target_kind:
            return False
        target = targets.get((inst.target_kind, inst.target_id))
        if project_id and (target is None or target.project_id != project_id):
            route = routes.get(inst.route_id)
            if route is None or route.project_id != project_id:
                return False
        if needle:
            hay = " ".join(
                x
                for x in (
                    target.code if target else None,
                    target.title if target else None,
                    routes[inst.route_id].name if inst.route_id in routes else None,
                )
                if x
            ).lower()
            if needle not in hay:
                return False
        return True

    filtered = [i for i in instances if passes_filters(i)]
    counts = {name: sum(1 for i in filtered if in_tab(i, name)) for name in TABS}
    rows = [i for i in filtered if in_tab(i, tab)]
    if tab == "mine":
        # Oldest first: the one waiting longest is the one to clear first.
        rows.sort(key=lambda i: i.started_at)
    rows = rows[:limit]

    # ── Names for people and projects shown on the rows ──
    people: set[uuid.UUID] = set()
    projects: set[uuid.UUID] = set()
    for inst in rows:
        if inst.started_by:
            people.add(inst.started_by)
        if inst.current_assignee_user_id:
            people.add(inst.current_assignee_user_id)
        for s in steps_by_route.get(inst.route_id, []):
            if s.approver_user_id:
                people.add(s.approver_user_id)
        for st in states_by_instance.get(inst.id, []):
            if st.approver_user_id:
                people.add(st.approver_user_id)
        target = targets.get((inst.target_kind, inst.target_id))
        if target and target.project_id:
            projects.add(target.project_id)
        route = routes.get(inst.route_id)
        if route and route.project_id:
            projects.add(route.project_id)
    names = await _user_names(session, people)
    project_names = await _project_names(session, projects)

    items = [
        _row(
            inst,
            routes.get(inst.route_id),
            steps_by_route.get(inst.route_id, []),
            states_by_instance.get(inst.id, []),
            targets.get((inst.target_kind, inst.target_id)),
            can_decide=decidable[inst.id],
            me=me,
            names=names,
            project_names=project_names,
            now=now,
        )
        for inst in rows
    ]
    return {"tab": tab, "items": items, "counts": counts}


def _row(
    inst: Instance,
    route: Route | None,
    steps: list[Step],
    states: list[StepState],
    target: TargetSummary | None,
    *,
    can_decide: bool,
    me: uuid.UUID | None,
    names: dict[uuid.UUID, str],
    project_names: dict[uuid.UUID, str],
    now: datetime,
) -> dict[str, Any]:
    amount = _to_decimal(inst.amount)
    if amount is None and target is not None:
        amount = target.amount
    chain: list[dict[str, Any]] = []
    applicable = [s for s in steps if step_applies(s, amount)]
    for s in steps:
        step_states = [st for st in states if st.step_id == s.id and st.decision != "pending"]
        decided = sorted(step_states, key=lambda st: st.decided_at or st.created_at)
        if not step_applies(s, amount):
            state = "skipped"
        elif any(st.decision == "rejected" for st in decided):
            state = "rejected"
        elif inst.status == "pending" and s.ordinal == inst.current_step_ordinal:
            state = "current"
        elif s.ordinal < inst.current_step_ordinal or inst.status == "approved":
            state = "approved"
        else:
            state = "waiting"
        chain.append(
            {
                "step_id": str(s.id),
                "ordinal": s.ordinal,
                "approver_role": s.approver_role,
                "approver_user_id": str(s.approver_user_id) if s.approver_user_id else None,
                "approver_name": names.get(s.approver_user_id) if s.approver_user_id else None,
                "min_amount": s.min_amount,
                "sla_hours": s.sla_hours,
                "state": state,
                "decisions": [
                    {
                        "decision": st.decision,
                        "by": str(st.approver_user_id) if st.approver_user_id else None,
                        "by_name": names.get(st.approver_user_id) if st.approver_user_id else None,
                        "at": st.decided_at.isoformat() if st.decided_at else None,
                        "comment": st.comment,
                    }
                    for st in decided
                ],
            }
        )
    current = next((c for c in chain if c["state"] == "current"), None)
    position = next((n for n, s in enumerate(applicable, 1) if s.ordinal == inst.current_step_ordinal), None)
    rejection = next(
        (d for c in chain for d in c["decisions"] if d["decision"] == "rejected"),
        None,
    )
    my_decision = next(
        (d["decision"] for c in chain for d in c["decisions"] if me is not None and d["by"] == str(me)),
        None,
    )
    project_id = (target.project_id if target else None) or (route.project_id if route else None)
    started = inst.started_at if inst.started_at.tzinfo else inst.started_at.replace(tzinfo=UTC)
    return {
        "instance_id": str(inst.id),
        "status": inst.status,
        "target_kind": inst.target_kind,
        "target_id": str(inst.target_id),
        "target": target.as_dict() if target else None,
        "route": {"id": str(route.id), "name": route.name} if route else None,
        "project": {"id": str(project_id), "name": project_names.get(project_id)} if project_id else None,
        "amount": format(amount, "f") if amount is not None else None,
        "currency": inst.currency or (target.currency if target else None),
        "requester": {
            "id": str(inst.started_by) if inst.started_by else None,
            "name": names.get(inst.started_by) if inst.started_by else None,
        },
        "started_at": inst.started_at.isoformat(),
        "completed_at": inst.completed_at.isoformat() if inst.completed_at else None,
        "waiting_hours": round((now - started).total_seconds() / 3600, 1),
        "current_step": current,
        "position": position,
        "step_count": len(applicable),
        "chain": chain,
        "can_decide": can_decide,
        "my_decision": my_decision,
        "rejection": rejection,
    }


async def decide_many(
    session: AsyncSession,
    *,
    instance_ids: list[uuid.UUID],
    decision: str,
    comment: str | None,
    user_id: str,
    caller_role: str | None,
    accessible_project_ids: set[uuid.UUID] | None,
) -> list[dict[str, Any]]:
    """Decide the current step of each instance; one result per instance.

    A rejection must carry a reason (Mango: "ไม่อนุมัติต้องระบุเหตุผล"), and
    the requester reads it on the returned document. Each decision runs in its
    own savepoint, so one stale or forbidden row does not undo the others.
    """
    reason = (comment or "").strip() or None
    if decision == "rejected" and not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A rejection needs a reason",
        )
    service = ApprovalRouteService(session)
    me = _uuid(user_id)
    bulk = decision == "approved" and len(instance_ids) > 1
    results: list[dict[str, Any]] = []
    for instance_id in instance_ids:
        try:
            async with session.begin_nested():
                inst = await service.get_instance(instance_id)
                await _check_scope(session, service, inst, accessible_project_ids)
                # An over-budget request is approved one at a time, after the
                # approver has looked at it, never swept up in a bulk approval.
                if bulk:
                    target = await resolve_target(session, inst.target_kind, inst.target_id)
                    if target is not None and (target.budget or {}).get("level") == "over":
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail={"code": "over_budget", "message": "Over budget: approve it on its own"},
                        )
                steps = await service.list_steps(inst.route_id)
                step = next((s for s in steps if s.ordinal == inst.current_step_ordinal), None)
                if step is None:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No current step")
                updated = await service.submit_decision(
                    instance_id,
                    DecisionSubmit(step_id=step.id, decision=decision, comment=reason),  # type: ignore[arg-type]
                    approver_id=me,
                    caller_role=caller_role,
                )
                results.append({"instance_id": str(instance_id), "ok": True, "status": updated.status})
        except HTTPException as exc:
            results.append(
                {"instance_id": str(instance_id), "ok": False, "status_code": exc.status_code, "error": exc.detail}
            )
    return results


async def _check_scope(
    session: AsyncSession,
    service: ApprovalRouteService,
    inst: Instance,
    accessible_project_ids: set[uuid.UUID] | None,
) -> None:
    if accessible_project_ids is None:
        return
    route = await service.get_route(inst.route_id)
    target = await resolve_target(session, inst.target_kind, inst.target_id)
    pids = {p for p in (route.project_id, target.project_id if target else None) if p is not None}
    if any(p not in accessible_project_ids for p in pids):
        # 404, not 403: an id outside the caller's projects must not be probeable.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval instance not found")


async def submit_for_approval(
    session: AsyncSession,
    *,
    target_kind: str,
    target_id: uuid.UUID,
    route_id: uuid.UUID | None,
    user_id: str,
    accessible_project_ids: set[uuid.UUID] | None,
) -> Instance:
    """Start the approval chain for a document ("ส่งอนุมัติ").

    The route is the one given, else the document project's active route for
    this kind, else the company-wide one. No route means the company has not
    set up an approval line for this document type yet, which is a 409 the UI
    turns into "ask the administrator to set it up".
    """
    target = await resolve_target(session, target_kind, target_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if accessible_project_ids is not None and target.project_id is not None:
        if target.project_id not in accessible_project_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    service = ApprovalRouteService(session)
    if route_id is None:
        routes = await service.list_routes(project_id=target.project_id)
        candidates = [r for r in routes if r.target_kind == target_kind and r.is_active]
        own = [r for r in candidates if r.project_id is not None and r.project_id == target.project_id]
        shared = [r for r in candidates if r.project_id is None]
        chosen = (own or shared or [None])[0]
        if chosen is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "no_route", "message": f"No approval route for {target_kind}"},
            )
        route_id = chosen.id
    amount: Decimal | None = target.amount
    return await service.start_instance(
        InstanceCreate(
            route_id=route_id,
            target_kind=target_kind,  # type: ignore[arg-type]
            target_id=target_id,
            amount=amount,
            currency=target.currency,
        ),
        started_by=_uuid(user_id),
    )
