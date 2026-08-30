import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';

const listMock = vi.fn();
const getActiveClientMock = vi.fn();

vi.mock('../src/sessions.js', () => ({ sessionStore: { list: () => listMock() } }));
vi.mock('../src/client.js', () => ({ getActiveClient: () => getActiveClientMock() }));

const { registerHealthcheckTools } = await import('../src/tools/healthcheck.js');

interface Result {
  ok: boolean;
  credential: { source: string | null; resolved: boolean; detail?: Record<string, unknown> };
  error?: { kind: string; message: string };
  hint: string;
}

async function call() {
  const h = await createTestHarness((server) => registerHealthcheckTools(server));
  const res = await h.client.callTool({ name: 'honeybook_healthcheck', arguments: {} });
  await h.close?.();
  return parseToolResult<Result>(res as never);
}

beforeEach(() => {
  listMock.mockReset();
  getActiveClientMock.mockReset();
});

describe('honeybook_healthcheck', () => {
  it('reports ok and names the active origins', async () => {
    listMock.mockReturnValue([{ portalOrigin: 'https://vendor.honeybook.com' }]);
    getActiveClientMock.mockResolvedValue({
      scope: { userId: 'u1' },
      request: async () => [],
    });
    const r = await call();
    expect(r.ok).toBe(true);
    expect(r.credential.detail).toEqual({ origins: ['https://vendor.honeybook.com'] });
  });

  it('reports no_credential, and does not probe, with no active session', async () => {
    listMock.mockReturnValue([]);
    const r = await call();
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('no_credential');
    expect(r.error?.message).toMatch(/use_magic_link/);
    expect(getActiveClientMock).not.toHaveBeenCalled();
  });

  // HoneyBook answers a revoked token with 404 + HBUnauthorizedError, not 401.
  // Left unclassified it reads as "that resource does not exist", sending
  // people to look for a missing workspace instead of re-activating a link.
  it('re-kinds HoneyBook\'s 404 HBUnauthorizedError as a rejected credential', async () => {
    listMock.mockReturnValue([{ portalOrigin: 'https://vendor.honeybook.com' }]);
    getActiveClientMock.mockResolvedValue({
      scope: { userId: 'u1' },
      request: async () => {
        throw Object.assign(new Error('HTTP 404: {"error":"HBUnauthorizedError"}'), { status: 404 });
      },
    });
    const r = await call();
    expect(r.error?.kind).toBe('credential_rejected');
    expect(r.hint).toMatch(/use_magic_link/);
  });

  it('leaves a genuine 404 as an ordinary failure', async () => {
    listMock.mockReturnValue([{ portalOrigin: 'https://vendor.honeybook.com' }]);
    getActiveClientMock.mockResolvedValue({
      scope: { userId: 'u1' },
      request: async () => {
        throw Object.assign(new Error('HTTP 404: no such workspace'), { status: 404 });
      },
    });
    const r = await call();
    expect(r.error?.kind).toBe('http');
  });
});
