"""The Thai edition's module scope.

CI runs the suite with ``OE_ALL_MODULES=1`` so the modules the Thai edition
leaves unloaded keep their tests. That leaves the edition's own default, which
is what a Thai install runs, to be checked here with the switch taken away.
"""

from __future__ import annotations

import pytest

from app.core.thai_doc_numbers import thai_numbers_active
from app.core.thai_edition import THAI_EDITION_CUT_MODULES, is_cut, thai_edition_active


@pytest.fixture
def thai_default(monkeypatch):
    monkeypatch.delenv("OE_ALL_MODULES", raising=False)


def test_the_thai_edition_is_the_default(thai_default):
    assert thai_edition_active()
    assert thai_numbers_active()


def test_modules_outside_the_scope_are_cut(thai_default):
    assert is_cut("oe_clash")
    assert is_cut("compliance_ai")
    for kept in ("oe_users", "oe_projects", "oe_boq", "oe_procurement", "oe_finance", "oe_tax_withholding"):
        assert not is_cut(kept), kept
    assert not THAI_EDITION_CUT_MODULES & {"users", "projects", "procurement", "finance", "approval_routes"}


@pytest.mark.parametrize("value", ["1", "true", "YES"])
def test_all_modules_switch_loads_everything(monkeypatch, value):
    monkeypatch.setenv("OE_ALL_MODULES", value)
    assert not thai_edition_active()
    assert not thai_numbers_active()
    assert not is_cut("oe_clash")
