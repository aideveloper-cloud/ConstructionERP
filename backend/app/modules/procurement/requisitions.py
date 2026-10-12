# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""Purchase requisitions - ใบขอซื้อ (PR) for the Thai edition procurement flow.

The model and its FSM have existed for a while (``MaterialRequisition``,
draft → submitted → approved → ordered → received) without an API or a
screen. This module is the missing middle:

* create / edit a draft PR, lines picked from the bill (cost-spine linked,
  exactly like a PO line) or typed for material outside it;
* "ส่งอนุมัติ" starts the company's ``purchase_requisition`` approval route
  (approval center); the chain's outcome moves the PR to approved / rejected
  through :mod:`approval_subscribers`; a pending PR can be withdrawn;
* an approved PR becomes a draft purchase order ("ออกใบสั่งซื้อ") carrying the
  same lines and bill links, and the PR is marked ordered and linked to it.

Numbers follow the Thai document convention ``PR<พ.ศ.yymm>-<nnnn>``, one
sequence for the whole company (:mod:`app.core.thai_doc_numbers`), and the
existing ``MR-<nnnn>`` outside the Thai edition.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.procurement.cost_spine import resolve_cost_line_ids
from app.modules.procurement.models import (
    MaterialRequisition,
    MaterialRequisitionItem,
    PurchaseOrder,
)
from app.modules.procurement.schemas import (
    POCreate,
    POItemCreate,
    RequisitionCreate,
    RequisitionItemIn,
    RequisitionItemOut,
    RequisitionOut,
    RequisitionPOLink,
    RequisitionToPO,
    RequisitionUpdate,
)
from app.modules.procurement.service import (
    MaterialRequisitionService,
    ProcurementService,
    _mr_assert_transition,
)

TARGET_KIND = "purchase_requisition"


