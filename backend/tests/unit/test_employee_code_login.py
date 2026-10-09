"""Employee ID login (Thai edition).

Staff sign in with their employee ID (รหัสพนักงาน) as well as by email. The
code is stored upper-case and trimmed so a login is not case sensitive, an
admin may create a person with a code and no email, and a user needs at least
one of the two to be able to sign in at all.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.modules.users.schemas import (
    AdminUserCreate,
    UserAdminUpdate,
    normalize_employee_code,
    validate_employee_code,
)

PASSWORD = "SitePass2026x"


@pytest.mark.parametrize(
    ("raw", "stored"),
    [("emp001", "EMP001"), ("  EMP-01.a ", "EMP-01.A"), ("", None), ("   ", None), (None, None)],
)
def test_codes_are_stored_upper_case_and_trimmed(raw, stored):
    assert normalize_employee_code(raw) == stored


@pytest.mark.parametrize("bad", ["ส001", "a b", "x@y", "-lead", "A" * 51])
def test_codes_outside_the_allowed_characters_are_refused(bad):
    with pytest.raises(ValueError):
        validate_employee_code(bad)


def test_staff_can_be_created_with_a_code_and_no_email():
    data = AdminUserCreate(employee_code="emp001", password=PASSWORD, full_name="Somchai")
    assert data.employee_code == "EMP001"
    assert data.email is None


def test_a_user_needs_an_email_or_a_code():
    with pytest.raises(ValidationError):
        AdminUserCreate(password=PASSWORD, full_name="Nobody")


def test_an_admin_can_clear_a_code_with_an_empty_string():
    assert UserAdminUpdate(employee_code="").employee_code == ""
    assert UserAdminUpdate(employee_code="pm001").employee_code == "PM001"
