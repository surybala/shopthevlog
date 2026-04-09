"""
Visual evidence scaffolding for phase 3 of the opportunity graph pipeline.

This service creates:
- coarse scene segments
- sampled frame assets
- placeholder scene-summary evidence for future OCR / vision enrichment

The goal is to establish durable multimodal records without blocking the
transcript-backed path that already powers the graph.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from uuid import uuid4

from app.db.pg_client import PgClient

logger = logging.getLogger(__name__)

VISUAL_EVIDENCE_TYPES = ("OCR", "SCENE_SUMMARY", "OBJECT_DETECTION", "LOGO_DETECTION", "CLIP_SUMMARY")


@dataclass
class SceneSegmentRecord:
    id: str
    start_sec: float
    end_sec: float
    scene_type: str | None
    summary: str
    sampling_strategy: str


def build_scene_segments(
    duration_seconds: int | None,
    *,
    target_scene_seconds: int = 60,
    max_segments: int = 8,
) -> list[SceneSegmentRecord]:
    """
    Build coarse, deterministic scene segments.

    We intentionally keep this simple for now: the graph gets temporal anchors
    and frame placeholders even before full visual extraction lands.
    """
    total_duration = float(duration_seconds) if duration_seconds and duration_seconds > 0 else 30.0
    estimated_segments = max(1, int((total_duration + target_scene_seconds - 1) // target_scene_seconds))
    total_segments = min(estimated_segments, max_segments)
    segment_width = total_duration / total_segments

    records: list[SceneSegmentRecord] = []
    for index in range(total_segments):
        start_sec = round(index * segment_width, 2)
        end_sec = round((index + 1) * segment_width, 2)
        records.append(
            SceneSegmentRecord(
                id=str(uuid4()),
                start_sec=start_sec,
                end_sec=end_sec,
                scene_type="UNKNOWN",
                summary=f"Sampled visual segment covering {start_sec:.0f}s to {end_sec:.0f}s for later OCR and scene analysis.",
                sampling_strategy="uniform-midpoint-v1",
            )
        )
    return records


def _frame_uri(vlog_id: str, timestamp_sec: float, thumbnail_url: str | None) -> str:
    if thumbnail_url:
        return f"{thumbnail_url}#t={int(timestamp_sec)}"
    return f"vlog://{vlog_id}/frames/{int(timestamp_sec)}"
def _delete_existing_visual_rows(db: PgClient, vlog_id: str) -> None:
    db.execute(
        '''DELETE FROM "OpportunityEvidence"
           WHERE "evidenceId" IN (
               SELECT id
               FROM "Evidence"
               WHERE "vlogId" = %s
                 AND "sourceType" IN (
                     'OCR'::"EvidenceSourceType",
                     'SCENE_SUMMARY'::"EvidenceSourceType",
                     'OBJECT_DETECTION'::"EvidenceSourceType",
                     'LOGO_DETECTION'::"EvidenceSourceType",
                     'CLIP_SUMMARY'::"EvidenceSourceType"
                 )
           )''',
        (vlog_id,),
    )
    db.execute(
        '''DELETE FROM "Evidence"
           WHERE "vlogId" = %s
             AND "sourceType" IN (
                 'OCR'::"EvidenceSourceType",
                 'SCENE_SUMMARY'::"EvidenceSourceType",
                 'OBJECT_DETECTION'::"EvidenceSourceType",
                 'LOGO_DETECTION'::"EvidenceSourceType",
                 'CLIP_SUMMARY'::"EvidenceSourceType"
             )''',
        (vlog_id,),
    )
    db.execute('DELETE FROM "FrameAsset" WHERE "vlogId" = %s', (vlog_id,))
    db.execute('DELETE FROM "SceneSegment" WHERE "vlogId" = %s', (vlog_id,))


def sync_visual_evidence(
    vlog_id: str,
    title: str,
    *,
    duration_seconds: int | None = None,
    thumbnail_url: str | None = None,
) -> dict:
    """
    Persist coarse visual graph records for a vlog.

    This is intentionally non-blocking scaffolding. It gives the pipeline
    durable scene/frame anchors and placeholder evidence while we build richer
    OCR and scene understanding later.
    """
    scenes = build_scene_segments(duration_seconds)
    scene_count = 0
    frame_count = 0
    evidence_count = 0

    with PgClient() as db:
        _delete_existing_visual_rows(db, vlog_id)

        for scene in scenes:
            db.execute(
                '''INSERT INTO "SceneSegment" (
                    id, "vlogId", "startSec", "endSec", "sceneType", summary,
                    "samplingStrategy", "createdAt"
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())''',
                (
                    scene.id,
                    vlog_id,
                    scene.start_sec,
                    scene.end_sec,
                    scene.scene_type,
                    scene.summary,
                    scene.sampling_strategy,
                ),
            )
            scene_count += 1

            midpoint = round((scene.start_sec + scene.end_sec) / 2, 2)
            frame_id = str(uuid4())
            db.execute(
                '''INSERT INTO "FrameAsset" (
                    id, "vlogId", "sceneSegmentId", "timestampSec", "imageUri",
                    width, height, "createdAt"
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())''',
                (
                    frame_id,
                    vlog_id,
                    scene.id,
                    midpoint,
                    _frame_uri(vlog_id, midpoint, thumbnail_url),
                    None,
                    None,
                ),
            )
            frame_count += 1

            evidence_id = str(uuid4())
            db.execute(
                '''INSERT INTO "Evidence" (
                    id, "vlogId", "sourceType", "claimType", "startSec", "endSec",
                    "transcriptSegmentId", "frameAssetId", confidence, "payloadJson", "createdAt"
                ) VALUES (
                    %s, %s, %s::"EvidenceSourceType", %s, %s, %s,
                    %s, %s, %s, %s::jsonb, NOW()
                )''',
                (
                    evidence_id,
                    vlog_id,
                    "SCENE_SUMMARY",
                    None,
                    scene.start_sec,
                    scene.end_sec,
                    None,
                    frame_id,
                    0.25,
                    json.dumps(
                        {
                            "title": title,
                            "sceneType": scene.scene_type,
                            "summary": scene.summary,
                            "samplingStrategy": scene.sampling_strategy,
                        }
                    ),
                ),
            )
            evidence_count += 1

        db.execute(
            '''UPDATE "Vlog"
               SET "lastPipelineRunAt" = NOW()
               WHERE id = %s''',
            (vlog_id,),
        )

    logger.info(
        "Persisted %s scene segments, %s frame assets, and %s visual evidences for vlog %s",
        scene_count,
        frame_count,
        evidence_count,
        vlog_id,
    )
    return {
        "scene_segments": scene_count,
        "frame_assets": frame_count,
        "evidences": evidence_count,
    }
