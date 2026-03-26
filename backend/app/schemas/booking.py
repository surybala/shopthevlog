from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime, date


class FlightSearchRequest(BaseModel):
    origin: str
    destination: str
    departure_date: date
    return_date: Optional[date] = None
    passengers: int = 1
    cabin_class: str = "economy"


class HotelSearchRequest(BaseModel):
    location: str
    check_in: date
    check_out: date
    guests: int = 1
    rooms: int = 1


class PassengerPayload(BaseModel):
    title: str
    given_name: str
    family_name: str
    gender: str
    born_on: date
    email: str
    phone_number: str
    passport: Optional[Any] = None


class FlightBookRequest(BaseModel):
    offer_id: str
    passengers: List[PassengerPayload]
    trip_id: str


class HotelPrebookRequest(BaseModel):
    rate_id: str


class HotelPrebookResponse(BaseModel):
    prebook_id: str


class HotelBookRequest(BaseModel):
    rate_id: str
    guests: List[dict]
    trip_id: str
    prebook_id: Optional[str] = None
    # Structured metadata stored alongside the booking so the UI can display
    # hotel name / dates without parsing raw provider responses.
    hotel_name: Optional[str] = None
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    hotel_address: Optional[str] = None
    hotel_rating: Optional[float] = None


class CarSearchRequest(BaseModel):
    pickup_location: str
    dropoff_location: Optional[str] = None   # defaults to pickup_location when absent
    pickup_datetime: str                      # ISO 8601 datetime string
    dropoff_datetime: str
    driver_age: int = 30
    currency: str = "USD"


class CarBookRequest(BaseModel):
    car_id: str
    driver: dict                              # {first_name, last_name, email, phone, …}
    trip_id: str
    metadata: Optional[dict] = None


class ExperienceSearchRequest(BaseModel):
    location: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    category: Optional[str] = None
    currency: str = "USD"


class BookingResponse(BaseModel):
    id: str
    trip_id: str
    booking_type: str
    duffel_booking_reference: Optional[str] = None
    status: str
    total_amount: Optional[float] = None
    currency: str = "USD"
    booked_at: Optional[datetime] = None
    created_at: datetime
    # Additional fields persisted to the database and returned to the client
    provider: Optional[str] = None
    passenger_details: Optional[List[Any]] = None
    search_params: Optional[Any] = None
