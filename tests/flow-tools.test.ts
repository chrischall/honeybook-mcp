import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as flowClientModule from '../src/flow-client.js';
import { FLOW_VIEWS, flowCaptureResult, getFlow, useFlowLink } from '../src/tools/flows.js';
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
  // No `full`: `raw` already IS the whole payload we received here, and a rung
  // that silently aliases to another is a lie in the schema. Pinned rather
  // than assumed — `PROJECT_VIEWS` has the same assertion in projects.test.ts,
  // and #193 claimed both were covered when only one was.
  it('advertises only the rungs it honours', () => {
    expect(FLOW_VIEWS).toEqual(['compact', 'raw']);
  });


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

  // `ctxc` is NOT required, and a missing one must not stop the read.
  //
  // 0.8.0 refused here, on the belief that /active without a ctxc answers the
  // same bare 400 as a stale client version. Probed against the live API on
  // 2026-08-31 with a real credential, that is false: omitting ctxc, sending a
  // bogus one, and dropping `/client/` all return the SAME 200 — byte-identical
  // payloads, same sha256, 96,246 bytes each. Only the credential and a current
  // `hb-api-client-version` are load-bearing. So the guard could never prevent a
  // real failure and could only invent one, for any flow whose /minimal happens
  // not to carry branding_data.company_id.
  it('reads the flow when /minimal carries no context id, omitting ctxc', async () => {
    stubMinimal(null);
    const fake = stubClient({ _id: 'f1', title: 'Wedding Questionnaire' });
    const parsed = parse<{ flow: { title: string }; contextId: string | null }>(await getFlow({}));
    expect(fake.request).toHaveBeenCalledWith(
      'GET',
      '/api/v2/client/flow/69e64b0ff2eb57003a725a2d/active'
    );
    expect(parsed.flow.title).toBe('Wedding Questionnaire');
    // Still reported, so a failure still says which company id was in play.
    expect(parsed.contextId).toBeNull();
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
    expect(parsed.truncated?.hint).toMatch(/view="raw"/);
  });

  it('returns the whole payload when asked for raw, however big', async () => {
    stubMinimal();
    stubClient({ _id: 'f1', blob: 'x'.repeat(400_000) });
    const parsed = parse<{ flow: { blob: string } }>(await getFlow({ view: 'raw' }));
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
