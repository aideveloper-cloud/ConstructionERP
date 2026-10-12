# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Purchase requisition (ใบขอซื้อ) API, mounted under the procurement module.

    GET    /requisitions/?project_id=      list a project's PRs
    POST   /requisitions/                  create a draft PR
    GET    /requisitions/{id}              one PR
    PATCH  /requisitions/{id}              edit a draft / returned PR
    DELETE /requisitions/{id}              delete a draft / returned PR
    POST   /requisitions/{id}/submit       send for approval (approval center)
    POST   /requisitions/{id}/withdraw     pull a pending PR back to draft
    POST   /requisitions/{id}/cancel       cancel
    POST   /requisitions/{id}/create-po    approved PR → draft purchase order

Included into the procurement router before its ``/{po_id}`` routes, so the
literal ``requisitions`` segment is never parsed as a PO id.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.dependencies import CurrentUserId, RequirePermission, SessionDep, verify_project_access
from app.modules.procurement.requisitions import RequisitionService
from app.modules.procurement.schemas import (
    RequisitionCreate,
    RequisitionListResponse,
    RequisitionOut,
    RequisitionToPO,
    RequisitionUpdate,
)

router = APIRouter(prefix="/requisitions", tags=["procurement"])


def _svc(session: SessionDep) -> RequisitionService:
    return RequisitionService(session)


async def _scope_ids(session: SessionDep, user_id: str) -> set[uuid.UUID] | None:
    from app.modules.dashboard.service import accessible_projects, is_admin  # noqa: PLC0415

    if await is_admin(session, user_id):
        return None
    return {p.id for p in await accessible_projects(session, user_id)}


async def _one(svc: RequisitionService, req_id: uuid.UUID, user_id: str, session: SessionDep) -> RequisitionOut:
    req = await svc.get_requisition(req_id)
    await verify_project_access(req.project_id, str(user_id), session)
    return (await svc.to_out([req]))[0]


@router.get("/", response_model=RequisitionListResponse, dependencies=[Depends(RequirePermission("procurement.read"))])
async def list_requisitions(
    session: SessionDep,
    user_id: CurrentUserId,
    project_id: uuid.UUID = Query(...),
    status_filter: str | None = Query(default=None, alias="status"),
    svc: RequisitionService = Depends(_svc),
) -> RequisitionListResponse:
    await verify_project_access(project_id, str(user_id), session)
    rows = await svc.list(project_id, status_filter=status_filter)
    items = await svc.to_out(rows)
    return RequisitionListResponse(items=items, total=len(items))


@router.post(
    "/",
    response_model=RequisitionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RequirePermission("procurement.create"))],
)
async def create_requisition(
    data: RequisitionCreate,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> RequisitionOut:
    await verify_project_access(data.project_id, str(user_id), session)
    req = await svc.create(data, requester_id=str(user_id))
    return (await svc.to_out([req]))[0]


@router.get("/{req_id}", response_model=RequisitionOut, dependencies=[Depends(RequirePermission("procurement.read"))])
async def get_requisition(
    req_id: uuid.UUID,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> RequisitionOut:
    return await _one(svc, req_id, user_id, session)


@router.patch(
    "/{req_id}", response_model=RequisitionOut, dependencies=[Depends(RequirePermission("procurement.update"))]
)
async def update_requisition(
    req_id: uuid.UUID,
    data: RequisitionUpdate,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> RequisitionOut:
    await _one(svc, req_id, user_id, session)
    req = await svc.update(req_id, data)
    return (await svc.to_out([req]))[0]


@router.delete(
    "/{req_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(RequirePermission("procurement.update"))]
)
async def delete_requisition(
    req_id: uuid.UUID,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> None:
    await _one(svc, req_id, user_id, session)
    await svc.delete(req_id)


@router.post(
    "/{req_id}/submit", response_model=RequisitionOut, dependencies=[Depends(RequirePermission("procurement.create"))]
)
async def submit_requisition(
    req_id: uuid.UUID,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> RequisitionOut:
    """Send for approval. 409 ``no_route`` when no PR approval route exists yet."""
    await _one(svc, req_id, user_id, session)
    req = await svc.submit(req_id, user_id=str(user_id), accessible_project_ids=await _scope_ids(session, user_id))
    return (await svc.to_out([req]))[0]


@router.post(
    "/{req_id}/withdraw", response_model=RequisitionOut, dependencies=[Depends(RequirePermission("procurement.create"))]
)
async def withdraw_requisition(
    req_id: uuid.UUID,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> RequisitionOut:
    await _one(svc, req_id, user_id, session)
    req = await svc.withdraw(req_id, user_id=str(user_id))
    return (await svc.to_out([req]))[0]


@router.post(
    "/{req_id}/cancel", response_model=RequisitionOut, dependencies=[Depends(RequirePermission("procurement.update"))]
)
async def cancel_requisition(
    req_id: uuid.UUID,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> RequisitionOut:
    await _one(svc, req_id, user_id, session)
    req = await svc.cancel(req_id)
    return (await svc.to_out([req]))[0]


@router.post(
    "/{req_id}/create-po",
    response_model=RequisitionOut,
    dependencies=[Depends(RequirePermission("procurement.create"))],
)
async def requisition_to_po(
    req_id: uuid.UUID,
    data: RequisitionToPO,
    session: SessionDep,
    user_id: CurrentUserId,
    svc: RequisitionService = Depends(_svc),
) -> RequisitionOut:
    """Approved PR → draft purchase order; returns the PR with its PO link."""
    await _one(svc, req_id, user_id, session)
    await svc.create_po(req_id, data, user_id=str(user_id))
    return await _one(svc, req_id, user_id, session)
