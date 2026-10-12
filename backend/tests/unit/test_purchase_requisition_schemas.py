"""Purchase requisition (ใบขอซื้อ) input rules.

A PR needs a title and at least one line; a line needs a positive quantity
and a non-negative estimate. Turning it into a PO takes a vendor and per-line
prices that are numbers. The requisition kind is routable in the approval
center like any other document.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.modules.approval_routes.models import TARGET_KINDS
from app.modules.procurement.schemas import RequisitionCreate, RequisitionItemIn, RequisitionToPO, RequisitionToPOLine

PROJECT = uuid.uuid4()


def _line(**kw):
    return {"description": "เหล็กเสริม DB12", "unit": "เส้น", "quantity_requested": "200", "unit_cost": "245", **kw}


def test_a_requisition_with_lines_is_accepted():
    pr = RequisitionCreate(project_id=PROJECT, title="งานฐานราก", items=[_line()])
    assert pr.items[0].quantity_requested == "200"


def test_a_requisition_needs_at_least_one_line():
    with pytest.raises(ValidationError):
        RequisitionCreate(project_id=PROJECT, title="งานฐานราก", items=[])


def test_a_requisition_needs_a_title():
    with pytest.raises(ValidationError):
        RequisitionCreate(project_id=PROJECT, title="  ", items=[_line()])


@pytest.mark.parametrize("qty", ["0", "-1", "abc"])
def test_a_line_needs_a_positive_quantity(qty):
    with pytest.raises(ValidationError):
        RequisitionItemIn(**_line(quantity_requested=qty))


def test_a_negative_estimate_is_refused():
    with pytest.raises(ValidationError):
        RequisitionItemIn(**_line(unit_cost="-5"))


def test_turning_into_a_po_needs_a_vendor_and_numeric_prices():
    with pytest.raises(ValidationError):
        RequisitionToPO(vendor_contact_id="")
    with pytest.raises(ValidationError):
        RequisitionToPOLine(item_id=uuid.uuid4(), unit_rate="cheap")
    ok = RequisitionToPO(vendor_contact_id=str(uuid.uuid4()), lines=[{"item_id": uuid.uuid4(), "unit_rate": "238.5"}])
    assert ok.lines[0].unit_rate == "238.5"


def test_requisitions_are_routable_in_the_approval_center():
    assert "purchase_requisition" in TARGET_KINDS
