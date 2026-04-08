"""
Tests for app.db.pg_client — PgClient context manager and get_pg_conn.
"""
import pytest
from unittest.mock import MagicMock, patch, call
import psycopg2.extras


def _make_fake_conn():
    """Return a mock psycopg2 connection and its cursor."""
    cursor = MagicMock()
    cursor.fetchone.return_value = {"id": "row-1"}
    cursor.fetchall.return_value = [{"id": "row-1"}, {"id": "row-2"}]

    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn, cursor


class TestPgClientContextManager:
    def test_commits_on_success(self):
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                pass
        conn.commit.assert_called_once()
        conn.rollback.assert_not_called()

    def test_rollbacks_on_exception(self):
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with pytest.raises(ValueError):
                with PgClient() as db:
                    raise ValueError("boom")
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()

    def test_cursor_closed_after_use(self):
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                pass
        cursor.close.assert_called_once()

    def test_connection_closed_after_use(self):
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                pass
        conn.close.assert_called_once()

    def test_execute_delegates_to_cursor(self):
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                db.execute("SELECT 1", (42,))
        cursor.execute.assert_called_once_with("SELECT 1", (42,))

    def test_execute_without_params(self):
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                db.execute("SELECT 1")
        cursor.execute.assert_called_once_with("SELECT 1", None)

    def test_fetchone_returns_first_row(self):
        conn, cursor = _make_fake_conn()
        cursor.fetchone.return_value = {"id": "abc"}
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                result = db.fetchone()
        assert result == {"id": "abc"}

    def test_fetchall_returns_all_rows(self):
        conn, cursor = _make_fake_conn()
        cursor.fetchall.return_value = [{"id": "a"}, {"id": "b"}]
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                result = db.fetchall()
        assert result == [{"id": "a"}, {"id": "b"}]

    def test_fetchone_returns_none_when_no_rows(self):
        conn, cursor = _make_fake_conn()
        cursor.fetchone.return_value = None
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                result = db.fetchone()
        assert result is None

    def test_multiple_execute_calls(self):
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with PgClient() as db:
                db.execute("SELECT 1")
                db.execute("SELECT 2")
        assert cursor.execute.call_count == 2

    def test_connects_with_real_dict_cursor_factory(self):
        """get_pg_conn (and therefore PgClient) passes cursor_factory=RealDictCursor."""
        conn, _ = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn) as mock_connect:
            from app.db.pg_client import PgClient
            with PgClient():
                pass

        call_kwargs = mock_connect.call_args.kwargs
        # cursor_factory should be RealDictCursor
        assert "cursor_factory" in call_kwargs
        assert call_kwargs["cursor_factory"] is psycopg2.extras.RealDictCursor

    def test_rollback_still_closes_connection(self):
        """Even on exception, connection and cursor are closed."""
        conn, cursor = _make_fake_conn()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import PgClient
            with pytest.raises(RuntimeError):
                with PgClient() as db:
                    raise RuntimeError("fail")
        cursor.close.assert_called_once()
        conn.close.assert_called_once()


class TestGetPgConn:
    def test_returns_connection(self):
        conn = MagicMock()
        with patch("app.db.pg_client.psycopg2.connect", return_value=conn):
            from app.db.pg_client import get_pg_conn
            result = get_pg_conn()
        assert result is conn

    def test_uses_database_url_from_settings(self):
        conn = MagicMock()
        with (
            patch("app.db.pg_client.psycopg2.connect", return_value=conn) as mock_connect,
            patch("app.db.pg_client.settings") as mock_settings,
        ):
            mock_settings.DATABASE_URL = "postgresql://test:pass@localhost/mydb"
            from app.db.pg_client import get_pg_conn
            get_pg_conn()
        mock_connect.assert_called_once_with(
            "postgresql://test:pass@localhost/mydb",
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
