from unittest.mock import patch

from app.core.observability import ObservabilityStore


class TestObservabilityStore:
    def test_snapshot_groups_metrics_and_alerts(self):
        store = ObservabilityStore()
        for index in range(5):
            store.record(
                kind="http",
                name="/api/test",
                status="503" if index < 2 else "200",
                duration_ms=100 + index,
            )

        snapshot = store.snapshot(now=10_000)
        metric = next(item for item in snapshot["metrics"] if item["name"] == "/api/test")

        assert metric["total"] == 5
        assert metric["errors"] == 2
        assert snapshot["alerts"]

    def test_snapshot_flags_pipeline_failures(self):
        store = ObservabilityStore()
        store.record(kind="pipeline", name="process_vlog", status="failed", detail="RuntimeError")

        snapshot = store.snapshot(now=10_000)
        assert snapshot["alerts"] == [
            {
                "severity": "critical",
                "source": "pipeline:process_vlog",
                "message": "1 pipeline failures in the last 15 minutes.",
            }
        ]

    def test_record_emits_external_alert_once_per_window(self):
        store = ObservabilityStore()

        with patch("app.core.observability.capture_observability_alert") as mock_capture:
            for index in range(5):
                store.record(
                    kind="http",
                    name="/api/test",
                    status="503" if index < 2 else "200",
                    duration_ms=100 + index,
                )

        mock_capture.assert_called_once()
        kwargs = mock_capture.call_args.kwargs
        assert kwargs["source"] == "http:/api/test"
        assert kwargs["severity"] == "warning"
