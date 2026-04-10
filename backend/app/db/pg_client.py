"""
Direct PostgreSQL client for the new Prisma schema tables.
Uses psycopg2 with RealDictCursor so rows are returned as dicts.
"""
import logging

import psycopg2
from psycopg2.extras import RealDictCursor

from app.core.config import settings

logger = logging.getLogger(__name__)


def get_pg_conn():
    """Return a new psycopg2 connection. Caller must close it."""
    return psycopg2.connect(
        settings.DATABASE_URL,
        cursor_factory=RealDictCursor,
    )


class PgClient:
    """Context manager for a psycopg2 connection + cursor."""

    def __init__(self):
        self.conn = None
        self.cur = None

    def __enter__(self):
        self.conn = get_pg_conn()
        self.cur = self.conn.cursor()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.conn.rollback()
        else:
            self.conn.commit()
        self.cur.close()
        self.conn.close()

    def execute(self, sql: str, params=None):
        self.cur.execute(sql, params)

    def fetchone(self):
        return self.cur.fetchone()

    def fetchall(self):
        return self.cur.fetchall()
