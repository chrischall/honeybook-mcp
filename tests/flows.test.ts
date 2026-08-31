import { describe, it, expect } from 'vitest';
import {
  FLOW_WEAK_AUTH_PREFIX,
  flowStorageKey,
  isFlowLinkUrl,
  normalizeFlowKey,
  parseFlowLink,
  flowStore,
} from '../src/flows.js';
import type { CapturedFlowCredential } from '../src/types.js';

// A questionnaire ("flow") link is a SECOND magic-link shape, distinct from the
// client-portal link `use_magic_link` already handles. Verified live on
// 2026-08-31 against the shipped flow app
// (`public.honeybook.com/public_react_flow_app/.../main.*.js`):
//
//   getLimitedAuthStorageKey(flowId) => `${'HONEYBOOK_REACT_WEAK_AUTH'}_${flowId}`
//   getAuthHashUrlParameterFromSearchParam(p) => p.get('hash')
//
// so the flow id comes out of the PATH and the hash out of the QUERY, and the
// credential the page writes is scoped to that one flow.

const FLOW_LINK =
  'https://zoomws.hbportal.co/flow/69e64b0ff2eb57003a725a2d?hash=abc123&userId=6650&i=1&t=click&m=email';

describe('parseFlowLink', () => {
  it('derives the flow id from the path and the hash from the query', () => {
    expect(parseFlowLink(FLOW_LINK)).toEqual({
      flowId: '69e64b0ff2eb57003a725a2d',
      portalOrigin: 'https://zoomws.hbportal.co',
      hash: 'abc123',
    });
  });

  it('accepts a step sub-route (the flow app redirects to /flow/<id>/1-Questions)', () => {
    const parsed = parseFlowLink('https://zoomws.hbportal.co/flow/69e6/1-Questions?hash=h');
    expect(parsed.flowId).toBe('69e6');
    expect(parsed.hash).toBe('h');
  });

  it('reports a missing hash as null rather than inventing one', () => {
    expect(parseFlowLink('https://zoomws.hbportal.co/flow/69e6').hash).toBeNull();
  });

  it('refuses a client-portal link, naming the tool that handles it', () => {
    expect(() =>
      parseFlowLink('https://zoomws.hbportal.co/app/link/resolve/123/uuid?x=1')
    ).toThrow(/use_magic_link/);
  });
});

// The two link shapes must be told apart by a PREDICATE both tools import, not
// by either tool re-deriving "is this a flow link?" from a message or a regex
// of its own.
describe('isFlowLinkUrl', () => {
  it('is true for a /flow/ link and false for a portal link', () => {
    expect(isFlowLinkUrl(FLOW_LINK)).toBe(true);
    expect(isFlowLinkUrl('https://zoomws.hbportal.co/app/link/resolve/123/uuid')).toBe(false);
  });

  it('is false for input that is not a URL at all', () => {
    expect(isFlowLinkUrl('not a url')).toBe(false);
  });
});

describe('flowStorageKey', () => {
  it('is the prefix joined to the flow id, exactly as the flow app builds it', () => {
    expect(FLOW_WEAK_AUTH_PREFIX).toBe('HONEYBOOK_REACT_WEAK_AUTH');
    expect(flowStorageKey('69e64b0ff2eb57003a725a2d')).toBe(
      'HONEYBOOK_REACT_WEAK_AUTH_69e64b0ff2eb57003a725a2d'
    );
  });
});

describe('normalizeFlowKey', () => {
  it('accepts a bare flow id', () => {
    expect(normalizeFlowKey('69e64b0ff2eb57003a725a2d')).toBe('69e64b0ff2eb57003a725a2d');
  });

  it('accepts a full flow URL and reduces it to the flow id', () => {
    expect(normalizeFlowKey(FLOW_LINK)).toBe('69e64b0ff2eb57003a725a2d');
  });
});

const CREDENTIAL: CapturedFlowCredential = {
  flowId: '69e64b0ff2eb57003a725a2d',
  portalOrigin: 'https://zoomws.hbportal.co',
  companyName: 'zoomws',
  hash: 'abc123',
  userId: 'uid_1',
  email: 'client@example.com',
  capturedAt: 1745000000000,
};

describe('flowStore', () => {
  it('keys by flow id and looks up by a full flow URL', () => {
    flowStore.resetForTest();
    flowStore.add(CREDENTIAL);
    expect(flowStore.get(FLOW_LINK)?.hash).toBe('abc123');
    expect(flowStore.get('69e64b0ff2eb57003a725a2d')?.hash).toBe('abc123');
  });

  // The portal store must never see a flow credential and vice versa: keeping
  // them in separate files is what makes "a portal tool cannot silently accept
  // a flow credential" structural rather than a check someone can forget.
  it('persists to its own file, not the portal sessions file', async () => {
    const { sessionsFilePath } = await import('../src/sessions.js');
    const { flowsFilePath } = await import('../src/flows.js');
    expect(flowsFilePath).not.toBe(sessionsFilePath);
    expect(flowsFilePath.endsWith('flows.json')).toBe(true);
  });
});