class RequisitionService(MaterialRequisitionService):
    """PR use cases on top of the existing requisition service."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    # ── numbering ────────────────────────────────────────────────────────

    async def _next_req_number(self, project_id: uuid.UUID) -> str:
        """``PR<พ.ศ.yymm>-<nnnn>`` company-wide in the Thai edition, ``MR-<nnnn>`` otherwise."""
        from app.core.thai_doc_numbers import next_thai_number, thai_numbers_active  # noqa: PLC0415

        if not thai_numbers_active():
            return await super()._next_req_number(project_id)
        return await next_thai_number(self.session, MaterialRequisition.req_number, "PR")

    # ── lines ────────────────────────────────────────────────────────────

    async def _write_items(self, req: MaterialRequisition, items: list[RequisitionItemIn], currency: str) -> None:
        cost_line_ids = await resolve_cost_line_ids(
            self.session,
            req.project_id,
            [(i.cost_line_id, i.boq_position_id) for i in items],
        )
        for idx, item in enumerate(items):
            qty = Decimal(item.quantity_requested)
            rate = Decimal(item.unit_cost or "0")
            self.session.add(
                MaterialRequisitionItem(
                    requisition_id=req.id,
                    description=item.description,
                    unit=item.unit,
                    quantity_requested=format(qty, "f"),
                    unit_cost=rate,
                    extended_cost=qty * rate,
                    currency_code=currency,
                    cost_line_id=cost_line_ids[idx],
                    sort_order=idx,
                )
            )
        await self.session.flush()

    async def _project_currency(self, project_id: uuid.UUID) -> str:
        from app.modules.projects.models import Project  # noqa: PLC0415

        cur = (await self.session.execute(select(Project.currency).where(Project.id == project_id))).scalar_one_or_none()
        return cur or ""

    # ── CRUD ─────────────────────────────────────────────────────────────

    async def create(self, data: RequisitionCreate, *, requester_id: str | None) -> MaterialRequisition:
        req = await self._create_req_with_retry(
            project_id=data.project_id,
            requester_id=requester_id,
            title=data.title,
            required_date=data.required_date,
            lead_time_days=0,
            estimated_delivery_date=data.required_date,
            notes=data.notes,
        )
        req.metadata_ = {**(req.metadata_ or {}), "delivery_location": data.delivery_location}
        await self._write_items(req, data.items, await self._project_currency(data.project_id))
        return await self._reload(req.id)

    async def update(self, req_id: uuid.UUID, data: RequisitionUpdate) -> MaterialRequisition:
        req = await self.get_requisition(req_id)
        if req.status not in ("draft", "rejected"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only a draft or returned requisition can be edited",
            )
        if req.status == "rejected":
            _mr_assert_transition(req.status, "draft")
            req.status = "draft"
        fields = data.model_dump(exclude_unset=True)
        for key in ("title", "required_date", "notes"):
            if key in fields:
                setattr(req, key, fields[key])
        if "required_date" in fields:
            req.estimated_delivery_date = fields["required_date"]
        if "delivery_location" in fields:
            req.metadata_ = {**(req.metadata_ or {}), "delivery_location": fields["delivery_location"]}
        if data.items is not None:
            for old in list(req.items):
                await self.session.delete(old)
            await self.session.flush()
            await self._write_items(req, data.items, await self._project_currency(req.project_id))
        await self.session.flush()
        return await self._reload(req.id)

    async def delete(self, req_id: uuid.UUID) -> None:
        req = await self.get_requisition(req_id)
        if req.status not in ("draft", "rejected"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only a draft or returned requisition can be deleted; cancel it instead",
            )
        await self.session.delete(req)
        await self.session.flush()

    async def cancel(self, req_id: uuid.UUID) -> MaterialRequisition:
        req = await self.get_requisition(req_id)
        _mr_assert_transition(req.status, "cancelled")
        req.status = "cancelled"
        await self.session.flush()
        return await self._reload(req.id)

    async def _reload(self, req_id: uuid.UUID) -> MaterialRequisition:
        self.session.expire_all()
        return await self.get_requisition(req_id)

    # ── approval ─────────────────────────────────────────────────────────

    async def submit(
        self,
        req_id: uuid.UUID,
        *,
        user_id: str,
        accessible_project_ids: set[uuid.UUID] | None,
    ) -> MaterialRequisition:
        """Draft → submitted, and start the approval chain in the same transaction.

        When the company has no ``purchase_requisition`` route the 409 from the
        approval center propagates and nothing is written.
        """
        from app.modules.approval_routes.queue import submit_for_approval  # noqa: PLC0415

        req = await self.get_requisition(req_id)
        if req.status == "rejected":
            _mr_assert_transition(req.status, "draft")
            req.status = "draft"
        if not req.items:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Add at least one line")
        _mr_assert_transition(req.status, "submitted")
        req.status = "submitted"
        await self.session.flush()
        await submit_for_approval(
            self.session,
            target_kind=TARGET_KIND,
            target_id=req.id,
            route_id=None,
            user_id=user_id,
            accessible_project_ids=accessible_project_ids,
        )
        return await self._reload(req.id)

    async def withdraw(self, req_id: uuid.UUID, *, user_id: str) -> MaterialRequisition:
        """Pull a submitted PR back to draft and cancel its pending approval."""
        from app.modules.approval_routes.models import Instance  # noqa: PLC0415
        from app.modules.approval_routes.service import ApprovalRouteService  # noqa: PLC0415

        req = await self.get_requisition(req_id)
        _mr_assert_transition(req.status, "draft")
        pending = (
            await self.session.execute(
                select(Instance.id).where(
                    Instance.target_kind == TARGET_KIND,
                    Instance.target_id == req.id,
                    Instance.status == "pending",
                )
            )
        ).scalars().all()
        svc = ApprovalRouteService(self.session)
        for instance_id in pending:
            await svc.cancel_instance(instance_id, actor_id=_uuid(user_id), reason="withdrawn by requester")
        req.status = "draft"
        await self.session.flush()
        return await self._reload(req.id)

    async def apply_approval(self, req_id: uuid.UUID, *, decision: str, approver_id: str | None) -> None:
        """Approval-chain outcome → PR status (called by the event subscriber)."""
        req = await self.get_requisition(req_id)
        if req.status != "submitted":
            return  # withdrawn or already moved on; the chain no longer decides it
        if decision == "approved":
            await self.transition_requisition(req_id, "approved", approver_id=approver_id)
        else:
            await self.transition_requisition(req_id, "rejected")

    # ── PR → PO ──────────────────────────────────────────────────────────

    async def create_po(self, req_id: uuid.UUID, data: RequisitionToPO, *, user_id: str | None) -> PurchaseOrder:
        """Approved PR → draft PO with the same lines; PR becomes ordered."""
        req = await self.get_requisition(req_id)
        if req.status != "approved":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only an approved requisition can be turned into a purchase order",
            )
        overrides = {line.item_id: line for line in data.lines}
        po_items: list[POItemCreate] = []
        subtotal = Decimal("0")
        for item in sorted(req.items, key=lambda i: i.sort_order):
            line = overrides.get(item.id)
            qty = Decimal(line.quantity) if line and line.quantity else Decimal(item.quantity_requested or "0")
            rate = Decimal(line.unit_rate) if line else Decimal(item.unit_cost or 0)
            amount = qty * rate
            subtotal += amount
            po_items.append(
                POItemCreate(
                    description=item.description,
                    quantity=format(qty, "f"),
                    unit=item.unit,
                    unit_rate=format(rate, "f"),
                    amount=format(amount, "f"),
                    cost_line_id=str(item.cost_line_id) if item.cost_line_id else None,
                    sort_order=item.sort_order,
                )
            )
            item.quantity_ordered = format(qty, "f")
        po = await ProcurementService(self.session).create_po(
            POCreate(
                project_id=req.project_id,
                vendor_contact_id=data.vendor_contact_id,
                issue_date=data.issue_date,
                delivery_date=data.delivery_date or req.required_date,
                payment_terms=data.payment_terms,
                amount_subtotal=format(subtotal, "f"),
                notes=f"{req.req_number}: {req.title}" if req.title else req.req_number,
                items=po_items,
                metadata={"requisition_id": str(req.id), "requisition_number": req.req_number},
                # Thai default: prices before VAT, 7% on top, unless the buyer chose.
                vat_mode=data.vat_mode or "exclusive",
                vat_rate=data.vat_rate,
            ),
            user_id=user_id,
        )
        await self.transition_requisition(req_id, "ordered", po_id=po.id)
        return po

    # ── goods receipt → PR ───────────────────────────────────────────────

    async def sync_receipts(self, po_id: uuid.UUID) -> None:
        """Copy confirmed receipt quantities from a PO onto the PR it came from.

        PO lines were written from the PR lines in ``sort_order``, so lines pair
        by position. When the PO is fully received ("completed") the PR moves to
        ``received``. Called from the ``procurement.gr.confirmed`` subscriber.
        """
        reqs = (
            await self.session.execute(select(MaterialRequisition).where(MaterialRequisition.po_id == po_id))
        ).scalars().all()
        if not reqs:
            return
        po = await ProcurementService(self.session).get_po(po_id)
        received: dict[uuid.UUID, Decimal] = {}
        for gr in po.goods_receipts:
            if gr.status != "confirmed":
                continue
            for gi in gr.items:
                if gi.po_item_id is not None:
                    received[gi.po_item_id] = received.get(gi.po_item_id, Decimal("0")) + Decimal(
                        str(gi.quantity_received or "0")
                    )
        po_items = sorted(po.items, key=lambda i: i.sort_order)
        po_done = po.status == "completed"
        for req in reqs:
            for req_item, po_item in zip(sorted(req.items, key=lambda i: i.sort_order), po_items, strict=False):
                req_item.quantity_received = format(received.get(po_item.id, Decimal("0")), "f")
            if po_done and req.status == "ordered":
                _mr_assert_transition(req.status, "received")
                req.status = "received"
        await self.session.flush()

    # ── read model ───────────────────────────────────────────────────────

    async def list(
        self,
        project_id: uuid.UUID,
        *,
        status_filter: str | None = None,
        limit: int = 200,
    ) -> list[MaterialRequisition]:
        stmt = (
            select(MaterialRequisition)
            .where(MaterialRequisition.project_id == project_id)
            .order_by(MaterialRequisition.created_at.desc())
            .limit(limit)
        )
        if status_filter:
            stmt = stmt.where(MaterialRequisition.status == status_filter)
        return list((await self.session.execute(stmt)).scalars().all())

    async def to_out(self, reqs: list[MaterialRequisition]) -> list[RequisitionOut]:
        """Serialise with requester names, linked PO and approval state, batched."""
        from app.modules.approval_routes.models import Instance, StepState  # noqa: PLC0415
        from app.modules.users.models import User  # noqa: PLC0415

        if not reqs:
            return []
        user_ids = {_uuid(r.requester_id) for r in reqs} - {None}
        names = (
            dict((await self.session.execute(select(User.id, User.full_name).where(User.id.in_(user_ids)))).all())
            if user_ids
            else {}
        )
        po_ids = {r.po_id for r in reqs if r.po_id}
        pos: dict[uuid.UUID, Any] = {}
        if po_ids:
            from app.modules.procurement.router import _fetch_vendor_names  # noqa: PLC0415

            rows = (await self.session.execute(select(PurchaseOrder).where(PurchaseOrder.id.in_(po_ids)))).scalars().all()
            vendors = await _fetch_vendor_names(self.session, [p.vendor_contact_id for p in rows])
            pos = {
                p.id: RequisitionPOLink(
                    id=p.id,
                    po_number=p.po_number,
                    status=p.status,
                    amount_total=str(p.amount_total),
                    vendor_name=vendors.get(p.vendor_contact_id or ""),
                )
                for p in rows
            }
        # Latest approval instance per requisition, and its rejection reason.
        inst_rows = (
            await self.session.execute(
                select(Instance)
                .where(Instance.target_kind == TARGET_KIND, Instance.target_id.in_([r.id for r in reqs]))
                .order_by(Instance.started_at.desc())
            )
        ).scalars().all()
        latest: dict[uuid.UUID, Any] = {}
        for inst in inst_rows:
            latest.setdefault(inst.target_id, inst)
        reasons: dict[uuid.UUID, str] = {}
        rejected = [i.id for i in latest.values() if i.status == "rejected"]
        if rejected:
            for st in (
                await self.session.execute(
                    select(StepState).where(StepState.instance_id.in_(rejected), StepState.decision == "rejected")
                )
            ).scalars():
                if st.comment:
                    reasons[st.instance_id] = st.comment

        out: list[RequisitionOut] = []
        for r in reqs:
            items = sorted(r.items, key=lambda i: i.sort_order)
            total = sum((Decimal(i.extended_cost or 0) for i in items), Decimal("0"))
            inst = latest.get(r.id)
            out.append(
                RequisitionOut(
                    id=r.id,
                    project_id=r.project_id,
                    req_number=r.req_number,
                    title=r.title,
                    status=r.status,
                    required_date=r.required_date,
                    delivery_location=(r.metadata_ or {}).get("delivery_location"),
                    notes=r.notes,
                    requester_id=r.requester_id,
                    requester_name=names.get(_uuid(r.requester_id)),
                    approver_id=r.approver_id,
                    total=format(total, "f"),
                    currency=(items[0].currency_code if items else None) or None,
                    items=[RequisitionItemOut.model_validate(i) for i in items],
                    po=pos.get(r.po_id) if r.po_id else None,
                    approval_status=inst.status if inst else None,
                    rejection_reason=reasons.get(inst.id) if inst else None,
                    created_at=r.created_at,
                    updated_at=r.updated_at,
                )
            )
        return out


def _uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except (ValueError, TypeError):
        return None

