from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from threading import Lock

from app.core.sentry import capture_observability_alert

RECENT_EVENT_LIMIT = 500
ALERT_WINDOW_SECONDS = 15 * 60


@dataclass
class ObservabilityEvent:
    timestamp: float
    kind: str
    name: str
    status: str
    duration_ms: float | None
    detail: str | None


class ObservabilityStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._events: deque[ObservabilityEvent] = deque(maxlen=RECENT_EVENT_LIMIT)
        self._alert_cache: dict[str, float] = {}

    def record(
        self,
        *,
        kind: str,
        name: str,
        status: str,
        duration_ms: float | None = None,
        detail: str | None = None,
    ) -> None:
        with self._lock:
            self._events.append(
                ObservabilityEvent(
                    timestamp=time.time(),
                    kind=kind,
                    name=name,
                    status=status,
                    duration_ms=duration_ms,
                    detail=detail,
                )
            )
            self._maybe_emit_external_alert(kind=kind, name=name, now=time.time())

    def reset(self) -> None:
        with self._lock:
            self._events.clear()
            self._alert_cache.clear()

    def _maybe_emit_external_alert(self, *, kind: str, name: str, now: float) -> None:
        window_start = now - ALERT_WINDOW_SECONDS
        group = [
            event
            for event in self._events
            if event.timestamp >= window_start and event.kind == kind and event.name == name
        ]
        total = len(group)
        error_count = sum(
            1
            for event in group
            if event.status in {"error", "failed"} or str(event.status).startswith("5")
        )
        durations = sorted(event.duration_ms for event in group if event.duration_ms is not None)
        p95 = None
        if durations:
            index = min(len(durations) - 1, max(0, int(len(durations) * 0.95) - 1))
            p95 = round(float(durations[index]), 2)

        candidates = []
        if kind == "pipeline" and error_count > 0:
            candidates.append({
                "cache_key": f"{kind}:{name}:pipeline_failures",
                "severity": "error",
                "message": f"{error_count} pipeline failures in the last 15 minutes for {name}.",
            })
        elif kind == "http" and total >= 5 and error_count / total >= 0.1:
            candidates.append({
                "cache_key": f"{kind}:{name}:http_error_rate",
                "severity": "warning",
                "message": f"HTTP error rate reached {round((error_count / total) * 100, 1)}% in the last 15 minutes for {name}.",
            })

        if p95 is not None and p95 > 3000:
            candidates.append({
                "cache_key": f"{kind}:{name}:latency",
                "severity": "warning",
                "message": f"P95 latency reached {p95}ms in the last 15 minutes for {name}.",
            })

        for candidate in candidates:
            last_sent_at = self._alert_cache.get(candidate["cache_key"])
            if last_sent_at and last_sent_at >= window_start:
                continue

            self._alert_cache[candidate["cache_key"]] = now
            capture_observability_alert(
                source=f"{kind}:{name}",
                severity=candidate["severity"],
                message=candidate["message"],
                extra={
                    "kind": kind,
                    "name": name,
                    "total": total,
                    "errors": error_count,
                    "p95_duration_ms": p95,
                },
            )

    def snapshot(self, now: float | None = None) -> dict:
        now = now or time.time()
        window_start = now - ALERT_WINDOW_SECONDS
        with self._lock:
            events = [event for event in self._events if event.timestamp >= window_start]

        grouped: dict[tuple[str, str], list[ObservabilityEvent]] = {}
        for event in events:
            grouped.setdefault((event.kind, event.name), []).append(event)

        metrics = []
        alerts = []
        for (kind, name), group in sorted(grouped.items()):
            total = len(group)
            error_count = sum(1 for event in group if event.status in {"error", "failed"} or str(event.status).startswith("5"))
            durations = sorted(event.duration_ms for event in group if event.duration_ms is not None)
            p95 = None
            if durations:
                index = min(len(durations) - 1, max(0, int(len(durations) * 0.95) - 1))
                p95 = round(float(durations[index]), 2)

            metrics.append({
                "kind": kind,
                "name": name,
                "total": total,
                "errors": error_count,
                "errorRate": round(error_count / total, 4) if total else 0.0,
                "p95DurationMs": p95,
            })

            if kind == "pipeline" and error_count > 0:
                alerts.append({
                    "severity": "critical",
                    "source": f"{kind}:{name}",
                    "message": f"{error_count} pipeline failures in the last 15 minutes.",
                })
            elif kind == "http" and total >= 5 and error_count / total >= 0.1:
                alerts.append({
                    "severity": "warning",
                    "source": f"{kind}:{name}",
                    "message": f"HTTP error rate is {round((error_count / total) * 100, 1)}% in the last 15 minutes.",
                })
            elif p95 is not None and p95 > 3000:
                alerts.append({
                    "severity": "warning",
                    "source": f"{kind}:{name}",
                    "message": f"P95 latency is {p95}ms in the last 15 minutes.",
                })

        return {
            "windowSeconds": ALERT_WINDOW_SECONDS,
            "metrics": metrics,
            "alerts": alerts,
            "recentEvents": [
                {
                    "kind": event.kind,
                    "name": event.name,
                    "status": event.status,
                    "durationMs": None if event.duration_ms is None else round(event.duration_ms, 2),
                    "detail": event.detail,
                }
                for event in events[-25:]
            ],
        }


observability_store = ObservabilityStore()
