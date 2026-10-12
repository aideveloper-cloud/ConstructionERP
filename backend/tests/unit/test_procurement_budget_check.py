"""Budget levels used by the purchase-requisition budget check."""

from decimal import Decimal

import pytest

from app.modules.procurement.budget_check import level_for, worst_level


@pytest.mark.parametrize(
    ("budget", "after", "level"),
    [
        ("1000", "0", "ok"),
        ("1000", "849.99", "ok"),
        ("1000", "850", "warning"),  # 85% is the warning line
        ("1000", "1000", "warning"),  # spending exactly the budget is not over
        ("1000", "1000.01", "over"),
        ("0", "10", "unbudgeted"),
        ("-5", "0", "unbudgeted"),
    ],
)
def test_level_for(budget: str, after: str, level: str) -> None:
    assert level_for(Decimal(budget), Decimal(after)) == level


def test_worst_level_ranks_over_highest() -> None:
    assert worst_level([]) == "ok"
    assert worst_level(["ok", "unbudgeted"]) == "unbudgeted"
    assert worst_level(["unbudgeted", "warning", "ok"]) == "warning"
    assert worst_level(["warning", "over", "ok"]) == "over"
