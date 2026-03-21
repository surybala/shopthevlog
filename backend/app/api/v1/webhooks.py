import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Request, HTTPException

from app.core.config import settings
from app.db.client import get_supabase

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


@router.post("/duffel")
async def duffel_webhook(request: Request):
    """Handle Duffel order status webhooks."""
    body = await request.body()

    # Verify signature
    sig = request.headers.get("Duffel-Signature", "")
    if settings.DUFFEL_WEBHOOK_SECRET:
        expected = hmac.new(
            settings.DUFFEL_WEBHOOK_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(f"sha256={expected}", sig):
            raise HTTPException(status_code=401, detail="Invalid signature")

    payload = json.loads(body)
    event_type = payload.get("type", "")
    data = payload.get("data", {})

    db = get_supabase()

    if event_type in ("order.updated", "order.cancelled"):
        duffel_order_id = data.get("id")
        if duffel_order_id:
            new_status = "cancelled" if "cancelled" in event_type else "confirmed"
            db.table("bookings").update({"status": new_status}).eq("duffel_order_id", duffel_order_id).execute()
            logger.info(f"Duffel webhook: {event_type} for order {duffel_order_id}")

    return {"ok": True}
