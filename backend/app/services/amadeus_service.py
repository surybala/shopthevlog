"""
Amadeus Self-Service API — hotels (search + book) + flights (search + book).
Docs: https://developers.amadeus.com/self-service/category/hotels
      https://developers.amadeus.com/self-service/category/flights
"""
import time
import logging
from typing import Optional
from datetime import date

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

AMADEUS_BASE_TEST = "https://test.api.amadeus.com"
AMADEUS_BASE_PROD = "https://api.amadeus.com"

def _base_url() -> str:
    return AMADEUS_BASE_PROD if settings.APP_ENV == "production" else AMADEUS_BASE_TEST


# ─── OAuth2 token cache ────────────────────────────────────────────────────────

_token_cache: dict = {"token": None, "expires_at": 0.0}

def _get_token() -> str:
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]
    resp = httpx.post(
        f"{_base_url()}/v1/security/oauth2/token",
        data={
            "grant_type": "client_credentials",
            "client_id": settings.AMADEUS_CLIENT_ID,
            "client_secret": settings.AMADEUS_CLIENT_SECRET,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15.0,
    )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 1800)
    logger.info("Amadeus token refreshed")
    return _token_cache["token"]

def _client() -> httpx.Client:
    return httpx.Client(
        base_url=_base_url(),
        headers={"Authorization": f"Bearer {_get_token()}", "Content-Type": "application/json"},
        timeout=30.0,
    )


# ─── IATA city code map (for hotel city search) ───────────────────────────────

_CITY_CODES: dict[str, str] = {
    # US (high priority)
    "new york": "NYC", "new york city": "NYC", "nyc": "NYC",
    "los angeles": "LAX", "san francisco": "SFO", "chicago": "CHI",
    "miami": "MIA", "las vegas": "LAS", "seattle": "SEA",
    "boston": "BOS", "washington": "WAS", "atlanta": "ATL",
    "dallas": "DFW", "houston": "HOU", "denver": "DEN",
    "orlando": "ORL", "new orleans": "MSY", "honolulu": "HNL",
    "nashville": "BNA", "portland": "PDX", "san diego": "SAN",
    # India (high priority)
    "delhi": "DEL", "new delhi": "DEL",
    "mumbai": "BOM", "bombay": "BOM",
    "bangalore": "BLR", "bengaluru": "BLR",
    "hyderabad": "HYD", "chennai": "MAA", "madras": "MAA",
    "kolkata": "CCU", "calcutta": "CCU",
    "pune": "PNQ", "jaipur": "JAI", "agra": "AGR",
    "goa": "GOA", "kochi": "COK", "cochin": "COK",
    "varanasi": "VNS", "ahmedabad": "AMD", "surat": "STV",
    "udaipur": "UDR", "chandigarh": "IXC", "amritsar": "ATQ",
    # Rest of world
    "london": "LON", "paris": "PAR", "tokyo": "TYO", "osaka": "OSA",
    "seoul": "SEL", "beijing": "BJS", "shanghai": "SHA",
    "rome": "ROM", "milan": "MIL", "berlin": "BER",
    "amsterdam": "AMS", "barcelona": "BCN", "madrid": "MAD",
    "lisbon": "LIS", "vienna": "VIE", "prague": "PRG",
    "istanbul": "IST", "athens": "ATH", "dubai": "DXB",
    "singapore": "SIN", "bangkok": "BKK", "hong kong": "HKG",
    "sydney": "SYD", "melbourne": "MEL", "toronto": "YTO",
    "bali": "DPS", "kuala lumpur": "KUL", "taipei": "TPE",
    "cairo": "CAI", "nairobi": "NBO", "cape town": "CPT",
    "johannesburg": "JNB", "mexico city": "MEX",
    "buenos aires": "BUE", "sao paulo": "SAO",
    "rio de janeiro": "RIO", "lima": "LIM", "bogota": "BOG",
    "montreal": "YMQ", "zurich": "ZRH", "stockholm": "STO",
}

def _to_city_code(location: str) -> str:
    key = location.strip().split(",")[0].strip().lower()
    if key in _CITY_CODES:
        return _CITY_CODES[key]
    if len(location.strip()) == 3:
        return location.strip().upper()
    return key[:3].upper()


