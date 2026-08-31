import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FlowClient,
  fetchFlowMinimal,
  flowContextId,
  getActiveFlowClient,
  NO_FLOW_CREDENTIAL_MESSAGE,
  type FlowMinimal,
} from '../src/flow-client.js';
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

// ── The two-step read: /minimal supplies the ctxc that /active requires ──────

describe('fetchFlowMinimal', () => {
  it('GETs the PUBLIC /api/v2/flow/<id>/minimal with user_id as a query param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ branding_data: { company_id: 'c1' } }), { status: 200 })
    );
    await fetchFlowMinimal('f1', { userId: 'u1', apiVersion: 2610 });
    const [url, init] = fetchSpy.mock.calls[0]!;
    // No `/client/` on this one: the app fetches it through its NO-AUTH service,
    // which does not run the interceptor that rewrites the path.
    expect(url).toBe('https://api.honeybook.com/api/v2/flow/f1/minimal?user_id=u1');
    // And the credential is not spent here: verified live that this endpoint
    // answers 200 unauthenticated, so sending the hash would be authority the
    // call does not need.
    const h = (init!.headers ?? {}) as Record<string, string>;
    expect(h['hb-api-w-hash']).toBeUndefined();
  });

  it('omits user_id when the credential carries none', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ branding_data: { company_id: 'c1' } }), { status: 200 })
    );
    await fetchFlowMinimal('f1', { apiVersion: 2610 });
    expect(fetchSpy.mock.calls[0]![0]).toBe('https://api.honeybook.com/api/v2/flow/f1/minimal');
  });

  it('reports a non-200 as a flow-shaped error rather than a bare status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(fetchFlowMinimal('f1', { apiVersion: 2610 })).rejects.toThrow(/minimal/);
  });
});

describe('flowContextId', () => {
  // Verified live: `branding_data.company_id` is the only 24-hex id in the
  // /minimal response, and the app's interceptor sets `params.ctxc` from
  // `clientPortalConfigStore.clientPortalCompanyId` — the same company id.
  it('reads branding_data.company_id', () => {
    expect(flowContextId({ branding_data: { company_id: 'c1' } } as FlowMinimal)).toBe('c1');
  });

  it('is null rather than a guess when the response carries none', () => {
    expect(flowContextId({} as FlowMinimal)).toBeNull();
    expect(flowContextId({ branding_data: {} } as FlowMinimal)).toBeNull();
  });
});

// `hb-api-client-version` is REQUIRED on a flow read, isolated by elimination
// against the live API on 2026-08-31: hash + user-id alone answers 400, adding
// `hb-api-fingerprint` is still 400, adding this header makes it 200.
describe('the required client version', () => {
  it('is sent on every flow request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await new FlowClient(CREDENTIAL, 2610).request('GET', '/api/v2/client/flow/x/active?ctxc=c1');
    const h = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(h['hb-api-client-version']).toBe('2610');
  });

  // The version is read from /api/gon at startup, so it tracks HoneyBook — but
  // HONEYBOOK_API_VERSION can pin a value that rots. When it does, the endpoint
  // answers a bare 400 "Unexpected server error" with no error_type: nothing in
  // it says which input was wrong, and it reads exactly like an auth failure.
  it('turns a bare 400 into an error naming the version and ctxc, and denying it is auth', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: true, error_message: 'Unexpected server error' }),
        { status: 400 }
      )
    );
    const err = await new FlowClient(CREDENTIAL, 2610)
      .request('GET', '/api/v2/client/flow/x/active?ctxc=c1')
      .catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/hb-api-client-version/);
    expect(err.message).toMatch(/2610/);
    expect(err.message).toMatch(/ctxc/);
    // The whole point: do NOT send someone to re-capture a working credential.
    expect(err.message).toMatch(/NOT an auth failure/);
    expect(err.message).toMatch(/use_flow_link`? will not help/);
  });

  it('leaves a non-400 failure alone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const err = await new FlowClient(CREDENTIAL, 2610)
      .request('GET', '/x')
      .catch((e: unknown) => e as Error);
    expect(err.message).not.toMatch(/hb-api-client-version/);
  });
});
