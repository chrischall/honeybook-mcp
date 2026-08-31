import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';

const listMock = vi.fn();
const getActiveClientMock = vi.fn();

vi.mock('../src/sessions.js', () => ({ sessionStore: { list: () => listMock() } }));
// The real constant, not a stub: the whole point of sharing it is that the
// healthcheck and getActiveClient say the same thing, so mocking it away would
// let them drift while the test stayed green.
vi.mock('../src/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client.js')>();
  return { ...actual, getActiveClient: () => getActiveClientMock() };
});

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

  // The message names `use_magic_link` as the FIX, and classifyThrown matches
  // that same literal as a SYMPTOM of a rejected session. They only stopped
  // colliding by luck: the classifier was never consulted for a resolver throw
  // until mcp-utils 0.19.3, and this message arrives on exactly that path.
  // Without the guard, someone who never connected is told their session
  // expired and sent to fetch a "fresh" link to replace one they never had.
  it('reports no_credential, and does not probe, with no active session', async () => {
    listMock.mockReturnValue([]);
    const r = await call();
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('no_credential');
    expect(r.error?.message).toMatch(/use_magic_link/);
    // Not a rejection, and the hint must not claim expiry.
    expect(r.error?.kind).not.toBe('credential_rejected');
    expect(r.hint).not.toMatch(/expired|rejected the session/i);
    expect(getActiveClientMock).not.toHaveBeenCalled();
  });

  // HoneyBook answers a revoked token with 404 + HBUnauthorizedError, not 401.
  // Left unclassified it reads as "that resource does not exist", sending
  // people to look for a missing workspace instead of re-activating a link.
  // The error the REAL client throws. `HoneyBookClient.request()` normalises
  // both 401 and 404+HBUnauthorizedError into this one message, so a test that
  // throws the raw wire error asserts a case that cannot happen in production —
  // which is exactly how the first version of this classifier shipped dead.
  it('re-kinds the client\'s normalised auth-expired error as a rejected credential', async () => {
    listMock.mockReturnValue([{ portalOrigin: 'https://vendor.honeybook.com' }]);
    getActiveClientMock.mockResolvedValue({
      scope: { userId: 'u1' },
      request: async () => {
        throw new Error(
          'HoneyBook auth expired for portal "Vendor Co" (https://vendor.honeybook.com). Use the `use_magic_link` tool to capture a fresh session.',
        );
      },
    });
    const r = await call();
    expect(r.error?.kind).toBe('credential_rejected');
    expect(r.hint).toMatch(/use_magic_link/);
  });

  // Belt and braces: a raw wire error that somehow bypassed request().
  it('also re-kinds a raw HBUnauthorizedError', async () => {
    listMock.mockReturnValue([{ portalOrigin: 'https://vendor.honeybook.com' }]);
    getActiveClientMock.mockResolvedValue({
      scope: { userId: 'u1' },
      request: async () => {
        throw Object.assign(new Error('HTTP 404: {"error":"HBUnauthorizedError"}'), { status: 404 });
      },
    });
    expect((await call()).error?.kind).toBe('credential_rejected');
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
