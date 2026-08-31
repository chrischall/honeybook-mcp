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

describe('get_flow', () => {
  it('reads the flow the questionnaire page itself reads', async () => {
    const fake = {
      credential: CREDENTIAL,
      request: vi.fn().mockResolvedValue({ _id: 'f1', title: 'Wedding Questionnaire' }),
    };
    vi.spyOn(flowClientModule, 'getActiveFlowClient').mockResolvedValue(
      fake as unknown as flowClientModule.FlowClient
    );
    const parsed = parse<{ flow: { title: string } }>(await getFlow({}));
    // Verified from the shipped flow app: `_fetchFlow` GETs
    // /api/v2/flow/<id>/active. No other read path exists for a flow.
    expect(fake.request).toHaveBeenCalledWith(
      'GET',
      '/api/v2/flow/69e64b0ff2eb57003a725a2d/active'
    );
    expect(parsed.flow.title).toBe('Wedding Questionnaire');
  });

  // `pruneWorkspaceFile` exists because a real proposal measured ~1.3 MB, and a
  // questionnaire is the same class of object. Nobody has measured a real
  // `/active` payload, so pruning by FIELD would be invention — but a byte
  // ceiling needs no schema at all, which is why this guard is schema-agnostic.
  it('refuses to return an oversized flow, and says how to get it anyway', async () => {
    const huge = { _id: 'f1', title: 'Big', blob: 'x'.repeat(400_000) };
    const fake = { credential: CREDENTIAL, request: vi.fn().mockResolvedValue(huge) };
    vi.spyOn(flowClientModule, 'getActiveFlowClient').mockResolvedValue(
      fake as unknown as flowClientModule.FlowClient
    );
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
    const huge = { _id: 'f1', blob: 'x'.repeat(400_000) };
    const fake = { credential: CREDENTIAL, request: vi.fn().mockResolvedValue(huge) };
    vi.spyOn(flowClientModule, 'getActiveFlowClient').mockResolvedValue(
      fake as unknown as flowClientModule.FlowClient
    );
    const parsed = parse<{ flow: { blob: string } }>(await getFlow({ section: 'raw' }));
    expect(parsed.flow.blob.length).toBe(400_000);
  });

  it('returns a small flow untouched, with no truncation envelope', async () => {
    const fake = {
      credential: CREDENTIAL,
      request: vi.fn().mockResolvedValue({ _id: 'f1', title: 'Small' }),
    };
    vi.spyOn(flowClientModule, 'getActiveFlowClient').mockResolvedValue(
      fake as unknown as flowClientModule.FlowClient
    );
    const parsed = parse<{ flow: unknown; truncated?: unknown }>(await getFlow({}));
    expect(parsed.truncated).toBeUndefined();
    expect(parsed.flow).toEqual({ _id: 'f1', title: 'Small' });
  });

  it('passes an explicit flow_id through to the resolver', async () => {
    const fake = {
      credential: { ...CREDENTIAL, flowId: 'other' },
      request: vi.fn().mockResolvedValue({}),
    };
    const spy = vi
      .spyOn(flowClientModule, 'getActiveFlowClient')
      .mockResolvedValue(fake as unknown as flowClientModule.FlowClient);
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
