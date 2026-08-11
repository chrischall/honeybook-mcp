import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// captureSessionViaFetchproxy() drives the single bootstrap path:
//   1. Spin up @fetchproxy/bootstrap with declared scope — JSON pointers into
//      localStorage["HONEYBOOK_REACT_CURR_USER"], plus a legacy jStorage
//      pointer for the trusted-device fallback. No header capture.
//   2. Read authentication_token / _id / trusted_device / company.company_name.
//   3. Synthesize a CapturedSession + persist to disk via sessionStore.
//
// HoneyBook migrated the client-portal auth state out of the AngularJS
// `jStorage` blob into the React-era `HONEYBOOK_REACT_CURR_USER` key. On a
// live signed-in portal, jStorage now holds only HB_TRUSTED_DEVICE,
// SESSION_COMPANY_ID, REDIRECT_URL and __jstorage_meta — the token, user id
// and company are gone, so the old pointers resolve to undefined and every
// capture failed. `hb-api-fingerprint` is also no longer required by the API,
// so the captureHeaders declaration (and its blocking one-shot listener) is
// gone with it.
//
// These tests verify scope shape, parse logic, error messages, and that the
// resulting session round-trips through the existing CapturedSession shape so
// the rest of the stack (HoneyBookClient.request) consumes it unchanged.

// Mock @fetchproxy/bootstrap at the module boundary — never hit a real WS.
const bootstrapMock = vi.fn();
vi.mock('@fetchproxy/bootstrap', () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...args),
}));

import { captureSessionViaFetchproxy } from '../src/auth.js';
import { sessionStore } from '../src/sessions.js';

