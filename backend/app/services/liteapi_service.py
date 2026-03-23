"""
LiteAPI hotel search and booking.
Docs: https://docs.liteapi.travel
B2B model: payment deducted from your LiteAPI account balance — no card details needed.
"""
import logging
from datetime import date

import httpx

from app.core.config import settings

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

    results = []
    for hotel_rates in rates_data:
        hid = hotel_rates.get("hotelId")
        room_types = hotel_rates.get("roomTypes", [])
        if not room_types:
            continue
        if logger.isEnabledFor(logging.DEBUG) and hotel_rates == rates_data[0]:
            logger.debug(f"LiteAPI room_type[0] sample: {str(room_types[0])[:400]}")
        # Pick the cheapest room type
        cheapest = min(room_types, key=lambda r: float(_rate_total(r).get("amount", "999999")))
        rate_total = _rate_total(cheapest)
        meta = hotel_meta.get(hid, {})
        thumbnail = meta.get("thumbnail", "") or meta.get("main_photo", "")
        results.append({
            "id": f"liteapi_hotel_{cheapest['offerId']}",
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
            },
            "cheapest_rate_total_amount": str(rate_total.get("amount", "0")),
            "cheapest_rate_currency": rate_total.get("currency", "USD"),
        })

    results.sort(key=lambda r: float(r["cheapest_rate_total_amount"] or "999999"))
    return results[:20]


def prebook_hotel(offer_id: str) -> str:
    """
    Pre-book the offer and return the prebookId required for the final book call.
    offer_id: full prefixed ID like "liteapi_hotel_RATE_ID"
    """
    raw_offer_id = offer_id.removeprefix("liteapi_hotel_")
    with _client() as client:
        resp = client.post(
            "/book/prebook",
            json={"offerId": raw_offer_id, "usePaymentSdk": False},
        )
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error(f"LiteAPI /book/prebook {resp.status_code}: {detail}")
            raise ValueError(f"LiteAPI prebook {resp.status_code}: {detail}")
        logger.debug(f"LiteAPI /book/prebook raw body: {resp.text[:500]}")
        if not resp.text.strip():
            raise ValueError(f"LiteAPI prebook returned empty body (status {resp.status_code})")
        data = resp.json().get("data", {})
        prebook_id = data.get("prebookId")
        if not prebook_id:
            raise ValueError(f"LiteAPI prebook returned no prebookId: {data}")
        return prebook_id


def create_hotel_order(offer_id: str, guests: list[dict]) -> dict:
    """
    Book a LiteAPI hotel. Uses account-balance payment (B2B model — no card needed).
    guests: list of dicts with given_name, family_name, email.
    """
    prebook_id = prebook_hotel(offer_id)
    # Use first guest as primary contact
    primary = guests[0] if guests else {}

    with _client() as client:
        resp = client.post(
            "/book/book",
            json={
                "prebookId": prebook_id,
                "guestInfo": {
                    "guestFirstName": primary.get("given_name", ""),
                    "guestLastName": primary.get("family_name", ""),
                    "guestEmail": primary.get("email", ""),
                },
            },
        )
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error(f"LiteAPI /book/book {resp.status_code}: {detail}")
            resp.raise_for_status()
        data = resp.json().get("data", {})

    booking = data.get("booking", data)
    return {
        "id": booking.get("bookingId") or booking.get("id"),
        "reference": booking.get("bookingReference") or booking.get("reference"),
        "total_amount": str(booking.get("totalAmount") or booking.get("total", "0")),
        "currency": booking.get("currency", "USD"),
        "provider": "liteapi",
        "raw": data,
    }
