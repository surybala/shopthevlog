from __future__ import annotations

import logging

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from app.core.config import settings

logger = logging.getLogger(__name__)


def init_sentry() -> None:
    if not settings.SENTRY_DSN:
        logger.info("Sentry disabled because SENTRY_DSN is not configured.")
        return

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.APP_ENV,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=settings.SENTRY_PROFILES_SAMPLE_RATE,
        send_default_pii=False,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            HttpxIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )


def capture_observability_alert(
    *,
    source: str,
    severity: str,
    message: str,
    extra: dict | None = None,
) -> None:
    if not settings.SENTRY_DSN:
        return

    with sentry_sdk.push_scope() as scope:
        scope.level = severity
        scope.set_tag("alert_source", source)
        scope.set_tag("alert_kind", "observability")
        for key, value in (extra or {}).items():
            scope.set_extra(key, value)
        sentry_sdk.capture_message(message, level=severity)
