import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as flowClientModule from '../src/flow-client.js';
import { getFlow, useFlowLink } from '../src/tools/flows.js';
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
