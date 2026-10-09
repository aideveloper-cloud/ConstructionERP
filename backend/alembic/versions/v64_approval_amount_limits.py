"""Approval limits by amount (Thai edition approval center).

``oe_approval_routes_step.min_amount``: a step applies only when the document
amount reaches it (an MD step behind "over 200,000"). ``amount`` and
``currency`` on ``oe_approval_routes_instance`` snapshot the document amount
when the workflow starts. All nullable, added only when missing, so a
database the boot-time column healer already touched upgrades cleanly.

Revision ID: v64_approval_amount_limits
Revises: v63_contact_party_kind
"""

import sqlalchemy as sa
from alembic import op

revision = "v64_approval_amount_limits"
down_revision = "v63_contact_party_kind"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("oe_approval_routes_step", "min_amount", sa.String(50)),
    ("oe_approval_routes_instance", "amount", sa.String(50)),
    ("oe_approval_routes_instance", "currency", sa.String(10)),
)


def _has_column(inspector, table: str, column: str) -> bool | None:
    if not inspector.has_table(table):
        return None
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, type_ in _COLUMNS:
        if _has_column(inspector, table, column) is False:
            op.add_column(table, sa.Column(column, type_, nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, _type in reversed(_COLUMNS):
        if _has_column(inspector, table, column):
            op.drop_column(table, column)
