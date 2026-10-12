"""Thai document numbers - ``<prefix><yy><mm>-<nnnn>`` with a Buddhist-era year.

    PO6910-0001   first purchase order of ตุลาคม 2569 (October 2026)
    PR6910-0002   second purchase requisition of the same month

One running sequence per prefix and month for the whole company, not per
project: a number names one document in the company's books, which is what
accounting, VAT reports and suppliers expect. The sequence restarts at 0001
every month.

Concurrency: the next number is MAX(existing)+1, which two simultaneous saves
would compute alike, and the tables' unique constraints are per project so
they would not catch a clash across projects. A transaction-scoped Postgres
advisory lock keyed on the prefix serialises the read-and-insert; it is held
until the caller's transaction ends, so the number is unique once committed.
"""

from __future__ import annotations

import zlib
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Integer, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

# Bangkok is UTC+7; a document raised at 01:00 on the 1st local time belongs
# to the new month even though UTC still says the previous one.
_BANGKOK_OFFSET_HOURS = 7


def thai_period(now: datetime | None = None) -> str:
    """``yymm`` with a Buddhist-era year, in Bangkok time: 2026-10 → ``6910``."""
    from datetime import timedelta

    moment = (now or datetime.now(UTC)).astimezone(UTC) + timedelta(hours=_BANGKOK_OFFSET_HOURS)
    return f"{(moment.year + 543) % 100:02d}{moment.month:02d}"


def thai_numbers_active() -> bool:
    """Thai numbering is on with the Thai edition (off under OE_ALL_MODULES=1)."""
    try:
        from app.core.thai_edition import thai_edition_active  # noqa: PLC0415

        return thai_edition_active()
    except Exception:  # noqa: BLE001
        return False


async def next_thai_number(
    session: AsyncSession,
    column: Any,
    prefix: str,
    *,
    now: datetime | None = None,
) -> str:
    """Next ``<prefix><yymm>-<nnnn>`` for ``column`` (e.g. ``PurchaseOrder.po_number``).

    Takes the advisory lock first (no-op on SQLite, which serialises writers
    anyway), then reads the numeric MAX of this month's suffixes company-wide.
    """
    head = f"{prefix}{thai_period(now)}-"
    bind = session.get_bind()
    if getattr(getattr(bind, "dialect", None), "name", "") == "postgresql":
        key = zlib.crc32(f"thai-doc-number:{prefix}".encode()) & 0x7FFFFFFF
        await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": key})
    stmt = select(func.coalesce(func.max(cast(func.substr(column, len(head) + 1), Integer)), 0)).where(
        column.regexp_match(f"^{head}[0-9]+$")
    )
    last = (await session.execute(stmt)).scalar_one()
    return f"{head}{int(last) + 1:04d}"
