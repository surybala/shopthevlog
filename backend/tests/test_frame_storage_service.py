"""
Tests for Supabase-backed frame asset storage.
"""
import shutil
import sys
import types
import json
from pathlib import Path
from unittest.mock import MagicMock, patch


def test_build_frame_storage_path_namespaces_by_creator_and_vlog():
    from app.services.frame_storage_service import build_frame_storage_path

    path = build_frame_storage_path("creator-001", "vlog-001", 90.0, "jpg")

    assert path == "creators/creator-001/vlogs/vlog-001/frames/frame-000090.jpg"


def test_build_frame_manifest_path_namespaces_by_creator_and_vlog():
    from app.services.frame_storage_service import build_frame_manifest_path

    path = build_frame_manifest_path("creator-001", "vlog-001")

    assert path == "creators/creator-001/vlogs/vlog-001/frames/manifest.json"


def test_fetch_frame_bytes_uses_placeholder_when_source_missing():
    from app.services.frame_storage_service import fetch_frame_bytes, PLACEHOLDER_PNG_BYTES

    content, content_type = fetch_frame_bytes(None)

    assert content == PLACEHOLDER_PNG_BYTES
    assert content_type == "image/png"


def test_store_frame_asset_uploads_to_supabase_bucket():
    mock_bucket = MagicMock()
    mock_supabase = MagicMock()
    mock_supabase.storage.from_.return_value = mock_bucket

    mock_response = MagicMock()
    mock_response.content = b"jpeg-bytes"
    mock_response.headers = {"content-type": "image/jpeg"}
    mock_response.raise_for_status.return_value = None

    with (
        patch("app.services.frame_storage_service.get_supabase", return_value=mock_supabase),
        patch("app.services.frame_storage_service.httpx.get", return_value=mock_response),
    ):
        from app.services.frame_storage_service import store_frame_asset

        stored = store_frame_asset(
            creator_id="creator-001",
            vlog_id="vlog-001",
            timestamp_sec=30.0,
            source_url="https://cdn.example.com/thumb.jpg",
        )

    assert mock_supabase.storage.from_.call_count == 1
    mock_bucket.upload.assert_called_once_with(
        "creators/creator-001/vlogs/vlog-001/frames/frame-000030.jpg",
        b"jpeg-bytes",
        {"content-type": "image/jpeg", "upsert": "true"},
    )
    assert stored.path == "creators/creator-001/vlogs/vlog-001/frames/frame-000030.jpg"
    assert stored.content_type == "image/jpeg"
    assert stored.size_bytes == len(b"jpeg-bytes")


def test_store_frame_asset_prefers_extracted_frame_bytes():
    mock_bucket = MagicMock()
    mock_supabase = MagicMock()
    mock_supabase.storage.from_.return_value = mock_bucket

    with patch("app.services.frame_storage_service.get_supabase", return_value=mock_supabase):
        from app.services.frame_storage_service import store_frame_asset

        stored = store_frame_asset(
            creator_id="creator-001",
            vlog_id="vlog-001",
            timestamp_sec=45.0,
            source_url="https://cdn.example.com/thumb.jpg",
            frame_content=b"real-frame-jpeg",
            frame_content_type="image/jpeg",
        )

    mock_bucket.upload.assert_called_once_with(
        "creators/creator-001/vlogs/vlog-001/frames/frame-000045.jpg",
        b"real-frame-jpeg",
        {"content-type": "image/jpeg", "upsert": "true"},
    )
    assert stored.path == "creators/creator-001/vlogs/vlog-001/frames/frame-000045.jpg"


def test_extract_video_frames_downloads_once_and_returns_all_requested_jpegs():
    temp_dir = Path("tests/.tmp-frame-storage-test")
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)
    video_path = temp_dir / "video.mp4"
    video_path.write_bytes(b"video-bytes")
    frame_path_holder: dict[str, str] = {}
    download_count = 0

    class FakeYoutubeDL:
        def __init__(self, _opts):
            self.info = {"ext": "mp4"}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            return False

        def extract_info(self, _url, download):
            nonlocal download_count
            assert download is True
            download_count += 1
            return self.info

        def prepare_filename(self, _info):
            return str(video_path)

    class FakeOutput:
        def overwrite_output(self):
            return self

        def run(self, quiet=True):
            assert quiet is True
            with open(frame_path_holder["path"], "wb") as frame_file:
                frame_file.write(b"jpeg-frame")
            return None

    class FakeStream:
        def output(self, frame_path, **_kwargs):
            frame_path_holder["path"] = frame_path
            return FakeOutput()

    fake_ffmpeg = types.SimpleNamespace(input=lambda *_args, **_kwargs: FakeStream())
    fake_yt_dlp = types.SimpleNamespace(YoutubeDL=FakeYoutubeDL)

    class FakeTemporaryDirectory:
        def __enter__(self):
            return str(temp_dir)

        def __exit__(self, exc_type, exc_val, exc_tb):
            return False

    with (
        patch.dict(sys.modules, {"ffmpeg": fake_ffmpeg, "yt_dlp": fake_yt_dlp}),
        patch("app.services.frame_storage_service.tempfile.TemporaryDirectory", FakeTemporaryDirectory),
    ):
        from app.services.frame_storage_service import extract_video_frames

        extracted = extract_video_frames("https://youtube.com/watch?v=abc", [12.0, 24.0])

    assert extracted == {
        12.0: (b"jpeg-frame", "image/jpeg"),
        24.0: (b"jpeg-frame", "image/jpeg"),
    }
    assert download_count == 1
    shutil.rmtree(temp_dir)


