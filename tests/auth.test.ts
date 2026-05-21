import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// captureSessionViaFetchproxy() drives the single bootstrap path:
//   1. Spin up @fetchproxy/bootstrap with declared scope (localStorage["jStorage"]
//      and a header capture for `hb-api-fingerprint` on the first
//      api.honeybook.com/api/v2/* request).
//   2. Parse jStorage for HB_AUTH_TOKEN / HB_AUTH_USER_ID / HB_TRUSTED_DEVICE /
//      HB_CURR_USER.company.company_name.
//   3. Read the captured `hb-api-fingerprint` header.
//   4. Synthesize a CapturedSession + persist to disk via sessionStore.
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

  const validJStorage = JSON.stringify({
    HB_AUTH_TOKEN: 'tok_abc',
    HB_AUTH_USER_ID: 'uid_42',
    HB_TRUSTED_DEVICE: 'td_99',
    HB_CURR_USER: { company: { company_name: 'Silk Veil Events' } },
  });

  describe('happy path: jStorage + fingerprint captured', () => {
    it('reads jStorage from localStorage and the hb-api-fingerprint header', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { jStorage: validJStorage },
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
        declare: {
          cookies: string[];
          localStorage: string[];
          sessionStorage: string[];
          captureHeaders: { urlPattern: string; headerName: string }[];
        };
      };
      expect(opts.serverName).toBe('honeybook-mcp');
      expect(typeof opts.version).toBe('string');
      // Multi-domain: HoneyBook serves both the main app (honeybook.com)
      // and per-vendor portal subdomains (*.hbportal.co).
      expect(opts.domains).toEqual(['honeybook.com', 'hbportal.co']);
      expect(opts.declare.cookies).toEqual([]);
      expect(opts.declare.localStorage).toEqual(['jStorage']);
      expect(opts.declare.sessionStorage).toEqual([]);
      expect(opts.declare.captureHeaders).toEqual([
        { urlPattern: 'https://api.honeybook.com/api/v2/*', headerName: 'hb-api-fingerprint' },
      ]);

      expect(session.portalOrigin).toBe('https://silkveil.hbportal.co');
      expect(session.companyName).toBe('Silk Veil Events');
      expect(session.authToken).toBe('tok_abc');
      expect(session.userId).toBe('uid_42');
      expect(session.trustedDevice).toBe('td_99');
      expect(session.fingerprint).toBe('fp_xyz');
      expect(typeof session.capturedAt).toBe('number');
    });

    it('persists the captured session via sessionStore', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { jStorage: validJStorage },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      await captureSessionViaFetchproxy({ portalOrigin: 'https://silkveil.hbportal.co' });

      const stored = sessionStore.get('https://silkveil.hbportal.co');
      expect(stored).not.toBeNull();
      expect(stored?.authToken).toBe('tok_abc');
      expect(stored?.fingerprint).toBe('fp_xyz');
    });

    it('normalizes the portalOrigin (strips path/query/trailing slash)', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { jStorage: validJStorage },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://silkveil.hbportal.co/app/workspace_file/abc?token=xyz',
      });
      expect(session.portalOrigin).toBe('https://silkveil.hbportal.co');
    });

    it('falls back to the portal subdomain when HB_CURR_USER.company.company_name is missing', async () => {
      // Common in headless / fresh-tab cases where HB_CURR_USER hasn't populated yet.
      const jStorageNoCompany = JSON.stringify({
        HB_AUTH_TOKEN: 'tok',
        HB_AUTH_USER_ID: 'uid',
        HB_TRUSTED_DEVICE: 'td',
      });
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { jStorage: jStorageNoCompany },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      const session = await captureSessionViaFetchproxy({
        portalOrigin: 'https://acme-events.hbportal.co',
      });
      expect(session.companyName).toBe('acme-events');
    });
  });

  describe('error shapes', () => {
    it('throws when jStorage is missing from localStorage', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: {},
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/jStorage/);
    });

    it('throws when jStorage is unparseable JSON', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { jStorage: 'not-json{{' },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/jStorage/);
    });

    it('throws when HB_AUTH_TOKEN is missing from jStorage', async () => {
      const jStorageNoToken = JSON.stringify({
        HB_AUTH_USER_ID: 'uid',
        HB_TRUSTED_DEVICE: 'td',
      });
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { jStorage: jStorageNoToken },
        sessionStorage: {},
        capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
      });

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/HB_AUTH_TOKEN/);
    });

    it('throws when hb-api-fingerprint header was not captured', async () => {
      bootstrapMock.mockResolvedValue({
        cookies: {},
        localStorage: { jStorage: validJStorage },
        sessionStorage: {},
        capturedHeaders: {},
      });

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/hb-api-fingerprint/);
    });

    it('wraps bootstrap() errors with actionable context', async () => {
      bootstrapMock.mockRejectedValue(new Error('extension offline'));

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/fetchproxy.*extension offline/);
    });

    it('handles non-Error rejections from bootstrap()', async () => {
      bootstrapMock.mockRejectedValue('plain string failure');

      await expect(
        captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' })
      ).rejects.toThrow(/plain string failure/);
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
          localStorage: { jStorage: validJStorage },
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
          localStorage: { jStorage: validJStorage },
          sessionStorage: {},
          capturedHeaders: { 'hb-api-fingerprint': 'fp_xyz' },
        });
        await captureSessionViaFetchproxy({ portalOrigin: 'https://x.hbportal.co' });
        expect(bootstrapMock).toHaveBeenCalled();
      }
    );
  });
});
