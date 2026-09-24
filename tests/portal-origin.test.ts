import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// fleet-audit#139: a session was labelled with whatever origin the caller
// passed, but captured from whichever hbportal.co tab happened to be open —
// and any host was accepted, so `use_magic_link('https://evil.example/x')`
// stored a real token under evil.example and pay_invoice / sign_contract then
// handed the user an "open this link" URL on that host.

const bootstrapMock = vi.fn();
vi.mock('@fetchproxy/bootstrap', () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...args),
}));

const { captureSessionViaFetchproxy } = await import('../src/auth.js');
const { captureFlowCredentialViaFetchproxy } = await import('../src/flow-auth.js');
const { vendorPortalSubdomain, sessionStore } = await import('../src/sessions.js');
const { flowStore } = await import('../src/flows.js');
const { useMagicLink } = await import('../src/tools/sessions.js');
const clientModule = await import('../src/client.js');
const { registerInvoiceTools } = await import('../src/tools/invoices.js');
const { registerContractTools } = await import('../src/tools/contracts.js');
const { createTestHarness } = await import('@chrischall/mcp-utils/test');
const { callConfirmed, restoreConfirmEnv, textOf } = await import('./confirm-helpers.js');

const BAD_ORIGINS = [
  'https://evil.example/x',
  'https://hbportal.co.evil.example',
  'https://evilhbportal.co',
  'https://hbportal.co',
  'https://a.b.hbportal.co',
  'http://acme.hbportal.co',
  'https://acme.hbportal.co:8443',
];

describe('vendorPortalSubdomain', () => {
  it('returns the vendor label of an https://<vendor>.hbportal.co origin', () => {
    expect(vendorPortalSubdomain('https://acme-events.hbportal.co')).toBe('acme-events');
    expect(vendorPortalSubdomain('https://Acme.HBPortal.co/app/link/resolve/1')).toBe('acme');
  });

  it.each(BAD_ORIGINS)('refuses %s', (bad) => {
    expect(() => vendorPortalSubdomain(bad)).toThrow(/not a HoneyBook vendor portal/i);
  });
});

describe('capture is bound to the named vendor portal', () => {
  beforeEach(() => {
    delete process.env.HONEYBOOK_DISABLE_FETCHPROXY;
    bootstrapMock.mockReset();
    sessionStore.resetForTest();
    flowStore.resetForTest();
  });
  afterEach(() => vi.restoreAllMocks());

  it('use_magic_link refuses a non-HoneyBook host without opening the bridge', async () => {
    await expect(useMagicLink({ magic_link_url: 'https://evil.example/x' })).rejects.toThrow(
      /not a HoneyBook vendor portal/i
    );
    expect(bootstrapMock).not.toHaveBeenCalled();
    expect(sessionStore.list()).toEqual([]);
  });

  it('portal capture reads storage from the exact vendor tab (storageSubdomain)', async () => {
    bootstrapMock.mockResolvedValue({
      cookies: {},
      localStorage: { HB_AUTH_TOKEN: 't', HB_AUTH_USER_ID: 'u' },
      sessionStorage: {},
      capturedHeaders: {},
    });
    await captureSessionViaFetchproxy({ portalOrigin: 'https://silkveil.hbportal.co/app/x' });
    expect(bootstrapMock.mock.calls[0][0]).toMatchObject({
      storageDomain: 'hbportal.co',
      storageSubdomain: 'silkveil',
    });
  });

  it('flow capture refuses a non-HoneyBook host without opening the bridge', async () => {
    await expect(
      captureFlowCredentialViaFetchproxy({ flowLinkUrl: 'https://evil.example/flow/69e64b0ff2eb57003a725a2d?hash=h' })
    ).rejects.toThrow(/not a HoneyBook vendor portal/i);
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it('flow capture reads storage from the exact vendor tab (storageSubdomain)', async () => {
    bootstrapMock.mockResolvedValue({
      cookies: {},
      localStorage: { HB_FLOW_HASH: 'h', HB_FLOW_USER_ID: 'u' },
      sessionStorage: {},
      capturedHeaders: {},
      indexedDb: {},
    });
    await captureFlowCredentialViaFetchproxy({
      flowLinkUrl: 'https://zoomws.hbportal.co/flow/69e64b0ff2eb57003a725a2d?hash=h',
    }).catch(() => undefined);
    expect(bootstrapMock.mock.calls[0][0]).toMatchObject({
      storageDomain: 'hbportal.co',
      storageSubdomain: 'zoomws',
    });
  });
});

describe('deep links refuse a stored session on a foreign host', () => {
  // A sessions.json written before this fix can still hold such an origin.
  beforeEach(() => {
    vi.spyOn(clientModule, 'getActiveClient').mockResolvedValue({
      request: vi.fn().mockResolvedValue({ _id: 'f1', file_title: 'F', file_type: 'invoice' }),
      scope: { portalOrigin: 'https://evil.example', companyName: 'evil', userId: 'u' },
    } as unknown as clientModule.HoneyBookClient);
  });
  afterEach(() => vi.restoreAllMocks());

  restoreConfirmEnv();

  it('pay_invoice', async () => {
    const harness = await createTestHarness((server) => registerInvoiceTools(server));
    try {
      const { result } = await callConfirmed(harness, 'pay_invoice', { file_id: 'f1' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/not a HoneyBook vendor portal/i);
    } finally {
      await harness.close();
    }
  });

  it('sign_contract', async () => {
    (await clientModule.getActiveClient()).request = vi
      .fn()
      .mockResolvedValue({ _id: 'f1', file_title: 'F', file_type: 'agreement' });
    const harness = await createTestHarness((server) => registerContractTools(server));
    try {
      const { result } = await callConfirmed(harness, 'sign_contract', { file_id: 'f1' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/not a HoneyBook vendor portal/i);
    } finally {
      await harness.close();
    }
  });
});
