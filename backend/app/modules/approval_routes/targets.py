# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
"""What an approval is about: one summary per target document.

The engine stores only ``target_kind`` + ``target_id``. An approver deciding
from a queue needs the document itself in one line - its number, title,
amount, project and who raised it - and the engine needs the amount to apply
the step approval limits (``Step.min_amount``). This module answers both for
the money documents the Thai edition routes through the approval center.

Each reader imports its sibling module lazily, so a slim install that does
not load (say) contracts only loses that kind's summary, never the queue.
Unknown kinds resolve to ``None`` and the queue shows the bare kind + id.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


@dataclass
class TargetSummary:
    """One line about the document an approval decides."""

    kind: str
    id: uuid.UUID
    code: str | None = None
    title: str | None = None
    amount: Decimal | None = None
    currency: str | None = None
    project_id: uuid.UUID | None = None
    doc_date: str | None = None
    status: str | None = None
    created_by: str | None = None
    # Where the web app shows the document (list page with a highlight).
    url: str | None = None

    def as_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["id"] = str(self.id)
        out["project_id"] = str(self.project_id) if self.project_id else None
        out["amount"] = format(self.amount, "f") if self.amount is not None else None
        return out


def _dec(value: object) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _str(value: object) -> str | None:
    return None if value is None else str(value)


Reader = Callable[[AsyncSession, list[uuid.UUID]], Awaitable[dict[uuid.UUID, TargetSummary]]]


async def _purchase_orders(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, TargetSummary]:
    from app.modules.procurement.models import PurchaseOrder  # noqa: PLC0415

    rows = (await session.execute(select(PurchaseOrder).where(PurchaseOrder.id.in_(ids)))).scalars().all()
    return {
        r.id: TargetSummary(
            kind="purchase_order",
            id=r.id,
            code=r.po_number,
            title=(r.notes or "").strip()[:200] or None,
            amount=_dec(r.amount_total),
            currency=r.currency_code or None,
            project_id=r.project_id,
            doc_date=r.issue_date or (r.created_at.date().isoformat() if r.created_at else None),
            status=r.status,
            created_by=_str(r.created_by),
            url=f"/procurement?po={r.id}",
        )
        for r in rows
    }


async def _change_orders(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, TargetSummary]:
    from app.modules.changeorders.models import ChangeOrder  # noqa: PLC0415

    rows = (await session.execute(select(ChangeOrder).where(ChangeOrder.id.in_(ids)))).scalars().all()
    return {
        r.id: TargetSummary(
            kind="change_order",
            id=r.id,
            code=r.code,
            title=r.title,
            amount=_dec(r.cost_impact),
            currency=r.currency or None,
            project_id=r.project_id,
            doc_date=r.created_at.date().isoformat() if r.created_at else None,
            status=r.status,
            url=f"/changeorders?highlight={r.id}",
        )
        for r in rows
    }


async def _invoices(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, TargetSummary]:
    from app.modules.finance.models import Invoice  # noqa: PLC0415

    rows = (await session.execute(select(Invoice).where(Invoice.id.in_(ids)))).scalars().all()
    return {
        r.id: TargetSummary(
            kind="invoice",
            id=r.id,
            code=r.invoice_number,
            amount=_dec(r.amount_total),
            currency=r.currency_code or None,
            project_id=r.project_id,
            doc_date=r.created_at.date().isoformat() if r.created_at else None,
            status=r.status,
            created_by=_str(r.created_by),
            url="/finance?tab=invoices",
        )
        for r in rows
    }


async def _contracts(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, TargetSummary]:
    from app.modules.contracts.models import Contract  # noqa: PLC0415

    rows = (await session.execute(select(Contract).where(Contract.id.in_(ids)))).scalars().all()
    return {
        r.id: TargetSummary(
            kind="contract",
            id=r.id,
            code=r.code,
            title=r.title or None,
            amount=_dec(r.total_value),
            currency=r.currency or None,
            project_id=r.project_id,
            doc_date=r.start_date,
            status=r.status,
            created_by=r.created_by,
            url=f"/contracts?highlight={r.id}",
        )
        for r in rows
    }


async def _progress_claims(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, TargetSummary]:
    from app.modules.contracts.models import Contract, ProgressClaim  # noqa: PLC0415

    rows = (
        await session.execute(
            select(ProgressClaim, Contract)
            .join(Contract, Contract.id == ProgressClaim.contract_id)
            .where(ProgressClaim.id.in_(ids))
        )
    ).all()
    return {
        claim.id: TargetSummary(
            kind="progress_claim",
            id=claim.id,
            code=claim.claim_number or None,
            title=contract.title or contract.code,
            amount=_dec(claim.net_due),
            currency=claim.currency or contract.currency or None,
            project_id=contract.project_id,
            doc_date=claim.claim_date or claim.submitted_at,
            status=claim.status,
            url=f"/contracts?tab=claims&highlight={contract.id}",
        )
        for claim, contract in rows
    }


async def _rfis(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, TargetSummary]:
    from app.modules.rfi.models import RFI  # noqa: PLC0415

    rows = (await session.execute(select(RFI).where(RFI.id.in_(ids)))).scalars().all()
    return {
        r.id: TargetSummary(
            kind="rfi",
            id=r.id,
            code=r.rfi_number,
            title=r.subject,
            project_id=r.project_id,
            doc_date=r.created_at.date().isoformat() if r.created_at else None,
            status=r.status,
            created_by=r.created_by,
            url=f"/rfi/{r.id}",
        )
        for r in rows
    }


async def _submittals(session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, TargetSummary]:
    from app.modules.submittals.models import Submittal  # noqa: PLC0415

    rows = (await session.execute(select(Submittal).where(Submittal.id.in_(ids)))).scalars().all()
    return {
        r.id: TargetSummary(
            kind="submittal",
            id=r.id,
            code=getattr(r, "submittal_number", None),
            title=r.title,
            project_id=r.project_id,
            doc_date=r.created_at.date().isoformat() if r.created_at else None,
            status=r.status,
            created_by=r.created_by,
            url="/submittals",
        )
        for r in rows
    }


READERS: dict[str, Reader] = {
    "purchase_order": _purchase_orders,
    "change_order": _change_orders,
    "invoice": _invoices,
    "contract": _contracts,
    "progress_claim": _progress_claims,
    "rfi": _rfis,
    "submittal": _submittals,
}


async def resolve_targets(
    session: AsyncSession,
    refs: list[tuple[str, uuid.UUID]],
) -> dict[tuple[str, uuid.UUID], TargetSummary]:
    """Summaries for many ``(kind, id)`` pairs, one query per kind.

    A reader that fails (module not loaded, schema drift) leaves its kind out
    of the result instead of failing the whole queue.
    """
    by_kind: dict[str, list[uuid.UUID]] = {}
    for kind, tid in refs:
        by_kind.setdefault(kind, []).append(tid)
    out: dict[tuple[str, uuid.UUID], TargetSummary] = {}
    for kind, ids in by_kind.items():
        reader = READERS.get(kind)
        if reader is None:
            continue
        # A savepoint, not a rollback: this also runs inside ``start_instance``,
        # and a failed read must not take the caller's transaction with it.
        try:
            async with session.begin_nested():
                found = await reader(session, list(set(ids)))
            for tid, summary in found.items():
                out[(kind, tid)] = summary
        except Exception:  # noqa: BLE001 - one kind must not blank the queue
            logger.warning("approval target reader failed for %s", kind, exc_info=True)
    return out


async def resolve_target(session: AsyncSession, kind: str, target_id: uuid.UUID) -> TargetSummary | None:
    """Summary for one document, or ``None`` when the kind has no reader."""
    return (await resolve_targets(session, [(kind, target_id)])).get((kind, target_id))
