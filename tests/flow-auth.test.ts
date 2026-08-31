import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// captureFlowCredentialViaFetchproxy() is the questionnaire twin of
// captureSessionViaFetchproxy(). It reads a DIFFERENT localStorage key — one
// named after the flow — and produces a DIFFERENT credential kind.
//
// Verified against the shipped flow app bundle (2026-08-31):
//   setWeakTokenInStorage() writes
//     localStorage[`HONEYBOOK_REACT_WEAK_AUTH_${flowId}`] =
//       JSON.stringify({ hash, _id, email, is_real_chargeable_user })
// and getHeaders() sends that `hash` / `_id` / `email` as the weak-auth
// headers. There is no `authentication_token` on this path at all.

const bootstrapMock = vi.fn();
vi.mock('@fetchproxy/bootstrap', () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...args),
}));

const { captureFlowCredentialViaFetchproxy } = await import('../src/flow-auth.js');
const { flowStore } = await import('../src/flows.js');

const FLOW_LINK =
  'https://zoomws.hbportal.co/flow/69e64b0ff2eb57003a725a2d?hash=urlhash&userId=u1&t=click';

function bootstrapResult(localStorage: Record<string, string>) {
  return {
    cookies: {},
    localStorage,
    sessionStorage: {},
    capturedHeaders: {},
    indexedDb: {},
  };
}

