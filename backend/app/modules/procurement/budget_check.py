# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Budget check for purchase requisitions (เช็คงบตอนขอซื้อ, Thai edition).

Before a requester sends a PR, and on the approver's card afterwards, each
line is set against its BOQ budget line (the cost-spine line it is linked to):

    budget     the cost line's estimate (amount and quantity)
    ordered    purchase-order lines against it, every order not cancelled -
               drafts included, because a draft is money someone is about to
               commit - counted net of VAT (VAT-inclusive orders brought back)
    pending    other requisitions sent or approved but not yet ordered
    this       the lines being checked

    after = ordered + pending + this;  remaining = budget - after
    level: "ok" below 85% of budget, "warning" from 85%, "over" above 100%,
           "unbudgeted" for a line that is outside the BOQ (no cost line) or
           whose cost line carries no budget

Several PR lines may point at one budget line; they are summed before the
line is judged, so splitting a request does not slip under the limit.
Read-only: nothing here blocks a request. The levels are shown to the
requester and to the approver, and an over-budget PR cannot be bulk-approved.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

WARNING_RATIO = Decimal("0.85")
_CENT = Decimal("0.01")
_LEVEL_ORDER = {"ok": 0, "unbudgeted": 1, "warning": 2, "over": 3}


def _dec(value: object) -> Decimal:
    try:
        return Decimal(str(value)) if value not in (None, "") else Decimal("0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _money(value: Decimal) -> str:
    return format(value.quantize(_CENT, rounding=ROUND_HALF_UP), "f")


def level_for(budget: Decimal, after: Decimal) -> str:
    """Budget level of a line once ``after`` has been spent against ``budget``."""
    if budget <= 0:
        return "unbudgeted"
    if after > budget:
        return "over"
    if after >= budget * WARNING_RATIO:
        return "warning"
    return "ok"


def worst_level(levels: Iterable[str]) -> str:
    return max(levels, key=lambda lv: _LEVEL_ORDER.get(lv, 0), default="ok")


async def _ordered_by_cost_line(
    session: AsyncSession, project_id: uuid.UUID, cost_line_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[Decimal, Decimal]]:
    """(net amount, quantity) on purchase orders per cost line, cancelled excluded."""
    from app.modules.procurement.models import PurchaseOrder, PurchaseOrderItem  # noqa: PLC0415

    rows = (
        await session.execute(
            select(
                PurchaseOrderItem.cost_line_id,
                PurchaseOrderItem.amount,
                PurchaseOrderItem.quantity,
                PurchaseOrder.vat_mode,
                PurchaseOrder.vat_rate,
            )
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.po_id)
            .where(
                PurchaseOrder.project_id == project_id,
                PurchaseOrder.status != "cancelled",
                PurchaseOrderItem.cost_line_id.in_(cost_line_ids),
            )
        )
    ).all()
    out: dict[uuid.UUID, tuple[Decimal, Decimal]] = {}
    for cost_line_id, amount, qty, vat_mode, vat_rate in rows:
        net = _dec(amount)
        rate = _dec(vat_rate) if vat_rate else Decimal("7")
        if vat_mode == "inclusive" and rate > 0:
            net = net * Decimal(100) / (Decimal(100) + rate)
        a, q = out.get(cost_line_id, (Decimal("0"), Decimal("0")))
        out[cost_line_id] = (a + net, q + _dec(qty))
    return out


async def _pending_by_cost_line(
    session: AsyncSession,
    project_id: uuid.UUID,
    cost_line_ids: set[uuid.UUID],
    exclude_requisition_id: uuid.UUID | None,
) -> dict[uuid.UUID, tuple[Decimal, Decimal]]:
    """(amount, quantity) on other requisitions sent or approved, not yet ordered."""
    from app.modules.procurement.models import MaterialRequisition, MaterialRequisitionItem  # noqa: PLC0415

    stmt = (
        select(
            MaterialRequisitionItem.cost_line_id,
            MaterialRequisitionItem.extended_cost,
            MaterialRequisitionItem.quantity_requested,
        )
        .join(MaterialRequisition, MaterialRequisition.id == MaterialRequisitionItem.requisition_id)
        .where(
            MaterialRequisition.project_id == project_id,
            MaterialRequisition.status.in_(("submitted", "approved")),
            MaterialRequisitionItem.cost_line_id.in_(cost_line_ids),
        )
    )
    if exclude_requisition_id is not None:
        stmt = stmt.where(MaterialRequisition.id != exclude_requisition_id)
    out: dict[uuid.UUID, tuple[Decimal, Decimal]] = {}
    for cost_line_id, amount, qty in (await session.execute(stmt)).all():
        a, q = out.get(cost_line_id, (Decimal("0"), Decimal("0")))
        out[cost_line_id] = (a + _dec(amount), q + _dec(qty))
    return out


