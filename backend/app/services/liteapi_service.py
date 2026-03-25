"""
LiteAPI hotel search and booking.
Docs: https://docs.liteapi.travel
B2B model: payment deducted from your LiteAPI account balance — no card details needed.
"""
import logging
from datetime import date

import httpx

from app.core.config import settings
from app.core.exceptions import StaleOfferError

logger = logging.getLogger(__name__)

LITEAPI_BASE = "https://api.liteapi.travel/v3.0"


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=LITEAPI_BASE,
        headers={
            "X-API-Key": settings.LITEAPI_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        timeout=30.0,
    )


# ─── City → ISO country code ──────────────────────────────────────────────────

_COUNTRY_CODES: dict[str, str] = {
    # US (high priority)
    "new york": "US", "new york city": "US", "nyc": "US",
    "los angeles": "US", "san francisco": "US", "chicago": "US",
    "miami": "US", "las vegas": "US", "seattle": "US", "boston": "US",
    "washington": "US", "atlanta": "US", "dallas": "US", "houston": "US",
    "denver": "US", "orlando": "US", "nashville": "US", "portland": "US",
    "new orleans": "US", "san diego": "US", "honolulu": "US",
    "phoenix": "US", "philadelphia": "US", "austin": "US",
    # India (high priority)
    "delhi": "IN", "new delhi": "IN",
    "mumbai": "IN", "bombay": "IN",
    "bangalore": "IN", "bengaluru": "IN",
    "hyderabad": "IN", "chennai": "IN", "madras": "IN",
    "kolkata": "IN", "calcutta": "IN",
    "pune": "IN", "jaipur": "IN", "agra": "IN", "goa": "IN",
    "kochi": "IN", "cochin": "IN", "varanasi": "IN",
    "ahmedabad": "IN", "surat": "IN", "udaipur": "IN",
    "chandigarh": "IN", "amritsar": "IN", "rishikesh": "IN",
    "shimla": "IN", "manali": "IN", "darjeeling": "IN",
    # Rest of world
    "london": "GB", "paris": "FR", "tokyo": "JP", "osaka": "JP",
    "seoul": "KR", "beijing": "CN", "shanghai": "CN",
    "rome": "IT", "milan": "IT", "berlin": "DE",
    "amsterdam": "NL", "barcelona": "ES", "madrid": "ES",
    "lisbon": "PT", "vienna": "AT", "prague": "CZ",
    "istanbul": "TR", "athens": "GR", "dubai": "AE",
    "singapore": "SG", "bangkok": "TH", "hong kong": "HK",
    "sydney": "AU", "melbourne": "AU", "toronto": "CA", "montreal": "CA",
    "bali": "ID", "jakarta": "ID", "kuala lumpur": "MY",
    "taipei": "TW", "ho chi minh": "VN", "hanoi": "VN",
    "manila": "PH", "cairo": "EG", "nairobi": "KE",
    "cape town": "ZA", "johannesburg": "ZA",
    "mexico city": "MX", "cancun": "MX",
    "buenos aires": "AR", "sao paulo": "BR", "rio de janeiro": "BR",
    "lima": "PE", "bogota": "CO", "zurich": "CH",
    "stockholm": "SE", "copenhagen": "DK", "oslo": "NO",
}

def _country_code(location: str) -> str:
    key = location.strip().split(",")[0].strip().lower()
    return _COUNTRY_CODES.get(key, "US")  # default to US

def _city_name(location: str) -> str:
    """Extract just the city part (before comma)."""
    return location.strip().split(",")[0].strip()


# ─── HOTELS ───────────────────────────────────────────────────────────────────

