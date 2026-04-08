import warnings
from supabase import create_client, Client
from app.core.config import settings

# gotrue is deprecated and has a bug in its __del__ method: it accesses
# self._refresh_token_timer before __init__ sets it, printing a noisy
# "Exception ignored" traceback to stderr on every process shutdown.
# Patch __del__ to a no-op until supabase-py is upgraded to >=2.7.0
# (which replaces gotrue with supabase_auth entirely).
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    try:
        from gotrue._sync.gotrue_client import SyncGoTrueClient
        SyncGoTrueClient.__del__ = lambda self: None
    except (ImportError, AttributeError):
        pass
    try:
        from gotrue._async.gotrue_client import AsyncGoTrueClient
        AsyncGoTrueClient.__del__ = lambda self: None
    except (ImportError, AttributeError):
        pass

_client: Client | None = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SECRET_KEY)
    return _client
