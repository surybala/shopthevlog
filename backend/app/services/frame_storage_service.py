"""
Supabase Storage helpers for visual pipeline frame assets.

The visual pipeline samples frame anchors deterministically. This service
makes those anchors durable by storing image assets under a creator- and
vlog-scoped storage path, and can extract real frames from the source video
before uploading them.
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import tempfile
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.db.client import get_supabase


PLACEHOLDER_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnCYuoAAAAASUVORK5CYII="
)


@dataclass
class StoredFrameAsset:
    path: str
    public_url: str
    content_type: str
    size_bytes: int


def build_frame_storage_path(creator_id: str, vlog_id: str, timestamp_sec: float, extension: str) -> str:
    safe_extension = extension.lower().lstrip(".") or "png"
    return f"creators/{creator_id}/vlogs/{vlog_id}/frames/frame-{int(timestamp_sec):06d}.{safe_extension}"


def build_frame_manifest_path(creator_id: str, vlog_id: str) -> str:
    return f"creators/{creator_id}/vlogs/{vlog_id}/frames/manifest.json"


def _infer_content_type(source_url: str | None, response_content_type: str | None) -> str:
    if response_content_type:
        return response_content_type.split(";")[0].strip()
    guessed, _encoding = mimetypes.guess_type(source_url or "")
    return guessed or "image/png"


def _extension_for_content_type(content_type: str) -> str:
    guessed = mimetypes.guess_extension(content_type) or ".png"
    return guessed.lstrip(".")


def _coerce_downloaded_bytes(payload) -> bytes:
    if isinstance(payload, bytes):
        return payload
    if isinstance(payload, str):
        return payload.encode("utf-8")
    data = getattr(payload, "data", None)
    if isinstance(data, bytes):
        return data
    if isinstance(data, str):
        return data.encode("utf-8")
    raise TypeError("Unsupported storage payload")


def fetch_frame_bytes(source_url: str | None) -> tuple[bytes, str]:
    if not source_url:
        return PLACEHOLDER_PNG_BYTES, "image/png"

    response = httpx.get(source_url, timeout=10.0)
    response.raise_for_status()
    content_type = _infer_content_type(source_url, response.headers.get("content-type"))
    return response.content, content_type


def _download_video_for_frame_extraction(video_url: str, output_template: str) -> str:
    import yt_dlp

    with yt_dlp.YoutubeDL(
        {
            "format": "mp4/bestvideo+bestaudio/best",
            "outtmpl": output_template,
            "quiet": True,
            "no_warnings": True,
        }
    ) as ydl:
        info = ydl.extract_info(video_url, download=True)
        return ydl.prepare_filename(info)


def extract_video_frames(video_url: str | None, timestamps_sec: list[float]) -> dict[float, tuple[bytes, str]]:
    """
    Download the source video once and extract frames near the requested timestamps.
    """
    if not video_url or not timestamps_sec:
        return {}

    try:
        import ffmpeg

        with tempfile.TemporaryDirectory() as tmpdir:
            output_template = os.path.join(tmpdir, "video.%(ext)s")
            downloaded_path = _download_video_for_frame_extraction(video_url, output_template)
            extracted_frames: dict[float, tuple[bytes, str]] = {}

            for timestamp_sec in timestamps_sec:
                normalized_timestamp = round(max(float(timestamp_sec), 0.0), 2)
                frame_path = os.path.join(tmpdir, f"frame-{int(normalized_timestamp):06d}.jpg")
                (
                    ffmpeg.input(downloaded_path, ss=normalized_timestamp)
                    .output(frame_path, vframes=1, format="image2", vcodec="mjpeg")
                    .overwrite_output()
                    .run(quiet=True)
                )

                with open(frame_path, "rb") as frame_file:
                    extracted_frames[timestamp_sec] = (frame_file.read(), "image/jpeg")

            return extracted_frames

    except Exception:
        return {}


def extract_video_frame_bytes(video_url: str | None, timestamp_sec: float) -> tuple[bytes, str] | None:
    extracted_frames = extract_video_frames(video_url, [timestamp_sec])
    return extracted_frames.get(timestamp_sec)


def load_cached_frame_assets(
    *,
    creator_id: str,
    vlog_id: str,
    source_video_url: str | None,
    timestamps_sec: list[float],
) -> dict[float, StoredFrameAsset]:
    if not source_video_url or not timestamps_sec:
        return {}

    supabase = get_supabase()
    bucket = supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET)
    manifest_path = build_frame_manifest_path(creator_id, vlog_id)

    try:
        manifest_payload = bucket.download(manifest_path)
        manifest = json.loads(_coerce_downloaded_bytes(manifest_payload).decode("utf-8"))
    except Exception:
        return {}

    if manifest.get("sourceVideoUrl") != source_video_url:
        return {}

    manifest_frames = manifest.get("frames", {})
    cached_assets: dict[float, StoredFrameAsset] = {}
    for timestamp_sec in timestamps_sec:
        manifest_entry = manifest_frames.get(str(timestamp_sec))
        if not manifest_entry:
            continue
        path = manifest_entry["path"]
        cached_assets[timestamp_sec] = StoredFrameAsset(
            path=path,
            public_url=bucket.get_public_url(path),
            content_type=manifest_entry.get("contentType", "image/jpeg"),
            size_bytes=int(manifest_entry.get("sizeBytes", 0)),
        )

    return cached_assets


def write_frame_manifest(
    *,
    creator_id: str,
    vlog_id: str,
    source_video_url: str,
    frame_assets: dict[float, StoredFrameAsset],
) -> None:
    if not frame_assets:
        return

    manifest = {
        "sourceVideoUrl": source_video_url,
        "frames": {
            str(timestamp_sec): {
                "path": asset.path,
                "contentType": asset.content_type,
                "sizeBytes": asset.size_bytes,
            }
            for timestamp_sec, asset in frame_assets.items()
        },
    }

    supabase = get_supabase()
    bucket = supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET)
    bucket.upload(
        build_frame_manifest_path(creator_id, vlog_id),
        json.dumps(manifest).encode("utf-8"),
        {"content-type": "application/json", "upsert": "true"},
    )


def store_frame_asset(
    *,
    creator_id: str,
    vlog_id: str,
    timestamp_sec: float,
    source_url: str | None,
    frame_content: bytes | None = None,
    frame_content_type: str | None = None,
) -> StoredFrameAsset:
    if frame_content is not None:
        content = frame_content
        content_type = frame_content_type or "image/jpeg"
    else:
        content, content_type = fetch_frame_bytes(source_url)
    extension = _extension_for_content_type(content_type)
    storage_path = build_frame_storage_path(creator_id, vlog_id, timestamp_sec, extension)

    supabase = get_supabase()
    bucket = supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET)
    bucket.upload(
        storage_path,
        content,
        {"content-type": content_type, "upsert": "true"},
    )
    public_url = bucket.get_public_url(storage_path)

    return StoredFrameAsset(
        path=storage_path,
        public_url=public_url,
        content_type=content_type,
        size_bytes=len(content),
    )