def search_hotels(
    location: str,
    check_in: date,
    check_out: date,
    guests: int = 1,
    rooms: int = 1,
) -> list[dict]:
    """
    Two-step search: get hotel list for city, then fetch rates.
    Returns normalized HotelOffer dicts.
    """
    country = _country_code(location)
    city = _city_name(location)
    logger.info(f"LiteAPI search: location={location!r} → city={city!r}, country={country}")

    with _client() as client:
        # Step 1: get hotels in city
        hotels_resp = client.get(
            "/data/hotels",
            params={"countryCode": country, "cityName": city, "limit": 30},
        )
        if not hotels_resp.is_success:
            logger.error(f"LiteAPI /data/hotels {hotels_resp.status_code}: {hotels_resp.text}")
            hotels_resp.raise_for_status()

        hotels_raw = hotels_resp.json()
        logger.debug(f"LiteAPI /data/hotels response keys: {list(hotels_raw.keys())}, sample: {str(hotels_raw)[:300]}")
        hotels_data = hotels_raw.get("data", [])
        logger.info(f"LiteAPI /data/hotels: {len(hotels_data)} hotels returned")
        if not hotels_data:
            return []

        # Build a lookup dict id → hotel metadata
        hotel_meta: dict[str, dict] = {h["id"]: h for h in hotels_data}
        hotel_ids = list(hotel_meta.keys())[:30]

        # Step 2: get rates
        rates_resp = client.post(
            "/hotels/rates",
            json={
                "hotelIds": hotel_ids,
                "checkin": str(check_in),
                "checkout": str(check_out),
                "currency": "USD",
                "guestNationality": country,
                "occupancies": [{"adults": guests, "children": []} for _ in range(rooms)],
            },
        )
        if not rates_resp.is_success:
            logger.error(f"LiteAPI /hotels/rates {rates_resp.status_code}: {rates_resp.text}")
            rates_resp.raise_for_status()

        rates_raw = rates_resp.json()
        logger.debug(f"LiteAPI /hotels/rates response keys: {list(rates_raw.keys())}, sample: {str(rates_raw)[:300]}")
        rates_data = rates_raw.get("data", [])
        logger.info(f"LiteAPI /hotels/rates: {len(rates_data)} hotels with rates")

    def _rate_total(room_type: dict) -> dict:
        """Extract the cheapest rate total, handling both dict and list shapes for 'rates'."""
        rates = room_type.get("rates", {})
        if isinstance(rates, list):
            rates = rates[0] if rates else {}
        retail = rates.get("retailRate", {})
        if isinstance(retail, list):
            retail = retail[0] if retail else {}
        total = retail.get("total", [{"amount": "999999", "currency": "USD"}])
        if isinstance(total, list):
            return total[0] if total else {"amount": "999999", "currency": "USD"}
        return total if isinstance(total, dict) else {"amount": str(total), "currency": "USD"}

    nights = max((check_out - check_in).days, 1)

    def _normalize_room(rt: dict, is_cheapest: bool, currency: str) -> dict:
        """Normalize a single LiteAPI room type to our HotelRoomType shape."""
        rt_total = _rate_total(rt)
        total_amt = float(rt_total.get("amount", 0))
        room_currency = rt_total.get("currency", currency)

        # Detect free cancellation
        cancel_policies = rt.get("cancellationPolicies", [])
        is_free = False
        if cancel_policies:
            for p in cancel_policies:
                if isinstance(p, dict):
                    amt = p.get("amount", 1)
                    ptype = str(p.get("type", "")).upper()
                    if amt == 0 or "FREE" in ptype or "REFUNDABLE" in ptype:
                        is_free = True
                        break

        return {
            "id": f"liteapi_hotel_{rt.get('offerId', '')}",
            "name": (rt.get("name") or rt.get("roomName") or "Standard Room").strip(),
            "max_occupancy": rt.get("maxOccupancy"),
            "price_total": str(total_amt),
            "price_per_night": str(round(total_amt / nights, 2)),
            "currency": room_currency,
            "is_cheapest": is_cheapest,
            "cancellation_type": "free" if is_free else "non_refundable",
            "board_type": rt.get("boardType") or rt.get("mealPlan"),
        }

    results = []
    for hotel_rates in rates_data:
        hid = hotel_rates.get("hotelId")
        room_types = hotel_rates.get("roomTypes", [])
        if not room_types:
            continue
        if logger.isEnabledFor(logging.DEBUG) and hotel_rates == rates_data[0]:
            logger.debug(f"LiteAPI room_type[0] sample: {str(room_types[0])[:400]}")

        # Sort all room types by price; pick cheapest for the card summary
        sorted_rooms = sorted(
            room_types,
            key=lambda r: float(_rate_total(r).get("amount", "999999"))
        )
        cheapest = sorted_rooms[0]
        rate_total = _rate_total(cheapest)
        currency = rate_total.get("currency", "USD")

        meta = hotel_meta.get(hid, {})
        thumbnail = meta.get("thumbnail", "") or meta.get("main_photo", "")

        # Include up to 5 cheapest distinct room types
        normalized_rooms = [
            _normalize_room(rt, i == 0, currency)
            for i, rt in enumerate(sorted_rooms[:5])
            if rt.get("offerId")
        ]

        results.append({
            "id": f"liteapi_hotel_{cheapest['offerId']}",
            "hotel_id": hid,           # raw LiteAPI hotel ID for detail fetching
            "provider": "liteapi",
            "accommodation": {
                "name": meta.get("name", "Unknown Hotel"),
                "rating": meta.get("starRating") or meta.get("stars"),
                "photos": [{"url": thumbnail}] if thumbnail else [],
                "location": {
                    "geographic_coordinates": {
                        "latitude": meta.get("latitude"),
                        "longitude": meta.get("longitude"),
                    }
                },
                "address": meta.get("address", ""),
                "city": meta.get("city") or meta.get("cityName"),
                "country": meta.get("country") or meta.get("countryCode"),
            },
            "cheapest_rate_total_amount": str(rate_total.get("amount", "0")),
            "cheapest_rate_currency": currency,
            "room_types": normalized_rooms,
        })

    results.sort(key=lambda r: float(r["cheapest_rate_total_amount"] or "999999"))
    return results[:20]


