"""Employee ID login (Thai edition): ``oe_users_user.employee_code``.

Staff sign in with their employee ID (รหัสพนักงาน) as well as by email. The
column is nullable (email-only accounts keep working) and unique, so one code
names one person. Added only when missing, so a database the boot-time column
healer already touched upgrades cleanly; the unique index is created on its
own for the same reason (the healer adds columns, not indexes).

Revision ID: v65_user_employee_code
Revises: v64_approval_amount_limits
"""

import sqlalchemy as sa
from alembic import op

revision = "v65_user_employee_code"
down_revision = "v64_approval_amount_limits"
branch_labels = None
depends_on = None

_TABLE = "oe_users_user"
_COLUMN = "employee_code"
_INDEX = "ix_oe_users_user_employee_code"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(_TABLE):
        return
    if _COLUMN not in {c["name"] for c in inspector.get_columns(_TABLE)}:
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.String(50), nullable=True))
    if _INDEX not in {i["name"] for i in inspector.get_indexes(_TABLE)}:
        op.create_index(_INDEX, _TABLE, [_COLUMN], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(_TABLE):
        return
    if _INDEX in {i["name"] for i in inspector.get_indexes(_TABLE)}:
        op.drop_index(_INDEX, table_name=_TABLE)
    if _COLUMN in {c["name"] for c in inspector.get_columns(_TABLE)}:
        op.drop_column(_TABLE, _COLUMN)
