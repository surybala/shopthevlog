import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: () => ({ auth: { getUser: mockGetUser, getSession: mockGetSession } }),
}));

const mockRateLimit = vi.fn();
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

const mockCreatorFindUnique = vi.fn();
const mockCreatorUpdate = vi.fn();
const mockVlogFindMany = vi.fn();
const mockVlogFindFirst = vi.fn();
vi.mock('@/lib/prisma/client', () => ({
  default: {
    creator: {
      findUnique: (...args: unknown[]) => mockCreatorFindUnique(...args),
      update: (...args: unknown[]) => mockCreatorUpdate(...args),
    },
    vlog: {
      findMany: (...args: unknown[]) => mockVlogFindMany(...args),
      findFirst: (...args: unknown[]) => mockVlogFindFirst(...args),
    },
  },
}));

import { GET as getVlogs } from '../app/api/vlogs/route';
import { GET as getScanStatus } from '../app/api/creator/scan/status/route';
import { POST as processVlog } from '../app/api/vlogs/[id]/process/route';

describe('creator vlog routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } } });
    mockRateLimit.mockReturnValue(false);
    mockCreatorFindUnique.mockResolvedValue({ id: 'creator-1', plan: 'PRO', catalogScanStatus: 'COMPLETE', lastCatalogScan: '2025-01-01', _count: { vlogs: 2 } });
    mockVlogFindMany.mockResolvedValue([{ id: 'vlog-1', pipelineError: null }]);
    mockVlogFindFirst.mockResolvedValue({ id: 'vlog-1', creatorId: 'creator-1', processingStatus: 'PENDING' });
    process.env.AI_PIPELINE_URL = 'http://ai.example.com';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  it('scan status returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await getScanStatus();
    expect(res.status).toBe(401);
  });

  it('scan status returns 404 when creator is missing', async () => {
    mockCreatorFindUnique.mockResolvedValue(null);
    const res = await getScanStatus();
    expect(res.status).toBe(404);
  });

  it('scan status returns creator scan metadata', async () => {
    const res = await getScanStatus();
    await expect(res.json()).resolves.toEqual({
      plan: 'PRO',
      status: 'COMPLETE',
      lastCatalogScan: '2025-01-01',
      vlogCount: 2,
      vlogLimit: 25,
      remainingVlogSlots: 23,
      limitReached: false,
    });
  });

  it('vlogs list returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await getVlogs();
    expect(res.status).toBe(401);
  });

  it('vlogs list returns 404 when creator is missing', async () => {
    mockCreatorFindUnique.mockResolvedValue(null);
    const res = await getVlogs();
    expect(res.status).toBe(404);
  });

  it('vlogs list returns the creator vlogs ordered by publish date', async () => {
    const res = await getVlogs();
    await expect(res.json()).resolves.toEqual({ vlogs: [{ id: 'vlog-1', pipelineError: null }] });
    expect(mockVlogFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { creatorId: 'creator-1' },
      orderBy: { publishedAt: 'desc' },
    }));
  });

  it('vlogs list includes pipeline errors for failed rows', async () => {
    mockVlogFindMany.mockResolvedValue([{ id: 'vlog-1', processingStatus: 'FAILED', pipelineError: 'no_opportunities_extracted' }]);
    const res = await getVlogs();
    await expect(res.json()).resolves.toEqual({
      vlogs: [{ id: 'vlog-1', processingStatus: 'FAILED', pipelineError: 'no_opportunities_extracted' }],
    });
  });

  it('process route returns 429 when rate limited', async () => {
    mockRateLimit.mockReturnValue(true);
    const res = await processVlog(new NextRequest('http://localhost/api/vlogs/vlog-1/process', { method: 'POST' }), { params: { id: 'vlog-1' } });
    expect(res.status).toBe(429);
  });

  it('process route returns 404 when the creator is missing', async () => {
    mockCreatorFindUnique.mockResolvedValue(null);
    const res = await processVlog(new NextRequest('http://localhost/api/vlogs/vlog-1/process', { method: 'POST' }), { params: { id: 'vlog-1' } });
    expect(res.status).toBe(404);
  });

  it('process route returns 404 when the vlog does not belong to the creator', async () => {
    mockVlogFindFirst.mockResolvedValue(null);
    const res = await processVlog(new NextRequest('http://localhost/api/vlogs/vlog-1/process', { method: 'POST' }), { params: { id: 'vlog-1' } });
    expect(res.status).toBe(404);
  });

  it('process route returns already processing for in-flight vlogs', async () => {
    mockVlogFindFirst.mockResolvedValue({ id: 'vlog-1', creatorId: 'creator-1', processingStatus: 'TRANSCRIBING' });
    const res = await processVlog(new NextRequest('http://localhost/api/vlogs/vlog-1/process', { method: 'POST' }), { params: { id: 'vlog-1' } });
    await expect(res.json()).resolves.toEqual({ status: 'TRANSCRIBING', message: 'Already processing' });
  });

  it('process route returns 503 when the AI pipeline is not configured', async () => {
    delete process.env.AI_PIPELINE_URL;
    const res = await processVlog(new NextRequest('http://localhost/api/vlogs/vlog-1/process', { method: 'POST' }), { params: { id: 'vlog-1' } });
    expect(res.status).toBe(503);
  });

  it('process route sanitizes backend error details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'visual_evidence_failed: Invalid API key' }), { status: 500 }),
      ),
    );

    const res = await processVlog(new NextRequest('http://localhost/api/vlogs/vlog-1/process', { method: 'POST' }), { params: { id: 'vlog-1' } });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Video processing is temporarily unavailable. Please try again shortly.',
    });
  });

  it('process route forwards the request to the AI pipeline with the session token', async () => {
    const res = await processVlog(new NextRequest('http://localhost/api/vlogs/vlog-1/process', { method: 'POST' }), { params: { id: 'vlog-1' } });
    expect(fetch).toHaveBeenCalledWith(
      'http://ai.example.com/api/v1/vlogs/vlog-1/process',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
