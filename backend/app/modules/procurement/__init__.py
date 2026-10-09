# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Procurement module - purchase orders, goods receipts, vendor management."""


async def on_startup() -> None:
    """Module startup hook - register permissions."""
    from app.modules.procurement.approval_subscribers import register_procurement_approval_subscribers
    from app.modules.procurement.permissions import register_procurement_permissions

    register_procurement_permissions()
    # Thai edition approval center: a PO whose approval chain completes is
    # approved through the normal PO transition.
    register_procurement_approval_subscribers()
