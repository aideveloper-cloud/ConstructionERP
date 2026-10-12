"""Thai VAT on purchase orders: ``vat_mode`` and ``vat_rate``.

``vat_mode`` is how the line prices were entered ("exclusive", "inclusive",
"none"); ``vat_rate`` the percent. Nullable, added only when missing, so a
database the boot-time column healer already touched upgrades cleanly; NULL
keeps an existing order on the old behaviour (tax_amount as entered).

Revision ID: v66_po_vat_mode
Revises: v65_user_employee_code
"""

import sqlalchemy as sa
from alembic import op

revision = "v66_po_vat_mode"
down_revision = "v65_user_employee_code"
branch_labels = None
depends_on = None

_TABLE = "oe_procurement_po"
_COLUMNS = (("vat_mode", sa.String(16)), ("vat_rate", sa.String(10)))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(_TABLE):
        return
    have = {c["name"] for c in inspector.get_columns(_TABLE)}
    for name, type_ in _COLUMNS:
        if name not in have:
            op.add_column(_TABLE, sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(_TABLE):
        return
    have = {c["name"] for c in inspector.get_columns(_TABLE)}
    for name, _type in reversed(_COLUMNS):
        if name in have:
            op.drop_column(_TABLE, name)