def get_hotel_details(hotel_id: str) -> dict:
    """
    Fetch rich hotel detail from LiteAPI /data/hotel.
    Returns description, amenities, all photos, review score, check-in/out times.
    """
    with _client() as client:
        resp = client.get("/data/hotel", params={"hotelId": hotel_id})
        if not resp.is_success:
            logger.warning(f"LiteAPI /data/hotel {resp.status_code} for {hotel_id}: {resp.text[:200]}")
            resp.raise_for_status()
        data = resp.json().get("data", {})

    # ── Photos ────────────────────────────────────────────────────────────────
    photos = []
    for img in data.get("images", data.get("photos", [])):
        if isinstance(img, str):
            url = img
        elif isinstance(img, dict):
            url = (
                img.get("url") or img.get("link") or
                img.get("urlMax") or img.get("urlHd") or ""
            )
        else:
            url = ""
        if url:
            photos.append({"url": url})

    # Thumbnail fallback
    thumb = data.get("thumbnail") or data.get("main_photo")
    if thumb and not photos:
        photos.append({"url": thumb})

    # ── Amenities ─────────────────────────────────────────────────────────────
    amenities: list[str] = []
    for a in data.get("amenities", data.get("facilities", data.get("hotelFacilities", []))):
        if isinstance(a, str) and a.strip():
            amenities.append(a.strip().upper())
        elif isinstance(a, dict):
            code = a.get("code") or a.get("name") or a.get("description") or ""
            if code:
                amenities.append(str(code).strip().upper())

    # ── Review score ──────────────────────────────────────────────────────────
    review_score = data.get("reviewScore") or data.get("guestRating") or data.get("rating")
    review_count = data.get("reviewCount") or data.get("numberOfReviews") or data.get("reviewsCount")

    return {
        "hotel_id": hotel_id,
        "description": (
            data.get("description") or
            data.get("hotelDescription") or
            data.get("shortDescription") or ""
        ).strip(),
        "amenities": amenities,
        "photos": photos,
        "review_score": float(review_score) if review_score else None,
        "review_count": int(review_count) if review_count else None,
        "check_in_time": data.get("checkInTime") or data.get("hotelCheckInTime"),
        "check_out_time": data.get("checkOutTime") or data.get("hotelCheckOutTime"),
    }