async def check_budget(
    session: AsyncSession,
    project_id: uuid.UUID,
    lines: list[dict[str, Any]],
    *,
    exclude_requisition_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Judge requested lines against their BOQ budget lines.

    ``lines``: dicts with ``amount``, ``quantity`` and either ``cost_line_id``
    or ``boq_position_id`` (resolved the way PR and PO lines are).

    Returns ``{"level", "lines": [...], "budget_lines": [...]}``: one entry per
    requested line (its index, budget line and level) and one per budget line
    touched, with the figures behind the level.
    """
    from app.modules.costmodel.models import CostLine  # noqa: PLC0415
    from app.modules.procurement.cost_spine import resolve_cost_line_ids  # noqa: PLC0415

    resolved = await resolve_cost_line_ids(
        session,
        project_id,
        [(ln.get("cost_line_id"), ln.get("boq_position_id")) for ln in lines],
    )
    wanted = {cid for cid in resolved if cid is not None}
    # Only this project's cost lines: a cost_line_id from another project is
    # treated as unbudgeted, so its budget never leaks across projects.
    cost_lines = (
        {
            cl.id: cl
            for cl in (
                await session.execute(
                    select(CostLine).where(CostLine.id.in_(wanted), CostLine.project_id == project_id)
                )
            ).scalars()
        }
        if wanted
        else {}
    )
    resolved = [cid if cid in cost_lines else None for cid in resolved]
    wanted = set(cost_lines)
    ordered = await _ordered_by_cost_line(session, project_id, wanted) if wanted else {}
    pending = await _pending_by_cost_line(session, project_id, wanted, exclude_requisition_id) if wanted else {}

    this: dict[uuid.UUID, tuple[Decimal, Decimal]] = {}
    for ln, cid in zip(lines, resolved, strict=True):
        if cid is None:
            continue
        a, q = this.get(cid, (Decimal("0"), Decimal("0")))
        this[cid] = (a + _dec(ln.get("amount")), q + _dec(ln.get("quantity")))

    budget_lines: dict[uuid.UUID, dict[str, Any]] = {}
    for cid, (this_amount, this_qty) in this.items():
        cl = cost_lines.get(cid)
        budget = _dec(cl.estimate_amount) if cl else Decimal("0")
        ord_amount, ord_qty = ordered.get(cid, (Decimal("0"), Decimal("0")))
        pen_amount, pen_qty = pending.get(cid, (Decimal("0"), Decimal("0")))
        after = ord_amount + pen_amount + this_amount
        budget_lines[cid] = {
            "cost_line_id": str(cid),
            "code": cl.code if cl else None,
            "description": cl.description if cl else None,
            "unit": cl.unit if cl else None,
            "budget": _money(budget),
            "budget_qty": format(_dec(cl.estimate_quantity), "f") if cl else "0",
            "ordered": _money(ord_amount),
            "ordered_qty": format(ord_qty, "f"),
            "pending": _money(pen_amount),
            "pending_qty": format(pen_qty, "f"),
            "this": _money(this_amount),
            "this_qty": format(this_qty, "f"),
            "after": _money(after),
            "remaining": _money(budget - after),
            "used_pct": float((after / budget * 100).quantize(Decimal("0.1"))) if budget > 0 else None,
            "level": level_for(budget, after),
        }

    out_lines = []
    for idx, cid in enumerate(resolved):
        if cid is None:
            out_lines.append({"index": idx, "cost_line_id": None, "level": "unbudgeted"})
        else:
            out_lines.append({"index": idx, "cost_line_id": str(cid), "level": budget_lines[cid]["level"]})

    return {
        "level": worst_level([ln["level"] for ln in out_lines]),
        "lines": out_lines,
        "budget_lines": list(budget_lines.values()),
    }
