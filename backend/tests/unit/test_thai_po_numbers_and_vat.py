"""Thai document numbers and VAT on purchase orders.

Numbers read ``<prefix><พ.ศ. yy><mm>-<nnnn>`` with the month taken in Bangkok
time. VAT splits the lines into net / VAT / total for the order's mode,
rounded to satang half up, with net + VAT always equal to the total.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal as D

import pytest
from pydantic import ValidationError

from app.core.thai_doc_numbers import thai_period
from app.modules.procurement.schemas import POCreate, POUpdate
from app.modules.procurement.service import compute_vat


def test_the_period_uses_the_buddhist_year():
    assert thai_period(datetime(2026, 10, 12, tzinfo=UTC)) == "6910"
    assert thai_period(datetime(2027, 1, 5, tzinfo=UTC)) == "7001"


def test_the_month_turns_over_in_bangkok_time():
    # 30 Sep 18:00 UTC is 1 Oct 01:00 in Bangkok, so the document is October's.
    assert thai_period(datetime(2026, 9, 30, 18, 0, tzinfo=UTC)) == "6910"
    assert thai_period(datetime(2026, 9, 30, 16, 0, tzinfo=UTC)) == "6909"


@pytest.mark.parametrize(
    ("lines", "mode", "expected"),
    [
        ("46260", "exclusive", ("46260.00", "3238.20", "49498.20")),
        ("49498.20", "inclusive", ("46260.00", "3238.20", "49498.20")),
        ("1000", "inclusive", ("934.58", "65.42", "1000.00")),
        ("10.05", "exclusive", ("10.05", "0.70", "10.75")),
        ("1000", "none", ("1000.00", "0.00", "1000.00")),
        ("1000", None, ("1000.00", "0.00", "1000.00")),
    ],
)
def test_vat_splits_the_lines(lines, mode, expected):
    net, vat, total = compute_vat(D(lines), mode, D("7"))
    assert (str(net), str(vat), str(total)) == expected
    assert net + vat == total


def test_a_zero_rate_charges_nothing():
    assert compute_vat(D("500"), "exclusive", D("0")) == (D("500.00"), D("0.00"), D("500.00"))


def test_vat_mode_and_rate_are_validated():
    ok = POCreate(project_id="00000000-0000-0000-0000-000000000001", vat_mode="inclusive", vat_rate="7.00")
    assert ok.vat_rate == "7"
    with pytest.raises(ValidationError):
        POCreate(project_id="00000000-0000-0000-0000-000000000001", vat_mode="sometimes")
    with pytest.raises(ValidationError):
        POUpdate(vat_rate="120")
    with pytest.raises(ValidationError):
        POUpdate(vat_rate="-1")