describe('captureFlowCredentialViaFetchproxy', () => {
  let originalDisable: string | undefined;

  beforeEach(() => {
    originalDisable = process.env.HONEYBOOK_DISABLE_FETCHPROXY;
    delete process.env.HONEYBOOK_DISABLE_FETCHPROXY;
    bootstrapMock.mockReset();
    flowStore.resetForTest();
  });

  afterEach(() => {
    if (originalDisable === undefined) delete process.env.HONEYBOOK_DISABLE_FETCHPROXY;
    else process.env.HONEYBOOK_DISABLE_FETCHPROXY = originalDisable;
  });

  it('declares the flow-scoped storage key and pointers into it', async () => {
    bootstrapMock.mockResolvedValue(
      bootstrapResult({
        HB_FLOW_HASH: 'storedhash',
        HB_FLOW_USER_ID: 'uid_9',
        HB_FLOW_EMAIL: 'client@example.com',
      })
    );

    await captureFlowCredentialViaFetchproxy({ flowLinkUrl: FLOW_LINK });

    const opts = bootstrapMock.mock.calls[0]![0] as {
      domains: string[];
      storageDomain: string;
      declare: {
        localStoragePointers: { outputKey: string; storageKey: string; jsonPointer: string }[];
        captureHeaders: unknown[];
      };
    };
    expect(opts.storageDomain).toBe('hbportal.co');
    const pointers = opts.declare.localStoragePointers;
    // Every pointer targets the ONE flow-scoped key — never the portal's
    // HONEYBOOK_REACT_CURR_USER, which this credential kind does not use.
    expect(new Set(pointers.map((p) => p.storageKey))).toEqual(
      new Set(['HONEYBOOK_REACT_WEAK_AUTH_69e64b0ff2eb57003a725a2d'])
    );
    expect(pointers.map((p) => p.jsonPointer).sort()).toEqual([
      '/_id',
      '/email',
      '/hash',
      '/is_real_chargeable_user',
    ]);
    expect(opts.declare.captureHeaders).toEqual([]);
  });

  it('persists a flow credential keyed by flow id, preferring the STORED hash', async () => {
    bootstrapMock.mockResolvedValue(
      bootstrapResult({
        HB_FLOW_HASH: 'storedhash',
        HB_FLOW_USER_ID: 'uid_9',
        HB_FLOW_EMAIL: 'client@example.com',
      })
    );

    const cred = await captureFlowCredentialViaFetchproxy({ flowLinkUrl: FLOW_LINK });

    expect(cred.flowId).toBe('69e64b0ff2eb57003a725a2d');
    expect(cred.portalOrigin).toBe('https://zoomws.hbportal.co');
    // The page rewrites storage from the URL, so the two normally agree; when
    // they disagree the STORED one is what the page would send.
    expect(cred.hash).toBe('storedhash');
    expect(cred.userId).toBe('uid_9');
    expect(cred.email).toBe('client@example.com');
    expect(flowStore.get('69e64b0ff2eb57003a725a2d')?.hash).toBe('storedhash');
  });

  it('falls back to the hash in the link when storage carries none', async () => {
    bootstrapMock.mockResolvedValue(bootstrapResult({ HB_FLOW_USER_ID: 'uid_9' }));
    const cred = await captureFlowCredentialViaFetchproxy({ flowLinkUrl: FLOW_LINK });
    expect(cred.hash).toBe('urlhash');
  });

  // The hash IS the credential — a capture with neither source is not a
  // degraded success, it is nothing.
  it('fails when neither storage nor the link supplies a hash', async () => {
    bootstrapMock.mockResolvedValue(bootstrapResult({}));
    await expect(
      captureFlowCredentialViaFetchproxy({
        flowLinkUrl: 'https://zoomws.hbportal.co/flow/69e6',
      })
    ).rejects.toThrow(/hash/i);
  });

  // Each flow adds a NEW key to the declared scope, and the extension gates on
  // the scope approved at pair time — so the re-approval prompt is expected
  // once per flow rather than a fault. The message has to say so, or it reads
  // as the MCP being broken.
  it('explains the per-flow re-approval when the extension refuses the scope', async () => {
    const err = Object.assign(new Error('localStorage keys not in declared set: X'), {
      name: 'FetchproxyScopeError',
    });
    bootstrapMock.mockRejectedValue(err);
    await expect(
      captureFlowCredentialViaFetchproxy({ flowLinkUrl: FLOW_LINK })
    ).rejects.toThrow(/re-approve|approve/i);
  });

  // Leads with GRANT, not revoke. A growing scope is not a blocked one: the
  // extension serves the intersection, keeps the session up, and queues a
  // non-blocking "<serverName> wants to expand its access" offer with a Grant
  // button (fetchproxy background/hello.ts — only a domains/serverName change
  // forces a re-pair). Revoking works but throws the pairing away to rebuild
  // it, and it is what the upstream message says, so this has to name the
  // one-click path FIRST or people do the slow one — which is exactly what
  // happened in a real session.
  it('offers Grant before revoke when the extension refuses the scope', async () => {
    const err = Object.assign(new Error('localStorage keys not in declared set: X'), {
      name: 'FetchproxyScopeError',
    });
    bootstrapMock.mockRejectedValue(err);
    const e = await captureFlowCredentialViaFetchproxy({ flowLinkUrl: FLOW_LINK }).catch(
      (x: unknown) => x as Error
    );
    expect(e.message).toMatch(/Grant/);
    expect(e.message).toMatch(/expand its access/);
    // Grant must come before any mention of revoking. Matched on the stem so
    // "revoke"/"revoking" both count — the upstream half of this message says
    // "revoke", ours says "revoking", and either one landing first is the bug.
    const grantAt = e.message.indexOf('Grant');
    const revokeAt = e.message.search(/revok/i);
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeLessThan(revokeAt);
  });

  it('refuses when fetchproxy capture is disabled', async () => {
    process.env.HONEYBOOK_DISABLE_FETCHPROXY = '1';
    await expect(
      captureFlowCredentialViaFetchproxy({ flowLinkUrl: FLOW_LINK })
    ).rejects.toThrow(/HONEYBOOK_DISABLE_FETCHPROXY/);
  });

  it('refuses a client-portal link before opening the bridge', async () => {
    await expect(
      captureFlowCredentialViaFetchproxy({
        flowLinkUrl: 'https://zoomws.hbportal.co/app/link/resolve/1/2',
      })
    ).rejects.toThrow(/use_magic_link/);
    expect(bootstrapMock).not.toHaveBeenCalled();
  });
});
