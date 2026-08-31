import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as flowClientModule from '../src/flow-client.js';
import { flowCaptureResult, getFlow, useFlowLink } from '../src/tools/flows.js';
import { listActiveSessions, useMagicLink } from '../src/tools/sessions.js';
import { flowStore } from '../src/flows.js';
import { sessionStore } from '../src/sessions.js';
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

function parse<T>(result: { content: { text: string }[] }): T {
  return JSON.parse(result.content[0]!.text) as T;
}

beforeEach(() => {
  flowStore.resetForTest();
  sessionStore.resetForTest();
});

afterEach(() => vi.restoreAllMocks());

// The field was captured and typed but reported nowhere, and its comment said
// "Reported, never sent" — which was wrong in both halves: it was neither.
// Either report it or drop the capture; a credential field nothing consumes is
// a claim the code does not keep.
describe('is_real_chargeable_user is reported where it was captured', () => {
  it('use_flow_link reports it', async () => {
    const parsed = parse<{ isRealChargeableUser: boolean | null }>(
      flowCaptureResult({ ...CREDENTIAL, isRealChargeableUser: true })
    );
    expect(parsed.isRealChargeableUser).toBe(true);
  });

  it('reports null rather than omitting it when the blob did not carry it', async () => {
    const parsed = parse<{ isRealChargeableUser: boolean | null }>(flowCaptureResult(CREDENTIAL));
    expect(parsed.isRealChargeableUser).toBeNull();
  });

  // The type's comment claims BOTH sites report it. Asserting the second one
  // keeps that comment honest — writing it without this test is how the
  // original "Reported, never sent" came to be wrong in both halves.
  it('list_active_sessions reports it on every flow row', async () => {
    flowStore.add({ ...CREDENTIAL, isRealChargeableUser: false });
    const parsed = parse<{ flowCredentials: { isRealChargeableUser: boolean | null }[] }>(
      await listActiveSessions()
    );
    expect(parsed.flowCredentials[0]!.isRealChargeableUser).toBe(false);
  });
});

const CONTEXT_ID = '6961a7ca172a600029289e98';

/**
 * Stub the public `/minimal` leg. Kept as a helper because EVERY get_flow test
 * now needs it — the read is two calls, not one, and a test that stubs only the
 * second is asserting a request shape that cannot happen.
 */
function stubMinimal(contextId: string | null = CONTEXT_ID) {
  return vi
    .spyOn(flowClientModule, 'fetchFlowMinimal')
    .mockResolvedValue(
      (contextId === null
        ? { branding_data: {} }
        : { branding_data: { company_id: contextId } }) as flowClientModule.FlowMinimal
    );
}

function stubClient(flow: unknown, credential = CREDENTIAL) {
  const fake = { credential, request: vi.fn().mockResolvedValue(flow), getApiVersion: () => 2610 };
  vi.spyOn(flowClientModule, 'getActiveFlowClient').mockResolvedValue(
    fake as unknown as flowClientModule.FlowClient
  );
  return fake;
}

