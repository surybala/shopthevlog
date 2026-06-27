"""
Brief outcome calibration (Phase 3).

The closed loop: the web layer measures how a published brief actually performed
(actualScore / outcomeDelta vs the creator's baseline). This module reads that
history back so the brief-generation and idea-augmentation prompts can anchor
their predictions to what really happened for THIS creator — making scores
calibrated and visibly self-improving.
"""
import logging
import statistics
from typing import Optional

from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)


def _median(values: list[float]) -> float:
    return float(statistics.median(values)) if values else 0.0


def fetch_creator_baseline(creator_id: str) -> float:
    """Median view count across the creator's videos — their performance baseline."""
    try:
        with PgClient() as db:
            db.execute(
                '''SELECT "viewCount" FROM "Vlog"
                   WHERE "creatorId" = %s AND "viewCount" IS NOT NULL AND "viewCount" > 0''',
                (creator_id,),
            )
            rows = db.fetchall() or []
        return _median([float(r["viewCount"]) for r in rows])
    except Exception as e:
        logger.warning("fetch_creator_baseline failed for %s: %s", creator_id, e)
        return 0.0


def fetch_calibration_context(creator_id: str) -> dict:
    """
    Return calibration context for prompts:
      - baseline_median_views: the creator's typical performance
      - samples: recent measured briefs (predicted vs actual)
      - mean_abs_error: how far past predictions were off, in score points
    Always returns a dict; empty/zeroed on any failure.
    """
    samples: list[dict] = []
    try:
        with PgClient() as db:
            db.execute(
                '''SELECT title, "estimatedScore", "actualScore", "outcomeDelta"
                   FROM "ContentBrief"
                   WHERE "creatorId" = %s AND "actualScore" IS NOT NULL
                   ORDER BY "measuredAt" DESC NULLS LAST
                   LIMIT 10''',
                (creator_id,),
            )
            samples = [dict(r) for r in (db.fetchall() or [])]
    except Exception as e:
        logger.warning("fetch_calibration_context failed for %s: %s", creator_id, e)

    baseline = fetch_creator_baseline(creator_id)

    mean_abs_error: Optional[float] = None
    if samples:
        errors = [
            abs((s.get("estimatedScore") or 0) - (s.get("actualScore") or 0))
            for s in samples
        ]
        if errors:
            mean_abs_error = sum(errors) / len(errors)

    return {
        "baseline_median_views": baseline,
        "samples": samples,
        "mean_abs_error": mean_abs_error,
    }


def format_calibration_section(calibration: Optional[dict]) -> str:
    """
    Render calibration context as a prompt section. Returns "" when there is no
    useful signal so prompts stay clean for brand-new creators.
    """
    if not calibration:
        return ""
    samples = calibration.get("samples") or []
    baseline = calibration.get("baseline_median_views") or 0
    if not samples and not baseline:
        return ""

    lines: list[str] = []
    if baseline:
        lines.append(f"Creator baseline: median {int(baseline):,} views per video.")
    for s in samples[:6]:
        delta = s.get("outcomeDelta")
        delta_note = (
            f"{delta * 100:+.0f}% vs baseline"
            if isinstance(delta, (int, float))
            else "outcome n/a"
        )
        lines.append(
            f"- Predicted {s.get('estimatedScore')}/100 for \"{s.get('title')}\" "
            f"→ actual {s.get('actualScore')}/100 ({delta_note})"
        )
    mae = calibration.get("mean_abs_error")
    if mae is not None:
        lines.append(
            f"Historical prediction error (mean absolute): {mae:.0f} points. "
            f"Calibrate new scores against these real outcomes — do not over-promise."
        )

    return (
        "\n\nCALIBRATION — THIS CREATOR'S ACTUAL OUTCOMES (predicted vs real):\n"
        + "\n".join(lines)
    )
