"""
Duffel API integration for flights (Air) and hotels (Stays).
https://duffel.com/docs
"""
import logging
from typing import Optional
from datetime import date

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

DUFFEL_BASE = "https://api.duffel.com"
DUFFEL_VERSION = "v2"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.DUFFEL_ACCESS_TOKEN}",
        "Duffel-Version": DUFFEL_VERSION,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _client() -> httpx.Client:
    return httpx.Client(base_url=DUFFEL_BASE, headers=_headers(), timeout=30.0)


# ─── FLIGHTS ───────────────────────────────────────────────────────────────────

def search_flights(
    origin: str,
    destination: str,
    departure_date: date,
    passengers: int = 1,
    cabin_class: str = "economy",
    return_date: Optional[date] = None,
) -> list[dict]:
    """
    Create a Duffel offer request and return the list of offers.
    Sorted by total_amount ascending.
    """
    slices = [{"origin": origin, "destination": destination, "departure_date": str(departure_date)}]
    if return_date:
        slices.append({"origin": destination, "destination": origin, "departure_date": str(return_date)})

    payload = {
        "data": {
            "slices": slices,
            "passengers": [{"type": "adult"} for _ in range(passengers)],
            "cabin_class": cabin_class,
        }
    }

    with _client() as client:
        # Step 1: Create offer request
        resp = client.post("/air/offer_requests?return_offers=true", json=payload)
        resp.raise_for_status()
        data = resp.json()["data"]

        offers = data.get("offers", [])
        # If return_offers=true didn't include offers, fetch them separately
        if not offers:
            offer_request_id = data["id"]
            offers_resp = client.get(f"/air/offers?offer_request_id={offer_request_id}&limit=50")
            offers_resp.raise_for_status()
            offers = offers_resp.json()["data"]

    # Sort by price
    offers.sort(key=lambda o: float(o.get("total_amount", "999999")))
    return offers[:20]  # return top 20


def get_flight_offer(offer_id: str) -> dict:
    """Refresh a single offer (price/availability may change)."""
    with _client() as client:
        resp = client.get(f"/air/offers/{offer_id}")
        resp.raise_for_status()
        return resp.json()["data"]


def create_flight_order(offer_id: str, passengers: list[dict], trip_id: str) -> dict:
    """
    Book a Duffel flight offer. passengers should be a list of Duffel passenger dicts.
    Returns the Duffel order object.
    """
    # First refresh the offer to get current price
    offer = get_flight_offer(offer_id)
    total_amount = offer.get("total_amount")
    currency = offer.get("total_currency", "USD")

    # Build passengers with offer passenger IDs
    offer_passengers = offer.get("passengers", [])
    duffel_passengers = []
    for i, p in enumerate(passengers):
        if i >= len(offer_passengers):
            break
        # Duffel requires "m"/"f", not "male"/"female"
        gender_raw = p.get("gender", "male")
        duffel_gender = "m" if gender_raw in ("male", "m") else "f"
        # Duffel requires E.164 phone — strip spaces and dashes
        phone = p["phone_number"].replace(" ", "").replace("-", "")
        duffel_passengers.append({
            "id": offer_passengers[i]["id"],
            "title": p.get("title", "mr"),
            "given_name": p["given_name"],
            "family_name": p["family_name"],
            "gender": duffel_gender,
            "born_on": str(p["born_on"]),
            "email": p["email"],
            "phone_number": phone,
        })

    payload = {
        "data": {
            "type": "instant",
            "selected_offers": [offer_id],
            "passengers": duffel_passengers,
            "payments": [{"type": "balance", "amount": total_amount, "currency": currency}],
        }
    }

    with _client() as client:
        resp = client.post("/air/orders", json=payload)
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error(f"Duffel /air/orders {resp.status_code}: {detail}")
            # Detect stale offer — offer request was already used in a prior attempt
            errors = detail.get("errors", []) if isinstance(detail, dict) else []
            if any(e.get("code") == "offer_request_already_booked" for e in errors):
                raise StaleOfferError("This flight offer has expired. Please search again for fresh results.")
            raise ValueError(f"Duffel {resp.status_code}: {detail}")
        return resp.json()["data"]


class StaleOfferError(Exception):
    """Raised when the Duffel offer request has already been used and can't be rebooked."""
    pass


def cancel_flight_order(duffel_order_id: str) -> bool:
    """Request order cancellation. Returns True if cancellation was created."""
    with _client() as client:
        resp = client.post("/air/order_cancellations", json={"data": {"order_id": duffel_order_id}})
        if resp.status_code not in (200, 201):
            logger.error(f"Duffel cancellation failed: {resp.text}")
            return False
        cancellation = resp.json()["data"]

        # Confirm cancellation
        cancellation_id = cancellation["id"]
        confirm_resp = client.post(f"/air/order_cancellations/{cancellation_id}/actions/confirm")
        return confirm_resp.status_code in (200, 201)


# ─── HOTELS (DUFFEL STAYS) ─────────────────────────────────────────────────────

def search_hotels(
    location: str,
    check_in: date,
    check_out: date,
    guests: int = 1,
    rooms: int = 1,
) -> list[dict]:
    """Search Duffel Stays for accommodation."""
    payload = {
        "data": {
            "location": {"name": location},
            "check_in_date": str(check_in),
            "check_out_date": str(check_out),
            "guests": guests,
            "rooms": rooms,
        }
    }

    with _client() as client:
        resp = client.post("/stays/searches", json=payload)
        resp.raise_for_status()
        data = resp.json()["data"]

    results = data.get("results", [])
    # Sort by cheapest rate
    results.sort(key=lambda r: float(r.get("cheapest_rate_total_amount", "999999")))
    return results[:20]


def get_hotel_rate(rate_id: str) -> dict:
    """Get a confirmed hotel rate (quote) before booking."""
    with _client() as client:
        resp = client.get(f"/stays/quotes/{rate_id}")
        resp.raise_for_status()
        return resp.json()["data"]


def create_hotel_order(rate_id: str, guests: list[dict], trip_id: str) -> dict:
    """Book a hotel rate. Returns Duffel booking object."""
    rate = get_hotel_rate(rate_id)

    payload = {
        "data": {
            "quote_id": rate_id,
            "guests": guests,
            "payment": {
                "type": "balance",
                "amount": rate["total_amount"],
                "currency": rate["currency"],
            },
        }
    }

    with _client() as client:
        resp = client.post("/stays/bookings", json=payload)
        resp.raise_for_status()
        return resp.json()["data"]
