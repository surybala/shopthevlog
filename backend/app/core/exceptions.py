"""
Shared domain exceptions for the booking pipeline.
Kept here so both provider services (Duffel, LiteAPI) and their routers
can import from a single location without circular dependencies.
"""


class StaleOfferError(Exception):
    """
    Raised when a flight or hotel offer is no longer available for booking.
    Routers should surface this as HTTP 409 so the frontend can prompt the
    user to search again.
    """
    pass
