import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FlowClient, getActiveFlowClient, NO_FLOW_CREDENTIAL_MESSAGE } from '../src/flow-client.js';
import { flowStore } from '../src/flows.js';
import { sessionStore } from '../src/sessions.js';
import {
  getActiveClient,
  isNoPortalSessionError,
  NO_ACTIVE_SESSION_MESSAGE,
  resetClientsForTest,
} from '../src/client.js';
import type { CapturedFlowCredential, CapturedSession } from '../src/types.js';

const CREDENTIAL: CapturedFlowCredential = {
  flowId: '69e64b0ff2eb57003a725a2d',
  portalOrigin: 'https://zoomws.hbportal.co',
  companyName: 'zoomws',
  hash: 'h_abc',
  userId: 'uid_9',
  email: 'client@example.com',
  capturedAt: 1745000000000,
};

const PORTAL_SESSION: CapturedSession = {
  portalOrigin: 'https://vendor.hbportal.co',
  companyName: 'Vendor Co',
  authToken: 'tok_1',
  userId: 'uid_1',
  capturedAt: 1745000000000,
};

beforeEach(() => {
  flowStore.resetForTest();
  sessionStore.resetForTest();
  resetClientsForTest();
  process.env.HONEYBOOK_API_VERSION = '2610';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.HONEYBOOK_API_VERSION;
});

// Header names verified live from https://api.honeybook.com/api/gon on
// 2026-08-31: hb_api_headers.weak_auth_hash = 'HB-Api-W-Hash',
// weak_auth_user_id = 'HB-Api-W-User-Id', weak_auth_user_email = 'HB-Api-W-Email'.
// The portal's HB-Api-Auth-Token / HB-Api-User-Id have NO part in this path.
describe('FlowClient.request', () => {
  it('sends the weak-auth headers and never a portal auth token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new FlowClient(CREDENTIAL, 2610);
    await client.request('GET', '/api/v2/flow/69e64b0ff2eb57003a725a2d/active');

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.honeybook.com/api/v2/flow/69e64b0ff2eb57003a725a2d/active');
    const h = init!.headers as Record<string, string>;
    expect(h['hb-api-w-hash']).toBe('h_abc');
    expect(h['hb-api-w-user-id']).toBe('uid_9');
    expect(h['hb-api-w-email']).toBe('client@example.com');
    expect(h['hb-api-client-version']).toBe('2610');
    expect(h['hb-api-auth-token']).toBeUndefined();
    expect(h['hb-api-user-id']).toBeUndefined();
  });

  it('omits the optional identity headers a credential does not carry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 })
    );
    await new FlowClient({ ...CREDENTIAL, userId: undefined, email: undefined }, 2610).request(
      'GET',
      '/x'
    );
    const h = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect('hb-api-w-user-id' in h).toBe(false);
    expect('hb-api-w-email' in h).toBe(false);
  });

  // Verified live: an unauthenticated GET of /api/v2/flow/<id>/active answers
  // 404 with an HBUnauthorizedError body, exactly as the portal API does for a
  // dead token. Left unmapped it reads as "that questionnaire does not exist".
  it('maps 404 + HBUnauthorizedError to a re-capture instruction naming use_flow_link', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: true, error_type: 'HBUnauthorizedError' }),
        { status: 404 }
      )
    );
    await expect(
      new FlowClient(CREDENTIAL, 2610).request('GET', '/api/v2/flow/x/active')
    ).rejects.toThrow(/use_flow_link/);
  });

  it('leaves a plain 404 as an ordinary API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no such flow', { status: 404 }));
    await expect(
      new FlowClient(CREDENTIAL, 2610).request('GET', '/api/v2/flow/x/active')
    ).rejects.toThrow(/404/);
  });
});

describe('getActiveFlowClient', () => {
  it('resolves the most recently captured credential when none is named', async () => {
    flowStore.add(CREDENTIAL);
    flowStore.add({ ...CREDENTIAL, flowId: 'later', hash: 'h_later' });
    expect((await getActiveFlowClient()).credential.flowId).toBe('later');
  });

  it('refuses with the shared no-credential message when none is captured', async () => {
    await expect(getActiveFlowClient()).rejects.toThrow(NO_FLOW_CREDENTIAL_MESSAGE);
  });

  // A portal session is NOT a flow credential: it authorises different calls
  // and carries none of the weak-auth fields. Accepting it here would produce
  // an opaque upstream 404 instead of an answerable error.
  it('does not accept a portal session in place of a flow credential', async () => {
    sessionStore.add(PORTAL_SESSION);
    await expect(getActiveFlowClient()).rejects.toThrow(/use_flow_link/);
  });
});

describe('getActiveClient with only a flow credential', () => {
  // The mirror image, and the one the brief calls out: a portal tool must not
  // silently accept a flow credential and fail later upstream.
  it('names the credential kind that IS present and the one required', async () => {
    flowStore.add(CREDENTIAL);
    await expect(getActiveClient()).rejects.toThrow(/flow \(questionnaire\) credential/i);
    await expect(getActiveClient()).rejects.toThrow(/use_magic_link/);
  });

  it('is still classified as "no portal session", not as a rejected one', async () => {
    flowStore.add(CREDENTIAL);
    const err = await getActiveClient().catch((e: unknown) => e);
    // A PREDICATE exported by the module that throws — never a prose match on
    // the message, whose remedy (`use_magic_link`) doubles as the symptom the
    // healthcheck's rejection regex looks for.
    expect(isNoPortalSessionError(err)).toBe(true);
  });

  it('keeps the plain no-session message when nothing at all is captured', async () => {
    const err = await getActiveClient().catch((e: unknown) => e);
    expect((err as Error).message).toBe(NO_ACTIVE_SESSION_MESSAGE);
    expect(isNoPortalSessionError(err)).toBe(true);
  });
});