# ─── HOTELS ───────────────────────────────────────────────────────────────────

def search_hotels(
    location: str,
    check_in: date,
    check_out: date,
    guests: int = 1,
    rooms: int = 1,
) -> list[dict]:
    """Search Amadeus for hotels. Returns list of normalized HotelOffer dicts."""
    city_code = _to_city_code(location)

    with _client() as client:
        # Step 1: get hotel IDs for the city
        hotels_resp = client.get(
            "/v1/reference-data/locations/hotels/by-city",
            params={"cityCode": city_code, "ratings": "3,4,5", "radius": 20, "radiusUnit": "KM"},
        )
        if not hotels_resp.is_success:
            logger.error(f"Amadeus hotels/by-city {hotels_resp.status_code}: {hotels_resp.text}")
            hotels_resp.raise_for_status()
        hotel_ids = [h["hotelId"] for h in hotels_resp.json().get("data", [])[:30]]
        if not hotel_ids:
            return []

        # Step 2: get offers for those hotels
        offers_resp = client.get(
            "/v3/shopping/hotel-offers",
            params={
                "hotelIds": ",".join(hotel_ids),
                "adults": guests,
                "checkInDate": str(check_in),
                "checkOutDate": str(check_out),
                "roomQuantity": rooms,
                "currencyCode": "USD",
                "bestRateOnly": True,
            },
        )
        if not offers_resp.is_success:
            logger.error(f"Amadeus hotel-offers {offers_resp.status_code}: {offers_resp.text}")
            return []

        raw = offers_resp.json().get("data", [])

    results = []
    for entry in raw:
        if not entry.get("available") or not entry.get("offers"):
            continue
        hotel = entry.get("hotel", {})
        best_offer = entry["offers"][0]
        price = best_offer.get("price", {})
        results.append({
            "id": f"amadeus_hotel_{best_offer['id']}",
            "provider": "amadeus",
            "accommodation": {
                "name": hotel.get("name", "Unknown Hotel"),
                "rating": int(hotel.get("rating", 0)) if hotel.get("rating") else None,
                "photos": [],
                "location": {
                    "geographic_coordinates": {
                        "latitude": hotel.get("latitude"),
                        "longitude": hotel.get("longitude"),
                    }
                },
            },
            "cheapest_rate_total_amount": price.get("total", "0"),
            "cheapest_rate_currency": price.get("currency", "USD"),
        })

    results.sort(key=lambda r: float(r["cheapest_rate_total_amount"] or "999999"))
    return results[:20]


def get_hotel_offer(offer_id: str) -> dict:
    """Fetch a single hotel offer to confirm price before booking."""
    # Strip the "amadeus_hotel_" prefix
    raw_id = offer_id.removeprefix("amadeus_hotel_")
    with _client() as client:
        resp = client.get(f"/v3/shopping/hotel-offers/{raw_id}")
        resp.raise_for_status()
        return resp.json()["data"]


def create_hotel_order(offer_id: str, guests: list[dict]) -> dict:
    """
    Book an Amadeus hotel offer.
    guests: list of dicts with given_name, family_name, email, phone_number.
    Payment in sandbox uses Amadeus test card; configure production payment in settings.
    """
    raw_offer_id = offer_id.removeprefix("amadeus_hotel_")

    amadeus_guests = []
    for i, g in enumerate(guests, start=1):
        phone = g.get("phone_number", "").replace(" ", "").replace("-", "")
        # Split E.164 phone into country code + number
        country_code = "1"
        number = phone
        if phone.startswith("+"):
            # e.g., "+14155552671" → cc="1", num="4155552671"
            digits = phone[1:]
            if len(digits) > 10:
                country_code = digits[:len(digits)-10]
                number = digits[len(digits)-10:]
            else:
                number = digits
        amadeus_guests.append({
            "id": i,
            "name": {"firstName": g.get("given_name", ""), "lastName": g.get("family_name", "")},
            "contact": {
                "phone": f"+{country_code}{number}",
                "email": g.get("email", ""),
            },
        })

    payload = {
        "data": {
            "offerId": raw_offer_id,
            "guests": amadeus_guests,
            "payments": [
                {
                    "id": 1,
                    "method": "creditCard",
                    "card": {
                        "vendorCode": settings.AMADEUS_PAYMENT_VENDOR_CODE or "VI",
                        "cardNumber": settings.AMADEUS_PAYMENT_CARD_NUMBER or "4111111111111111",
                        "expiryDate": settings.AMADEUS_PAYMENT_EXPIRY or "2026-01",
                    },
                }
            ],
        }
    }

    with _client() as client:
        resp = client.post("/v1/booking/hotel-orders", json=payload)
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error(f"Amadeus hotel-orders {resp.status_code}: {detail}")
            resp.raise_for_status()
        data = resp.json()["data"]

    # Normalize return: pick out booking reference
    return {
        "id": data.get("id"),
        "reference": data.get("associatedRecords", [{}])[0].get("reference", data.get("id")),
        "total_amount": data.get("hotelBookings", [{}])[0]
                            .get("hotelProviderInformation", {})
                            .get("totalPrice", {})
                            .get("total", "0"),
        "currency": "USD",
        "provider": "amadeus",
        "raw": data,
    }


