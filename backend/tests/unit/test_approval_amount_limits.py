"""Approval limits by amount (Thai edition approval center).

A step with ``min_amount`` applies only when the document amount reaches it;
the engine starts at the first step that applies and advances to the next one
that applies, skipping the rest. An unknown amount keeps every step, because
skipping an approval for want of a number is the unsafe direction.
"""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.approval_routes.queue import decide_many
from app.modules.approval_routes.service import (
    first_applicable_ordinal,
    next_applicable_ordinal,
    step_applies,
)


def _step(ordinal: int, min_amount: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(ordinal=ordinal, min_amount=min_amount)


# PM always, MD from 200,000, board from 1,000,000.
CHAIN = [_step(1), _step(2, "200000"), _step(3, "1000000")]


@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        (Decimal("50000"), [1]),
        (Decimal("200000"), [1, 2]),
        (Decimal("199999.99"), [1]),
        (Decimal("2500000"), [1, 2, 3]),
        (None, [1, 2, 3]),
    ],
)
def test_the_amount_decides_which_steps_apply(amount, expected):
    assert [s.ordinal for s in CHAIN if step_applies(s, amount)] == expected


def test_a_small_document_finishes_after_the_first_step():
    assert first_applicable_ordinal(CHAIN, "50000") == 1
    assert next_applicable_ordinal(CHAIN, 1, Decimal("50000")) is None


def test_a_large_document_walks_every_step_it_reaches():
    amount = Decimal("1200000")
    assert first_applicable_ordinal(CHAIN, amount) == 1
    assert next_applicable_ordinal(CHAIN, 1, amount) == 2
    assert next_applicable_ordinal(CHAIN, 2, amount) == 3
    assert next_applicable_ordinal(CHAIN, 3, amount) is None


def test_a_skipped_middle_step_is_jumped_over():
    chain = [_step(1), _step(2, "500000"), _step(3)]
    assert next_applicable_ordinal(chain, 1, Decimal("10000")) == 3


def test_a_chain_where_nothing_applies_still_starts_somewhere():
    chain = [_step(1, "100"), _step(2, "200")]
    assert first_applicable_ordinal(chain, "5") == 1


async def test_a_rejection_without_a_reason_is_refused():
    with pytest.raises(HTTPException) as exc:
        await decide_many(
            None,  # type: ignore[arg-type] - refused before the session is touched
            instance_ids=[],
            decision="rejected",
            comment="   ",
            user_id="00000000-0000-0000-0000-000000000001",
            caller_role="admin",
            accessible_project_ids=None,
        )
    assert exc.value.status_code == 422
