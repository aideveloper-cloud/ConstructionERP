"""Seed the Thai edition approval center with routes and demo approvals.

Usage (backend running):
    python scripts/seed_th_approvals.py [--base http://localhost:8000]
        [--email demo@openconstructionerp.com] [--password DemoPass1234!]

Creates company-wide approval routes (idempotent by name) with Mango-style
amount limits, then sends a handful of draft documents for approval so the
approval center has something to show. Safe to run twice: existing routes are
kept and documents that already have a pending approval are skipped (409).
"""

from __future__ import annotations

import argparse
import sys

import httpx

ROUTES = [
    {
        "name": "อนุมัติใบขอซื้อ (PR)",
        "target_kind": "purchase_requisition",
        "steps": [
            {"ordinal": 1, "approver_role": "manager", "mode": "any", "sla_hours": 24},
            {"ordinal": 2, "approver_role": "admin", "mode": "any", "sla_hours": 48, "min_amount": "100000"},
        ],
    },
    {
        "name": "อนุมัติใบสั่งซื้อ (PO)",
        "target_kind": "purchase_order",
        "steps": [
            {"ordinal": 1, "approver_role": "manager", "mode": "any", "sla_hours": 24},
            {"ordinal": 2, "approver_role": "admin", "mode": "any", "sla_hours": 48, "min_amount": "200000"},
        ],
    },
    {
        "name": "อนุมัติใบสั่งเปลี่ยนแปลงงาน (VO)",
        "target_kind": "change_order",
        "steps": [
            {"ordinal": 1, "approver_role": "manager", "mode": "any", "sla_hours": 48},
            {"ordinal": 2, "approver_role": "admin", "mode": "any", "sla_hours": 72, "min_amount": "500000"},
        ],
    },
    {
        "name": "อนุมัติงวดงาน (เบิกเงินงวด)",
        "target_kind": "progress_claim",
        "steps": [
            {"ordinal": 1, "approver_role": "manager", "mode": "any", "sla_hours": 48},
            {"ordinal": 2, "approver_role": "admin", "mode": "any", "sla_hours": 48},
        ],
    },
    {
        "name": "อนุมัติใบแจ้งหนี้/ตั้งเบิก",
        "target_kind": "invoice",
        "steps": [
            {"ordinal": 1, "approver_role": "manager", "mode": "any", "sla_hours": 24},
            {"ordinal": 2, "approver_role": "admin", "mode": "any", "sla_hours": 48, "min_amount": "100000"},
        ],
    },
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--email", default="demo@openconstructionerp.com")
    ap.add_argument("--password", default="DemoPass1234!")
    ap.add_argument("--per-kind", type=int, default=3)
    args = ap.parse_args()

    c = httpx.Client(base_url=args.base, timeout=60)
    tok = c.post("/api/v1/users/auth/login/", json={"email": args.email, "password": args.password}).json()
    c.headers["Authorization"] = f"Bearer {tok['access_token']}"

    existing = {r["name"] for r in c.get("/api/v1/approval-routes/routes").json()}
    for route in ROUTES:
        if route["name"] in existing:
            print("route exists:", route["name"])
            continue
        r = c.post("/api/v1/approval-routes/routes", json={**route, "project_id": None, "is_active": True})
        print("route", route["name"], r.status_code, "" if r.is_success else r.text[:200])

    projects = c.get("/api/v1/projects/", params={"limit": 50}).json()
    projects = projects.get("items", projects) if isinstance(projects, dict) else projects

    def items(resp: httpx.Response) -> list[dict]:
        data = resp.json() if resp.is_success else []
        return data.get("items", data) if isinstance(data, dict) else data

    candidates: dict[str, list[str]] = {"purchase_order": [], "change_order": [], "progress_claim": [], "invoice": []}
    for p in projects:
        pid = p["id"]
        for po in items(c.get("/api/v1/procurement/", params={"project_id": pid, "limit": 100})):
            if po.get("status") == "draft":
                candidates["purchase_order"].append(po["id"])
        for co in items(c.get("/api/v1/changeorders/", params={"project_id": pid})):
            if co.get("status") in ("draft", "submitted"):
                candidates["change_order"].append(co["id"])
        for inv in items(c.get("/api/v1/finance/", params={"project_id": pid, "limit": 100})):
            if inv.get("status") == "draft":
                candidates["invoice"].append(inv["id"])
        for ct in items(c.get("/api/v1/contracts/contracts/", params={"project_id": pid})):
            for cl in items(c.get("/api/v1/contracts/progress-claims/", params={"contract_id": ct["id"]})):
                if cl.get("status") in ("draft", "submitted"):
                    candidates["progress_claim"].append(cl["id"])

    for kind, ids in candidates.items():
        sent = 0
        for tid in ids:
            if sent >= args.per_kind:
                break
            r = c.post("/api/v1/approval-routes/queue/submit", json={"target_kind": kind, "target_id": tid})
            if r.status_code == 201:
                sent += 1
            elif r.status_code != 409:
                print("submit", kind, tid, r.status_code, r.text[:200])
        print(f"{kind}: {len(ids)} candidates, sent {sent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