# ─── FLIGHTS ──────────────────────────────────────────────────────────────────

# Server-side cache for flight offer JSON (required for booking).
# Keyed by "amadeus_flight_{offer_id}"; value is (offer_json, expires_at_epoch).
_flight_cache: dict[str, tuple[dict, float]] = {}
_FLIGHT_CACHE_TTL = 1800  # 30 minutes


def _cache_flight_offer(offer: dict) -> str:
    """Store Amadeus offer JSON in memory; return the prefixed cache key."""
    key = f"amadeus_flight_{offer['id']}"
    _flight_cache[key] = (offer, time.time() + _FLIGHT_CACHE_TTL)
    return key


def _pop_flight_offer(cache_key: str) -> dict:
    """Retrieve (and remove) a cached offer. Raises ValueError if missing/expired."""
    entry = _flight_cache.pop(cache_key, None)
    if not entry:
        raise ValueError("Flight offer not found in cache — please search again.")
    offer_json, expires_at = entry
    if time.time() > expires_at:
        raise ValueError("Flight offer has expired — please search again.")
    return offer_json


_CABIN_MAP = {
    "economy": "ECONOMY",
    "premium_economy": "PREMIUM_ECONOMY",
    "business": "BUSINESS",
    "first": "FIRST",
}


def _normalize_flight(offer: dict, carriers: dict[str, str]) -> dict:
    """Convert an Amadeus flight offer to a Duffel-compatible shape, cache the raw offer."""
    price = offer.get("price", {})
    total_amount = price.get("grandTotal") or price.get("total", "0")
    currency = price.get("currency", "USD")

    validating_codes = offer.get("validatingAirlineCodes", [])
    owner_code = validating_codes[0] if validating_codes else ""
    owner_name = carriers.get(owner_code, owner_code)

    slices = []
    for itin in offer.get("itineraries", []):
        segments_raw = itin.get("segments", [])
        if not segments_raw:
            continue
        first_seg = segments_raw[0]
        last_seg = segments_raw[-1]

        normalized_segments = []
        for seg in segments_raw:
            carrier_code = seg.get("carrierCode", "")
            normalized_segments.append({
                "operating_carrier": {
                    "name": carriers.get(carrier_code, carrier_code),
                    "logo_symbol_url": "",
                },
                "aircraft": {"name": seg.get("aircraft", {}).get("code", "")},
                "origin": {"iata_code": seg["departure"]["iataCode"]},
                "destination": {"iata_code": seg["arrival"]["iataCode"]},
                "departing_at": seg["departure"]["at"],
                "arriving_at": seg["arrival"]["at"],
            })

        slices.append({
            "origin": {
                "iata_code": first_seg["departure"]["iataCode"],
                "name": first_seg["departure"]["iataCode"],
            },
            "destination": {
                "iata_code": last_seg["arrival"]["iataCode"],
                "name": last_seg["arrival"]["iataCode"],
            },
            "duration": itin.get("duration", "PT0H"),
            "departing_at": first_seg["departure"]["at"],
            "arriving_at": last_seg["arrival"]["at"],
            "segments": normalized_segments,
        })

    cache_key = _cache_flight_offer(offer)

    return {
        "id": cache_key,
        "provider": "amadeus",
        "total_amount": str(total_amount),
        "total_currency": currency,
        "expires_at": offer.get("lastTicketingDateTime") or offer.get("lastTicketingDate", ""),
        "owner": {"name": owner_name, "logo_symbol_url": ""},
        "slices": slices,
    }


