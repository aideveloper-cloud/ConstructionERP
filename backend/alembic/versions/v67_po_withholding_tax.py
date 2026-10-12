"""Thai withholding tax (หัก ณ ที่จ่าย) on purchase orders.

``oe_procurement_po``: ``wht_type``, ``wht_rate``, ``wht_base``, ``wht_amount``.
``oe_procurement_po_item``: ``wht_applies`` - the line is service / labour and
part of the withholding base. All nullable, added only when missing, so a
database the boot-time column healer already touched upgrades cleanly.

Revision ID: v67_po_withholding_tax
Revises: v66_po_vat_mode
"""

import sqlalchemy as sa
from alembic import op

revision = "v67_po_withholding_tax"
down_revision = "v66_po_vat_mode"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("oe_procurement_po", "wht_type", sa.String(32)),
    ("oe_procurement_po", "wht_rate", sa.String(10)),
    ("oe_procurement_po", "wht_base", sa.String(50)),
    ("oe_procurement_po", "wht_amount", sa.String(50)),
    ("oe_procurement_po_item", "wht_applies", sa.Boolean()),
)


def _has(inspector, table: str, column: str) -> bool | None:
    if not inspector.has_table(table):
        return None
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, type_ in _COLUMNS:
        if _has(inspector, table, column) is False:
            op.add_column(table, sa.Column(column, type_, nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, _type in reversed(_COLUMNS):
        if _has(inspector, table, column):
            op.drop_column(table, column)
