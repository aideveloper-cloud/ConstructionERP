# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Approval-routes → purchase order wiring (Thai edition approval center).

A PO sent for approval from the approval center ("ส่งอนุมัติ") runs the
company's purchase-order route. When that chain finishes approved, the PO is
approved through :meth:`ProcurementService.approve_po` - the same transition
as the direct approve button, so the budget commitment and the procurement
validation rules still run. A rejected chain leaves the PO in draft for the
requester to fix and resend; the reason lives on the approval itself.

Same shape as :mod:`app.modules.rfi.approval_subscribers`: the handler runs
detached from the deciding request and opens its own session, which is only
safe on PostgreSQL (SQLite's single writer would deadlock the request).
"""

from __future__ import annotations

import logging
import uuid

from app.core.events import Event, event_bus
from app.database import async_session_factory

logger = logging.getLogger(__name__)

_SUBSCRIBED_FLAG = "_procurement_approval_subscribers_registered"


async def _can_open_isolated_session() -> bool:
    try:
        async with async_session_factory() as probe:
            bind = probe.get_bind()
            dialect = getattr(getattr(bind, "dialect", None), "name", "") or ""
        return dialect == "postgresql"
    except Exception:  # noqa: BLE001
        return False


async def _apply_to_requisition(data: dict, decision: str) -> None:
    """Approval-chain outcome on a PR → approved / rejected requisition."""
    try:
        req_id = uuid.UUID(str(data.get("target_id")))
    except (ValueError, TypeError):
        return
    if not await _can_open_isolated_session():
        return
    try:
        async with async_session_factory() as session:
            from app.modules.procurement.requisitions import RequisitionService  # noqa: PLC0415

            await RequisitionService(session).apply_approval(
                req_id, decision=decision, approver_id=data.get("decided_by")
            )
            await session.commit()
    except Exception:  # noqa: BLE001
        logger.warning("procurement: applying %s to requisition %s failed", decision, req_id, exc_info=True)


async def _on_approval_rejected(event: Event) -> None:
    """``approval_routes.instance.rejected`` on a PR → returned to the requester."""
    data = event.data or {}
    if data.get("target_kind") == "purchase_requisition":
        await _apply_to_requisition(data, "rejected")


async def _on_approval_completed(event: Event) -> None:
    """``approval_routes.instance.completed`` → approve the PO / the PR."""
    data = event.data or {}
    if data.get("target_kind") == "purchase_requisition":
        await _apply_to_requisition(data, "approved")
        return
    if data.get("target_kind") != "purchase_order":
        return
    try:
        po_id = uuid.UUID(str(data.get("target_id")))
    except (ValueError, TypeError):
        return
    if not await _can_open_isolated_session():
        return
    try:
        async with async_session_factory() as session:
            from app.modules.procurement.service import ProcurementService  # noqa: PLC0415

            await ProcurementService(session).approve_po(po_id, approver_id=data.get("decided_by"))
            await session.commit()
    except Exception:  # noqa: BLE001 - a failed hand-off must not break the decision
        logger.warning("procurement: approving PO %s after its approval chain failed", po_id, exc_info=True)


async def _on_gr_confirmed(event: Event) -> None:
    """``procurement.gr.confirmed`` → received quantities onto the source PR."""
    data = event.data or {}
    try:
        po_id = uuid.UUID(str(data.get("po_id")))
    except (ValueError, TypeError):
        return
    if not await _can_open_isolated_session():
        return
    try:
        async with async_session_factory() as session:
            from app.modules.procurement.requisitions import RequisitionService  # noqa: PLC0415

            await RequisitionService(session).sync_receipts(po_id)
            await session.commit()
    except Exception:  # noqa: BLE001
        logger.warning("procurement: syncing receipts of PO %s to its requisition failed", po_id, exc_info=True)


def register_procurement_approval_subscribers() -> None:
    """Idempotently wire the PO approval-decision subscriber."""
    if getattr(event_bus, _SUBSCRIBED_FLAG, False):
        return
    event_bus.subscribe_once("approval_routes.instance.completed", _on_approval_completed)
    event_bus.subscribe_once("approval_routes.instance.rejected", _on_approval_rejected)
    event_bus.subscribe_once("procurement.gr.confirmed", _on_gr_confirmed)
    setattr(event_bus, _SUBSCRIBED_FLAG, True)
    logger.info("Procurement: subscribed to approval-routes completion events")