def search_flights(
    origin: str,
    destination: str,
    departure_date: date,
    passengers: int = 1,
    cabin_class: str = "economy",
    return_date: Optional[date] = None,
) -> list[dict]:
    """Search Amadeus for flights. Returns Duffel-compatible normalized offers."""
    cabin = _CABIN_MAP.get(cabin_class, "ECONOMY")
    params: dict = {
        "originLocationCode": origin.upper(),
        "destinationLocationCode": destination.upper(),
        "departureDate": str(departure_date),
        "adults": passengers,
        "travelClass": cabin,
        "currencyCode": "USD",
        "max": 20,
    }
    if return_date:
        params["returnDate"] = str(return_date)

    with _client() as client:
        resp = client.get("/v2/shopping/flight-offers", params=params)
        if not resp.is_success:
            logger.error(f"Amadeus flight-offers {resp.status_code}: {resp.text[:500]}")
            return []
        body = resp.json()

    carriers = body.get("dictionaries", {}).get("carriers", {})
    results = []
    for offer in body.get("data", []):
        try:
            results.append(_normalize_flight(offer, carriers))
        except Exception as e:
            logger.warning(f"Failed to normalize Amadeus flight offer {offer.get('id')}: {e}")

    return results


def create_flight_order(cache_key: str, passengers: list[dict]) -> dict:
    """
    Book an Amadeus flight using the server-side cached offer JSON.
    passengers: list of dicts with given_name, family_name, gender, born_on,
                email, phone_number, and optionally passport (number, expiry_date,
                country, nationality).
    """
    offer = _pop_flight_offer(cache_key)

    travelers = []
    for i, p in enumerate(passengers, start=1):
        phone = p.get("phone_number", "").replace(" ", "").replace("-", "")
        country_code = "1"
        number = phone.lstrip("+")
        if phone.startswith("+"):
            digits = phone[1:]
            if len(digits) > 10:
                country_code = digits[: len(digits) - 10]
                number = digits[len(digits) - 10 :]
            else:
                number = digits

        traveler: dict = {
            "id": str(i),
            "dateOfBirth": p.get("born_on", ""),
            "name": {
                "firstName": p.get("given_name", ""),
                "lastName": p.get("family_name", ""),
            },
            "gender": "MALE" if p.get("gender", "male") == "male" else "FEMALE",
            "contact": {
                "emailAddress": p.get("email", ""),
                "phones": [
                    {
                        "deviceType": "MOBILE",
                        "countryCallingCode": country_code,
                        "number": number,
                    }
                ],
            },
        }

        passport = p.get("passport")
        if passport:
            traveler["documents"] = [
                {
                    "documentType": "PASSPORT",
                    "number": passport.get("number", ""),
                    "expiryDate": passport.get("expiry_date", ""),
                    "issuanceCountry": (passport.get("country") or "US").upper(),
                    "nationality": (passport.get("nationality") or "US").upper(),
                    "holder": True,
                }
            ]

        travelers.append(traveler)

    payload = {
        "data": {
            "type": "flight-order",
            "flightOffers": [offer],
            "travelers": travelers,
        }
    }

    with _client() as client:
        resp = client.post("/v1/booking/flight-orders", json=payload)
        if not resp.is_success:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text
            logger.error(f"Amadeus flight-orders {resp.status_code}: {detail}")
            resp.raise_for_status()
        data = resp.json()["data"]

    booking_ref = data.get("associatedRecords", [{}])[0].get("reference", data.get("id"))
    price = offer.get("price", {})
    return {
        "id": data.get("id"),
        "booking_reference": booking_ref,
        "total_amount": price.get("grandTotal") or price.get("total", "0"),
        "total_currency": price.get("currency", "USD"),
        "provider": "amadeus",
        "raw": data,
    }