describe('captureSessionViaFetchproxy', () => {
  let originalDisable: string | undefined;

  beforeEach(() => {
    originalDisable = process.env.HONEYBOOK_DISABLE_FETCHPROXY;
    delete process.env.HONEYBOOK_DISABLE_FETCHPROXY;
    bootstrapMock.mockReset();
    sessionStore.resetForTest();
  });

  afterEach(() => {
    if (originalDisable === undefined) delete process.env.HONEYBOOK_DISABLE_FETCHPROXY;
    else process.env.HONEYBOOK_DISABLE_FETCHPROXY = originalDisable;
  });

  // 0.4.0+: pointer-extracted values land in session.localStorage keyed
  // by their `outputKey`. No raw blob is ever copied.
  const validLocalStorage = {
    HB_AUTH_TOKEN: 'tok_abc',
    HB_AUTH_USER_ID: 'uid_42',
    HB_TRUSTED_DEVICE: 'td_99',
    HB_COMPANY_NAME: 'Silk Veil Events',
  };

  describe('happy path: pointer-extracted fields', () => {
    it('declares HONEYBOOK_REACT_CURR_USER pointers and no header capture', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: validLocalStorage,
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://silkveil.hbportal.co',
      });

      expect(bootstrapMock).toHaveBeenCalledTimes(1);
      const opts = bootstrapMock.mock.calls[0][0] as {
        serverName: string;
        version: string;
        domains: string[];
        storageDomain?: string;
        declare: {
          cookies: string[];
          localStorage: string[];
          localStoragePointers: { outputKey: string; storageKey: string; jsonPointer: string }[];
          sessionStorage: string[];
          captureHeaders: { host: string; path?: string; headerName: string }[];
        };
      };
      expect(opts.serverName).toBe('honeybook-mcp');
      expect(typeof opts.version).toBe('string');
      // Multi-domain: HoneyBook serves both the main app (honeybook.com)
      // and per-vendor portal subdomains (*.hbportal.co).
      expect(opts.domains).toEqual(['honeybook.com', 'hbportal.co']);
      // 0.4.1+: multi-domain MCPs must pin which declared domain the
      // localStorage reads target. The portal's auth state lives on the
      // vendor tab, so hbportal.co is the right choice.
      expect(opts.storageDomain).toBe('hbportal.co');
      expect(opts.declare.cookies).toEqual([]);
      // No more full-blob jStorage read — only declared pointer paths.
      expect(opts.declare.localStorage).toEqual([]);
      expect(opts.declare.localStoragePointers).toEqual([
        {
          outputKey: 'HB_AUTH_TOKEN',
          storageKey: 'HONEYBOOK_REACT_CURR_USER',
          jsonPointer: '/authentication_token',
        },
        { outputKey: 'HB_AUTH_USER_ID', storageKey: 'HONEYBOOK_REACT_CURR_USER', jsonPointer: '/_id' },
        {
          outputKey: 'HB_TRUSTED_DEVICE',
          storageKey: 'HONEYBOOK_REACT_CURR_USER',
          jsonPointer: '/trusted_device',
        },
        {
          outputKey: 'HB_COMPANY_NAME',
          storageKey: 'HONEYBOOK_REACT_CURR_USER',
          jsonPointer: '/company/company_name',
        },
        // Legacy fallback: jStorage still carries HB_TRUSTED_DEVICE, and it is
        // the only field of the old blob that survived the React migration.
        {
          outputKey: 'HB_TRUSTED_DEVICE_LEGACY',
          storageKey: 'jStorage',
          jsonPointer: '/HB_TRUSTED_DEVICE',
        },
      ]);
      expect(opts.declare.sessionStorage).toEqual([]);
      // The API no longer requires hb-api-fingerprint, so nothing blocks on a
      // live outgoing request any more.
      expect(opts.declare.captureHeaders).toEqual([]);

      expect(session.portalOrigin).toBe('https://silkveil.hbportal.co');
      expect(session.companyName).toBe('Silk Veil Events');
      expect(session.authToken).toBe('tok_abc');
      expect(session.userId).toBe('uid_42');
      expect(session.trustedDevice).toBe('td_99');
      expect(session.fingerprint).toBeUndefined();
      expect(typeof session.capturedAt).toBe('number');
    });

    it('persists the captured session via sessionStore', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: validLocalStorage,
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      await captureSessionViaFetchproxy({ portalOrigin: 'https://silkveil.hbportal.co' });

      const stored = sessionStore.get('https://silkveil.hbportal.co');
      expect(stored).not.toBeNull();
      expect(stored?.authToken).toBe('tok_abc');
    });

    it('normalizes the portalOrigin (strips path/query/trailing slash)', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: validLocalStorage,
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://silkveil.hbportal.co/app/workspace_file/abc?token=xyz',
      });
      expect(session.portalOrigin).toBe('https://silkveil.hbportal.co');
    });

    it('falls back to the portal subdomain when HB_COMPANY_NAME is empty', async () => {
      // `company` is null on a client-side portal user (the vendor's company
      // is not on the client's own record), so this pointer resolves to
      // undefined and the extension omits the key entirely.
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: {
          HB_AUTH_TOKEN: 'tok',
          HB_AUTH_USER_ID: 'uid',
          HB_TRUSTED_DEVICE: 'td',
          // HB_COMPANY_NAME deliberately absent
        },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://acme-events.hbportal.co',
      });
      expect(session.companyName).toBe('acme-events');
    });

    it('falls back to the legacy jStorage trusted device when the React field is absent', async () => {
      // jStorage.HB_TRUSTED_DEVICE is the one field of the old blob that
      // survived the migration, so it is a real fallback rather than a
      // theoretical one. Note the two values genuinely differ on a live
      // portal — either is accepted by the API.
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: {
          HB_AUTH_TOKEN: 'tok',
          HB_AUTH_USER_ID: 'uid',
          HB_TRUSTED_DEVICE_LEGACY: 'td_legacy',
        },
        sessionStorage: {},
        capturedHeaders: {},
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://x.hbportal.co',
      });
      expect(session.trustedDevice).toBe('td_legacy');
    });

    it('prefers the React trusted device over the legacy jStorage one', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: {
          HB_AUTH_TOKEN: 'tok',
          HB_AUTH_USER_ID: 'uid',
          HB_TRUSTED_DEVICE: 'td_react',
          HB_TRUSTED_DEVICE_LEGACY: 'td_legacy',
        },
        sessionStorage: {},
        capturedHeaders: {},
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://x.hbportal.co',
      });
      expect(session.trustedDevice).toBe('td_react');
    });

    it('captures successfully with no trusted device at all', async () => {
      // The API returns 200 without hb-trusted-device, so a missing value must
      // not be fatal — treating it as required is exactly what turned a
      // cosmetic upstream change into a hard capture failure.
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { HB_AUTH_TOKEN: 'tok', HB_AUTH_USER_ID: 'uid' },
        sessionStorage: {},
        capturedHeaders: {},
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://x.hbportal.co',
      });
      expect(session.trustedDevice).toBeUndefined();
      expect(session.authToken).toBe('tok');
    });
  });

  describe('error shapes', () => {
    it('throws when the auth token is missing from the pointer extractions', async () => {
      // The storage key may be present but missing the field; the extension
      // resolves the pointer to undefined, so the outputKey is absent
      // from the returned map. The message must name the real path so a
      // future upstream rename is diagnosable from the error alone.
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: {
          HB_AUTH_USER_ID: 'uid',
          HB_TRUSTED_DEVICE: 'td',
          HB_COMPANY_NAME: 'co',
        },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/HONEYBOOK_REACT_CURR_USER\.\/authentication_token/);
    });

    it('throws when the user id is missing', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: {
          HB_AUTH_TOKEN: 'tok',
          HB_TRUSTED_DEVICE: 'td',
          HB_COMPANY_NAME: 'co',
        },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/HONEYBOOK_REACT_CURR_USER\.\/_id/);
    });

    it('wraps bootstrap() errors with actionable context', async () => {
      bootstrapMock.mockRejectedValue(new Error('extension offline'));

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/fetchproxy.*extension offline/);
    });

    it('points at the portal tab when the bootstrap times out', async () => {
      // With captureHeaders gone, a timeout is no longer "the page went idle" —
      // it means the extension never produced the declared storage reads, which
      // is a missing / signed-out portal tab. classifyBridgeError keys off the
      // error *class*, so FetchproxyProtocolError('timeout') surfaces as type
      // 'protocol'; detection must key off the message too.
      const { FetchproxyProtocolError } = await import('@chrischall/mcp-utils/fetchproxy');
      bootstrapMock.mockRejectedValue(new FetchproxyProtocolError('timeout'));

      const err = (await captureSessionViaFetchproxy({
        portalOrigin: 'https://x.hbportal.co',
      }).catch((e) => e)) as Error;

      expect(err.message).toMatch(/HoneyBook auth/);
      expect(err.message).toMatch(/timed out/i);
      expect(err.message).toMatch(/signed in|portal tab/i);
      // The old copy told users to refresh so a fresh API request would fire —
      // meaningless now that nothing sniffs a live request.
      expect(err.message).not.toMatch(/hb-api-fingerprint/);
    });

    it('surfaces the re-pair remedy verbatim on a scope error', async () => {
      // Every user paired before the HONEYBOOK_REACT_CURR_USER migration hits
      // this on upgrade: the extension gates on the scope approved at pair
      // time, so the widened declaration is refused until they re-approve.
      // The library types this error with a `.hint` precisely because MCPs
      // re-wrap it and bury the remedy — our generic "open the magic-link URL"
      // suffix is actively wrong here, since the link is already open and the
      // real fix is to revoke the MCP in the extension popup.
      const { FetchproxyScopeError } = await import('@fetchproxy/server');
      const scopeErr = new FetchproxyScopeError(
        'localStorage keys not in declared set: HONEYBOOK_REACT_CURR_USER'
      );
      bootstrapMock.mockRejectedValue(scopeErr);

      const err = (await captureSessionViaFetchproxy({
        portalOrigin: 'https://x.hbportal.co',
      }).catch((e) => e)) as Error;

      expect(err.message).toMatch(/HoneyBook auth/);
      // Library owns the remedy copy — confirm it survives, don't lock the text.
      expect(err.message).toContain(scopeErr.hint);
      expect(err.message).toMatch(/HONEYBOOK_REACT_CURR_USER/);
      expect(err.message).not.toMatch(/open the vendor magic-link URL/);
    });

    it('handles non-Error rejections from bootstrap()', async () => {
      bootstrapMock.mockRejectedValue('plain string failure');

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/plain string failure/);
    });

    it('surfaces FetchproxyBridgeDownError.hint verbatim when bootstrap retry exhausts', async () => {
      const { FetchproxyBridgeDownError } = await import('@chrischall/mcp-utils/fetchproxy');
      const downErr = new FetchproxyBridgeDownError({
        originalError: 'ws closed before pong',
        retryAttempted: true,
        op: 'fetch',
      });
      bootstrapMock.mockRejectedValue(downErr);

      const err = await captureSessionViaFetchproxy({
        portalOrigin: 'https://x.hbportal.co',
      }).catch((e) => e);
      // We own this prefix:
      expect((err as Error).message).toMatch(
        /HoneyBook auth: fetchproxy bridge is down/
      );
      // Library owns its hint copy — just confirm it's present, don't lock on exact text:
      expect((err as Error).message).toContain(downErr.hint);
    });
  });

  describe('disabled fetchproxy', () => {
    it('refuses to run when HONEYBOOK_DISABLE_FETCHPROXY=1', async () => {
      process.env.HONEYBOOK_DISABLE_FETCHPROXY = '1';

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/HONEYBOOK_DISABLE_FETCHPROXY/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it.each(['1', 'true', 'yes', 'on', 'TRUE'])(
      'treats HONEYBOOK_DISABLE_FETCHPROXY=%j as disabled',
      async (val) => {
        process.env.HONEYBOOK_DISABLE_FETCHPROXY = val;
        await expect(
          captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
        ).rejects.toThrow(/HONEYBOOK_DISABLE_FETCHPROXY/);
        expect(bootstrapMock).not.toHaveBeenCalled();
      }
    );

    it.each(['0', 'false', 'no', '', 'off'])(
      'treats HONEYBOOK_DISABLE_FETCHPROXY=%j as enabled (default)',
      async (val) => {
        process.env.HONEYBOOK_DISABLE_FETCHPROXY = val;
        bootstrapMock.mockResolvedValue({
          cookies: {},
          localStorage: validLocalStorage,
          sessionStorage: {},
          capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
        });
        await captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' });
        expect(bootstrapMock).toHaveBeenCalled();
      }
    );

    it.each(['undefined', 'null', '${HONEYBOOK_DISABLE_FETCHPROXY}'])(
      'treats HONEYBOOK_DISABLE_FETCHPROXY=%j (unexpanded placeholder) as unset',
      async (val) => {
        process.env.HONEYBOOK_DISABLE_FETCHPROXY = val;
        bootstrapMock.mockResolvedValue({
          cookies: {},
          localStorage: validLocalStorage,
          sessionStorage: {},
          capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
        });
        await captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' });
        expect(bootstrapMock).toHaveBeenCalled();
      }
    );
  });
});
