# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Users & Authentication module.

Provides user registration, JWT auth, API keys, and RBAC.
"""


async def on_startup() -> None:
    """Module startup hook - register permissions."""
    from app.modules.users.permissions import register_user_permissions

    register_user_permissions()

    # K Garden central access: follow access changes made in ERPNext (no-op while disabled).
    from app.modules.users.kgarden_access import start_watcher

    start_watcher()
