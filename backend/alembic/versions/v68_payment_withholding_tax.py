"""Thai withholding tax (หัก ณ ที่จ่าย) on payments.

``oe_finance_payment``: ``wht_type``, ``wht_rate``, ``wht_amount``,
``wht_certificate_no``. The payer deducts WHT when it pays and remits it on
ภ.ง.ด.3 / 53; the invoice is settled by the cash paid plus the WHT. Added only
when missing, so a database the boot-time column healer already touched
upgrades cleanly.

Revision ID: v68_payment_withholding_tax
Revises: v67_po_withholding_tax
"""

import sqlalchemy as sa
from alembic import op

revision = "v68_payment_withholding_tax"
down_revision = "v67_po_withholding_tax"
branch_labels = None
depends_on = None

_TABLE = "oe_finance_payment"
_COLUMNS = (
    ("wht_type", sa.String(32), {"nullable": True}),
    ("wht_rate", sa.String(10), {"nullable": True}),
    ("wht_amount", sa.Numeric(18, 2), {"nullable": False, "server_default": "0"}),
    ("wht_certificate_no", sa.String(50), {"nullable": True}),
)


def _columns(inspector) -> set[str] | None:
    if not inspector.has_table(_TABLE):
        return None
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    have = _columns(sa.inspect(op.get_bind()))
    if have is None:
        return
    for column, type_, options in _COLUMNS:
        if column not in have:
            op.add_column(_TABLE, sa.Column(column, type_, **options))


def downgrade() -> None:
    have = _columns(sa.inspect(op.get_bind())) or set()
    for column, _type, _options in reversed(_COLUMNS):
        if column in have:
            op.drop_column(_TABLE, column)