def test_extract_video_frame_bytes_uses_batch_extractor_for_single_timestamp():
    with patch(
        "app.services.frame_storage_service.extract_video_frames",
        return_value={12.0: (b"jpeg-frame", "image/jpeg")},
    ) as mock_extract:
        from app.services.frame_storage_service import extract_video_frame_bytes

        extracted = extract_video_frame_bytes("https://youtube.com/watch?v=abc", 12.0)

    assert extracted == (b"jpeg-frame", "image/jpeg")
    mock_extract.assert_called_once_with("https://youtube.com/watch?v=abc", [12.0])


def test_load_cached_frame_assets_returns_manifest_matches():
    mock_bucket = MagicMock()
    mock_bucket.download.return_value = json.dumps(
        {
            "sourceVideoUrl": "https://youtube.com/watch?v=abc",
            "frames": {
                "12.0": {
                    "path": "creators/creator-001/vlogs/vlog-001/frames/frame-000012.jpg",
                    "contentType": "image/jpeg",
                    "sizeBytes": 123,
                }
            },
        }
    ).encode("utf-8")
    mock_supabase = MagicMock()
    mock_supabase.storage.from_.return_value = mock_bucket

    with patch("app.services.frame_storage_service.get_supabase", return_value=mock_supabase):
        from app.services.frame_storage_service import load_cached_frame_assets

        cached = load_cached_frame_assets(
            creator_id="creator-001",
            vlog_id="vlog-001",
            source_video_url="https://youtube.com/watch?v=abc",
            timestamps_sec=[12.0, 24.0],
        )

    assert list(cached.keys()) == [12.0]
    assert cached[12.0].path == "creators/creator-001/vlogs/vlog-001/frames/frame-000012.jpg"


def test_write_frame_manifest_uploads_json_manifest():
    mock_bucket = MagicMock()
    mock_supabase = MagicMock()
    mock_supabase.storage.from_.return_value = mock_bucket

    with patch("app.services.frame_storage_service.get_supabase", return_value=mock_supabase):
        from app.services.frame_storage_service import StoredFrameAsset, write_frame_manifest

        write_frame_manifest(
            creator_id="creator-001",
            vlog_id="vlog-001",
            source_video_url="https://youtube.com/watch?v=abc",
            frame_assets={
                12.0: StoredFrameAsset(
                    path="creators/creator-001/vlogs/vlog-001/frames/frame-000012.jpg",
                    content_type="image/jpeg",
                    size_bytes=123,
                )
            },
        )

    upload_path, payload, options = mock_bucket.upload.call_args.args
    assert upload_path == "creators/creator-001/vlogs/vlog-001/frames/manifest.json"
    assert json.loads(payload.decode("utf-8"))["sourceVideoUrl"] == "https://youtube.com/watch?v=abc"
    assert options == {"content-type": "application/json", "upsert": "true"}


def test_download_frame_asset_bytes_reads_storage_paths_and_passes_through_external_urls():
    mock_bucket = MagicMock()
    mock_bucket.download.return_value = b"stored-frame-bytes"
    mock_supabase = MagicMock()
    mock_supabase.storage.from_.return_value = mock_bucket

    with patch("app.services.frame_storage_service.get_supabase", return_value=mock_supabase):
        from app.services.frame_storage_service import download_frame_asset_bytes

        assert (
            download_frame_asset_bytes("creators/creator-001/vlogs/vlog-001/frames/frame-000012.jpg")
            == (b"stored-frame-bytes", "image/jpeg")
        )

    with patch("app.services.frame_storage_service.fetch_frame_bytes", return_value=(b"remote-bytes", "image/png")):
        from app.services.frame_storage_service import download_frame_asset_bytes

        assert download_frame_asset_bytes("https://cdn.example.com/frame.jpg") == (b"remote-bytes", "image/png")