def prebook_hotel(offer_id: str) -> str:
    """
    Pre-book the offer and return the prebookId required for the final book call.
    offer_id: full prefixed ID like "liteapi_hotel_RATE_ID"
    Endpoint: POST /rates/prebook  (NOT /book/prebook)
    """
    raw_offer_id = offer_id.removeprefix("liteapi_hotel_")
    logger.info(f"LiteAPI /rates/prebook → offerId={raw_offer_id!r}")
    with _client() as client:
        resp = client.post(
            "/rates/prebook",
            json={"offerId": raw_offer_id, "usePaymentSdk": False},
        )
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error(f"LiteAPI /rates/prebook {resp.status_code}: {detail}")
            raise ValueError(f"LiteAPI prebook {resp.status_code}: {detail}")
        logger.debug(f"LiteAPI /rates/prebook raw body: {resp.text[:500]}")
        if not resp.text.strip():
            logger.warning(f"LiteAPI prebook empty body (status {resp.status_code}) — treating as stale offer")
            raise StaleOfferError("This hotel offer is no longer available. Please search again for fresh results.")
        data = resp.json().get("data", {})
        prebook_id = data.get("prebookId")
        if not prebook_id:
            raise ValueError(f"LiteAPI prebook returned no prebookId: {data}")
        return prebook_id


def cancel_hotel_booking(booking_id: str) -> bool:
    """
    Cancel a LiteAPI hotel booking via DELETE /bookings/{bookingId}.
    Returns True on success. Raises ValueError on provider errors.
    A 404 means the booking is already cancelled — treated as success.
    """
    logger.info(f"LiteAPI cancel booking: bookingId={booking_id!r}")
    with _client() as client:
        resp = client.delete(f"/bookings/{booking_id}")
        if resp.status_code == 404:
            logger.warning(f"LiteAPI booking {booking_id} not found — already cancelled?")
            return True
        if not resp.is_success:
            try:
                detail = resp.json()
                msg = detail.get("message") or detail.get("error") or resp.text
            except Exception:
                msg = resp.text
            logger.error(f"LiteAPI DELETE /bookings/{booking_id} {resp.status_code}: {msg}")
            raise ValueError(f"LiteAPI declined the cancellation: {msg}")
        return True


def create_hotel_order(
    offer_id: str,
    guests: list[dict],
    prebook_id: str | None = None,
) -> dict:
    """
    Book a LiteAPI hotel. Uses account-credit payment (B2B model — no card needed).
    guests: list of dicts with given_name, family_name, email, phone_number.
    prebook_id: if already obtained (preferred — avoids offer expiry), skip the prebook step.
    Endpoint: POST /rates/book  (NOT /book/book)
    """
    if prebook_id is None:
        prebook_id = prebook_hotel(offer_id)
    # Use first guest as holder (primary contact)
    primary = guests[0] if guests else {}

    # Build the guests array — LiteAPI requires occupancyNumber (1-based room index)
    guests_payload = [
        {
            "occupancyNumber": idx + 1,
            "firstName": g.get("given_name", ""),
            "lastName":  g.get("family_name", ""),
            "email":     g.get("email", ""),
            "phone":     g.get("phone_number", ""),
        }
        for idx, g in enumerate(guests)
    ] if guests else [{"occupancyNumber": 1, "firstName": "", "lastName": "", "email": "", "phone": ""}]

    with _client() as client:
        resp = client.post(
            "/rates/book",
            json={
                "prebookId": prebook_id,
                "holder": {
                    "firstName": primary.get("given_name", ""),
                    "lastName":  primary.get("family_name", ""),
                    "email":     primary.get("email", ""),
                    "phone":     primary.get("phone_number", ""),
                },
                "guests":  guests_payload,
                "payment": {"method": "ACC_CREDIT_CARD"},
            },
        )
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error(f"LiteAPI /rates/book {resp.status_code}: {detail}")
            resp.raise_for_status()
        data = resp.json().get("data", {})

    # Normalise across possible response shapes
    booking_id  = data.get("bookingId") or data.get("confirmedBookingId") or data.get("id")
    reference   = data.get("bookingReference") or data.get("confirmedBookingId") or booking_id
    total       = data.get("price") or data.get("totalAmount") or data.get("total", "0")
    currency    = data.get("currency", "USD")
    return {
        "id":           booking_id,
        "reference":    reference,
        "total_amount": str(total),
        "currency":     currency,
        "provider":     "liteapi",
        "raw":          data,
    }
