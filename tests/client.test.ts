import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchApiVersion,
  HoneyBookClient,
  getActiveClient,
  resetClientsForTest,
  currentModuleApiVersion,
} from '../src/client.js';
import * as sessionsModule from '../src/sessions.js';
import type { CapturedSession } from '../src/types.js';

const MOCK_SESSION: CapturedSession = {
  portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
  companyName: 'The Silk Veil Events by Ivy',
  authToken: 'tok_43',
  userId: 'uid_24',
  trustedDevice: 'td_64',
  fingerprint: 'fp_32',
  capturedAt: 1745000000000,
};

describe('fetchApiVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HONEYBOOK_API_VERSION;
  });

  it('uses HONEYBOOK_API_VERSION when set', async () => {
    process.env.HONEYBOOK_API_VERSION = '9999';
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchApiVersion()).toBe(9999);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches /api/gon and parses the JSONP callback', async () => {
    const body = '/**/parseGon({"api_version":2578,"version":"36.122.376"})';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200 })
    );
    expect(await fetchApiVersion()).toBe(2578);
  });

  it('throws when the callback body is unparseable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 200 })
    );
    await expect(fetchApiVersion()).rejects.toThrow(/api_version/);
  });
});

describe('HoneyBookClient.request', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the 8 required headers on a GET', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(MOCK_SESSION, 2578);
    await client.request('GET', '/api/v2/users/uid_24');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.honeybook.com/api/v2/users/uid_24');
    const h = init!.headers as Record<string, string>;
    expect(h['hb-api-auth-token']).toBe('tok_43');
    expect(h['hb-api-user-id']).toBe('uid_24');
    expect(h['hb-trusted-device']).toBe('td_64');
    expect(h['hb-api-client-version']).toBe('2578');
    expect(h['hb-api-fingerprint']).toBe('fp_32');
    expect(h['hb-admin-login']).toBe('false');
    expect(h['accept']).toBe('application/json, text/plain, */*');
    expect(h['hb-api-duplicate-calls-prevention-uuid']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('parses JSON response bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ _id: 'abc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(MOCK_SESSION, 2578);
    const res = await client.request<{ _id: string }>('GET', '/api/v2/users/uid_24');
    expect(res).toEqual({ _id: 'abc' });
  });

  it('sends JSON body on POST with content-type header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const client = new HoneyBookClient(MOCK_SESSION, 2578);
    await client.request('POST', '/api/v2/workspace_files/x/sign', { signature: 'yes' });
    const [, init] = fetchSpy.mock.calls[0];
    const h = init!.headers as Record<string, string>;
    expect(h['content-type']).toBe('application/json');
    expect(init!.body).toBe(JSON.stringify({ signature: 'yes' }));
  });

  it('throws on non-2xx with status and truncated body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('server exploded', { status: 500, statusText: 'Internal Server Error' })
    );
    const client = new HoneyBookClient(MOCK_SESSION, 2578);
    await expect(client.request('GET', '/api/v2/users/uid_24')).rejects.toThrow(
      /500 Internal Server Error.*server exploded/
    );
  });

  it('throws a clear auth message on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":true,"error_type":"HBAuthenticationError"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(MOCK_SESSION, 2578);
    await expect(client.request('GET', '/api/v2/users/uid_24')).rejects.toThrow(
      /HoneyBook auth expired for portal "The Silk Veil Events by Ivy".*use_magic_link/
    );
  });

  it('re-fetches api version and retries once on HBWrongAPIVersionError', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":true,"error_type":"HBWrongAPIVersionError","error_data":{"server_api_version":9999}}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ _id: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(MOCK_SESSION, 2578);
    const res = await client.request<{ _id: string }>('GET', '/api/v2/users/uid_24');
    expect(res).toEqual({ _id: 'ok' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchSpy.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(secondHeaders['hb-api-client-version']).toBe('9999');
  });

  it('updates module-level api version after version-retry so next client inherits the fix', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":true,"error_type":"HBWrongAPIVersionError","error_data":{"server_api_version":9999}}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const client = new HoneyBookClient(MOCK_SESSION, 2578);
    await client.request('GET', '/api/v2/users/uid_24');
    expect(await currentModuleApiVersion()).toBe(9999);

    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const version = (await currentModuleApiVersion()) ?? 2578;
    const client2 = new HoneyBookClient(MOCK_SESSION, version);
    await client2.request('GET', '/api/v2/users/uid_24');
    const secondCallHeaders = fetchSpy.mock.calls[2]![1]!.headers as Record<string, string>;
    expect(secondCallHeaders['hb-api-client-version']).toBe('9999');
  });

  it('retries once after a 429 with a 2s backoff', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(new Response('', { status: 429 }));
      fetchSpy.mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      );
      const client = new HoneyBookClient(MOCK_SESSION, 2578);
      const p = client.request('GET', '/api/v2/users/uid_24');
      await vi.advanceTimersByTimeAsync(2000);
      await p;
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws "Rate limited" after two consecutive 429s', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValue(new Response('', { status: 429 }));
      const client = new HoneyBookClient(MOCK_SESSION, 2578);
      const caught = client.request('GET', '/api/v2/users/uid_24').catch((e) => e);
      await vi.advanceTimersByTimeAsync(2000);
      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/Rate limited by HoneyBook API/);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getActiveClient', () => {
  beforeEach(() => {
    resetClientsForTest();
    sessionStore.resetForTest();
    process.env.HONEYBOOK_API_VERSION = '2578';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetClientsForTest();
    sessionStore.resetForTest();
    delete process.env.HONEYBOOK_API_VERSION;
  });

  it('throws with helpful message when no sessions are active', async () => {
    await expect(getActiveClient()).rejects.toThrow(/use_magic_link/);
  });

  it('throws with origin list when origin is specified but no sessions active', async () => {
    // No sessions loaded
    await expect(getActiveClient('https://unknown.hbportal.co')).rejects.toThrow(/use_magic_link/);
  });

  it('throws with active origins when requested origin is unknown', async () => {
    vi.spyOn(sessionsModule.sessionStore, 'get').mockReturnValue(null);
    vi.spyOn(sessionsModule.sessionStore, 'list').mockReturnValue([MOCK_SESSION]);
    await expect(getActiveClient('https://unknown.hbportal.co')).rejects.toThrow(
      /No active session for origin.*thesilkveileventsbyivy/
    );
  });

  it('returns a HoneyBookClient for the most-recent session when no origin given', async () => {
    vi.spyOn(sessionsModule.sessionStore, 'get').mockReturnValue(MOCK_SESSION);
    const client = await getActiveClient();
    expect(client).toBeInstanceOf(HoneyBookClient);
    expect(client.scope.portalOrigin).toBe(MOCK_SESSION.portalOrigin);
  });

  it('caches the client by portalOrigin on repeated calls', async () => {
    vi.spyOn(sessionsModule.sessionStore, 'get').mockReturnValue(MOCK_SESSION);
    const c1 = await getActiveClient();
    const c2 = await getActiveClient();
    expect(c1).toBe(c2);
  });
});