describe('get_flow', () => {
  // The URL the flow app ACTUALLY requests, from a HAR of the live
  // questionnaire (2026-08-31). Two things are invisible in the app's own
  // adapter and were wrong in 0.8.0's unreleased code:
  //
  //   * `/client/` — injected one layer below the adapter, by
  //     `addClientToUrl(u) => u.replace('/api/v2/', '/api/v2/client/')` in the
  //     shared request interceptor. Reading `_fetchFlow` alone cannot see it.
  //   * `?ctxc=` — the company id, set by that same interceptor from
  //     `clientPortalConfigStore.clientPortalCompanyId`.
  //
  // Neither is detectable by probing unauthenticated: BOTH paths answer
  // 404 + HBUnauthorizedError with no credential, so only a real 200 tells
  // them apart.
  it('GETs /api/v2/client/flow/<id>/active?ctxc=<contextId>', async () => {
    stubMinimal();
    const fake = stubClient({ _id: 'f1', title: 'Wedding Questionnaire' });
    const parsed = parse<{ flow: { title: string }; contextId: string }>(await getFlow({}));
    expect(fake.request).toHaveBeenCalledWith(
      'GET',
      '/api/v2/client/flow/69e64b0ff2eb57003a725a2d/active?ctxc=6961a7ca172a600029289e98'
    );
    expect(parsed.flow.title).toBe('Wedding Questionnaire');
    expect(parsed.contextId).toBe(CONTEXT_ID);
  });

  // /minimal takes user_id as a QUERY parameter, not a header — the one place
  // in this MCP where a user id travels in the query.
  it('asks /minimal for the context id, passing the credential\'s user id', async () => {
    const spy = stubMinimal();
    stubClient({});
    await getFlow({});
    expect(spy).toHaveBeenCalledWith('69e64b0ff2eb57003a725a2d', {
      userId: 'uid_9',
      apiVersion: 2610,
    });
  });

  // A missing ctxc is a 400 that reads like an auth failure, which would send
  // someone to re-capture a credential that is fine. Refuse before the call.
  it('refuses when /minimal carries no context id, without calling /active', async () => {
    stubMinimal(null);
    const fake = stubClient({});
    await expect(getFlow({})).rejects.toThrow(/context id/i);
    await expect(getFlow({})).rejects.toThrow(/not an auth problem/i);
    expect(fake.request).not.toHaveBeenCalled();
  });

  // `pruneWorkspaceFile` exists because a real proposal measured ~1.3 MB, and a
  // questionnaire is the same class of object. A real `/active` payload has now
  // been measured at 96,246 bytes — comfortably under the ceiling, so it stands
  // as calibrated rather than guessed. Pruning by FIELD is still not done: one
  // measurement is a size, not a schema.
  it('refuses to return an oversized flow, and says how to get it anyway', async () => {
    stubMinimal();
    stubClient({ _id: 'f1', title: 'Big', blob: 'x'.repeat(400_000) });
    const parsed = parse<{
      flow?: unknown;
      truncated?: { bytes: number; limit: number; topLevelKeys: string[]; hint: string };
    }>(await getFlow({}));
    expect(parsed.flow).toBeUndefined();
    expect(parsed.truncated?.bytes).toBeGreaterThan(parsed.truncated!.limit);
    // The keys are the navigational half — a caller has to learn what IS there
    // without being handed a megabyte to find out.
    expect(parsed.truncated?.topLevelKeys).toContain('blob');
    expect(parsed.truncated?.hint).toMatch(/section="raw"/);
  });

  it('returns the whole payload when asked for raw, however big', async () => {
    stubMinimal();
    stubClient({ _id: 'f1', blob: 'x'.repeat(400_000) });
    const parsed = parse<{ flow: { blob: string } }>(await getFlow({ section: 'raw' }));
    expect(parsed.flow.blob.length).toBe(400_000);
  });

  it('returns a small flow untouched, with no truncation envelope', async () => {
    stubMinimal();
    stubClient({ _id: 'f1', title: 'Small' });
    const parsed = parse<{ flow: unknown; truncated?: unknown }>(await getFlow({}));
    expect(parsed.truncated).toBeUndefined();
    expect(parsed.flow).toEqual({ _id: 'f1', title: 'Small' });
  });

  it('passes an explicit flow_id through to the resolver', async () => {
    stubMinimal();
    stubClient({}, { ...CREDENTIAL, flowId: 'other' });
    const spy = vi.spyOn(flowClientModule, 'getActiveFlowClient');
    await getFlow({ flow_id: 'other' });
    expect(spy).toHaveBeenCalledWith('other');
  });
});

describe('use_flow_link / use_magic_link cross-refusal', () => {
  // Each tool refuses the OTHER shape by importing one shared predicate, so
  // there is no second place where "is this a flow link?" can be re-decided.
  it('use_magic_link refuses a /flow/ link and names use_flow_link', async () => {
    await expect(
      useMagicLink({
        magic_link_url: 'https://zoomws.hbportal.co/flow/69e6?hash=h',
      })
    ).rejects.toThrow(/use_flow_link/);
  });

  it('use_flow_link refuses a client-portal link and names use_magic_link', async () => {
    await expect(
      useFlowLink({ flow_link_url: 'https://zoomws.hbportal.co/app/link/resolve/1/2' })
    ).rejects.toThrow(/use_magic_link/);
  });
});

describe('list_active_sessions', () => {
  it('reports the two credential kinds separately', async () => {
    sessionStore.add(PORTAL_SESSION);
    flowStore.add(CREDENTIAL);
    const parsed = parse<{
      portalSessions: { kind: string; portalOrigin: string }[];
      flowCredentials: { kind: string; flowId: string }[];
    }>(await listActiveSessions());

    expect(parsed.portalSessions).toHaveLength(1);
    expect(parsed.portalSessions[0]!.kind).toBe('portal-session');
    expect(parsed.flowCredentials).toHaveLength(1);
    expect(parsed.flowCredentials[0]!.kind).toBe('flow-credential');
    expect(parsed.flowCredentials[0]!.flowId).toBe('69e64b0ff2eb57003a725a2d');
  });

  it('never leaks the credential value itself', async () => {
    flowStore.add(CREDENTIAL);
    const text = (await listActiveSessions()).content[0]!.text;
    expect(text).not.toContain('h_abc');
  });

  it('reports both kinds as empty when nothing is captured', async () => {
    expect(parse(await listActiveSessions())).toEqual({
      portalSessions: [],
      flowCredentials: [],
    });
  });
});
