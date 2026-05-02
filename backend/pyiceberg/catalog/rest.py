"""Minimal shim so storage3 can import analytics helpers on Python 3.14 Windows.

This project does not use storage analytics / iceberg integration. Newer
storage3 releases import RestCatalog eagerly, but pyiceberg currently does not
install cleanly in this local environment. A tiny stub keeps the supported
Supabase client importable until upstream wheels catch up.
"""


class RestCatalog:  # pragma: no cover - compatibility shim only
    pass
