// ────────────────────────────────────────────────────────────────────────────
// Session capture — Pattern A template (read_local_storage + capture_header)
// ────────────────────────────────────────────────────────────────────────────
//
// Mirrors the canonical "browser-bootstrap + Node-direct" shape from
// ofw-mcp/src/auth.ts and creditkarma-mcp/src/auth.ts. HoneyBook is a
// little different from the other family members: there is no env-var
// auth path (HoneyBook has no public client-portal API and no
// long-lived credential format we can drop in process.env), so this
// module exposes a single capture function rather than a multi-path
// resolveAuth().
//
// THE PATHS, in priority order at call sites:
//
//   1. Cached session in ~/.honeybook-mcp/sessions.json (existing).
//      Handled in `client.ts#getActiveClient()` — no fetchproxy round-trip
//      needed when a session for the requested portalOrigin is already
//      on disk. Sessions persist across MCP restarts.
//
//   2. fetchproxy bootstrap (this module).
//      The user has signed into their vendor portal via a magic link in
//      their real Chrome (the fetchproxy 0.3.0 extension is installed).
//      We call `@fetchproxy/bootstrap` once to:
//        • snapshot localStorage["jStorage"] — the HoneyBook web app
//          stores the bearer token + user id + trusted device id + the
//          HB_CURR_USER blob here, all under one key
//        • capture the `hb-api-fingerprint` request header on the first
//          api.honeybook.com/api/v2/* call the page makes — this is a
//          per-device FingerprintJS signal that the API requires on
//          every request (it's NOT in jStorage)
//      Then we close the bridge and operate from Node thereafter.
//
//   3. Error
//      Nothing to authenticate with. We throw a message that names the
//      one onboarding step: open the magic link in Chrome (with the
//      extension installed) and retry the tool call.
//
// Why fetchproxy is only a one-shot read:
//   The bootstrap call snapshots both buckets (localStorage +
//   captured header) and returns. The MCP then operates from Node with
//   direct fetch — latency and reliability are not coupled to the
//   browser bridge for normal tool calls. When the bearer token
//   eventually expires, the existing 401 handler in `HoneyBookClient`
//   surfaces a helpful "re-bootstrap" error and the user re-runs the
//   capture (typically via the `use_magic_link` tool, which now wraps
//   this function instead of running Puppeteer).
//
// Multi-domain scope:
//   HoneyBook serves both the main app (honeybook.com) and per-vendor
//   client-portal subdomains (*.hbportal.co). The extension matches on
//   suffix, so listing both apexes covers every vendor portal a user
//   could be signed into.
//
// Testability:
//   - `@fetchproxy/bootstrap` is mocked at the module boundary in tests.
//   - Persistence (sessionStore.add) is the existing side effect; tests
//     verify the captured session round-trips through sessionStore.get.

import { bootstrap } from '@fetchproxy/bootstrap';
import { bridgeErrorInfo } from '@chrischall/mcp-utils/fetchproxy';
import { readEnvVar } from '@chrischall/mcp-utils';
import pkg from '../package.json' with { type: 'json' };
import { sessionStore, normalizeOrigin } from './sessions.js';
import type { CapturedSession } from './types.js';

/** True if the user has explicitly disabled the fetchproxy capture path. */
function fetchproxyDisabled(): boolean {
  const raw = readEnvVar('HONEYBOOK_DISABLE_FETCHPROXY');
  if (raw === undefined) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export interface CaptureOpts {
  /**
   * Vendor portal origin (e.g. `https://acme.hbportal.co`). Used as the
   * cache key in `sessionStore` so we can hold simultaneous sessions for
   * multiple vendors without collision. May be passed as a full URL —
   * we normalize to origin only.
   */
  portalOrigin: string;
}

/**
 * Capture a HoneyBook portal session by reading the user's signed-in
 * browser tab via `@fetchproxy/bootstrap`. Persists the result through
 * `sessionStore` and returns it.
 *
 * Preconditions: the user has the fetchproxy 0.3.0 Chrome / Safari
 * extension installed and is signed into the vendor's HoneyBook portal
 * (typically by clicking the magic link in their vendor email). If
 * either is missing, this throws with an actionable error message.
 *
 * Postconditions: the session is in `sessionStore` keyed by the
 * normalized portalOrigin and is the new most-recent session, so any
 * subsequent tool call without an explicit `origin` will use it.
 */
export async function captureSessionViaFetchproxy(opts: CaptureOpts): Promise<CapturedSession> {
  if (fetchproxyDisabled()) {
    throw new Error(
      'HoneyBook auth: fetchproxy capture is disabled by HONEYBOOK_DISABLE_FETCHPROXY. ' +
        'Unset that env var to enable session capture via the browser extension.'
    );
  }

  const normalized = normalizeOrigin(opts.portalOrigin);

  let session;
  try {
    session = await bootstrap({
      serverName: pkg.name,
      version: pkg.version,
      // HoneyBook serves both the main app (honeybook.com) and per-vendor
      // portal subdomains (*.hbportal.co). The extension matches on suffix,
      // so listing both apexes covers any vendor.
      //
      // Both are needed:
      //   - `hbportal.co` is where the vendor magic-link tab lives, so
      //     `jStorage` reads target it (via `storageDomain` below).
      //   - `honeybook.com` is required for the `hb-api-fingerprint`
      //     capture, because that header rides outgoing requests to
      //     `api.honeybook.com/api/v2/*` and the extension gates
      //     every captureHeader `host` against declared domains.
      //
      // 0.4.1+ requires multi-domain MCPs to pick a `storageDomain` so
      // the cookie / localStorage / sessionStorage / indexedDb reads
      // know which tab to target. captureRequestHeader is independently
      // routed by its declared { host, path? }.
      domains: ['honeybook.com', 'hbportal.co'],
      storageDomain: 'hbportal.co',
      declare: {
        cookies: [],
        // We don't need the full `jStorage` blob (it's ~8KB of mostly
        // unused state). 0.4.0's JSON-pointer extraction lets us
        // declare exactly the four fields the MCP uses; bootstrap
        // reads `jStorage` once and applies all pointers in one call.
        // The extension popup also shows the pointer paths verbatim
        // so the user can see precisely what's being read.
        localStorage: [],
        localStoragePointers: [
          { outputKey: 'HB_AUTH_TOKEN', storageKey: 'jStorage', jsonPointer: '/HB_AUTH_TOKEN' },
          { outputKey: 'HB_AUTH_USER_ID', storageKey: 'jStorage', jsonPointer: '/HB_AUTH_USER_ID' },
          { outputKey: 'HB_TRUSTED_DEVICE', storageKey: 'jStorage', jsonPointer: '/HB_TRUSTED_DEVICE' },
          { outputKey: 'HB_COMPANY_NAME', storageKey: 'jStorage', jsonPointer: '/HB_CURR_USER/company/company_name' },
        ],
        sessionStorage: [],
        captureHeaders: [
          // The page's first call to api.honeybook.com/api/v2/* carries the
          // `hb-api-fingerprint` header — a per-device FingerprintJS
          // signal that the API requires on every subsequent request.
          // It's NOT stored in jStorage; the only place to get it is off
          // a real outgoing request.
          { host: 'api.honeybook.com', path: '/api/v2/*', headerName: 'hb-api-fingerprint' },
        ],
      },
      // 0.4.0: surface the pair code (six digits) on stderr so the user
      // can verify it against the extension popup. fetchproxy 0.4.0
      // binds both MCP and extension identities into the pair code, so
      // the user comparing both codes detects MITM-as-extension.
      onPairCode: (code) => {
        process.stderr.write(`[honeybook-mcp] fetchproxy pair code: ${code}\n`);
      },
      // 0.4.0: capture_request_header blocks on a real outgoing request
      // to api.honeybook.com/api/v2/*. Surface a hint so the user knows
      // to interact with the portal if the bootstrap appears to stall.
      onWaiting: (hint) => {
        process.stderr.write(`[honeybook-mcp] ${hint}\n`);
      },
    });
  } catch (e) {
    // SW eviction retry exhausted — surface library's typed `.hint` instead of the generic "open magic link" message.
    const bridgeError = bridgeErrorInfo(e);
    if (bridgeError.type === 'bridge_down') {
      throw new Error(
        `HoneyBook auth: fetchproxy bridge is down (extension service worker unreachable after retry). ${bridgeError.hint ?? ''}`.trimEnd()
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `HoneyBook auth: fetchproxy capture failed: ${msg} — ` +
        'open the vendor magic-link URL in Chrome (with the fetchproxy 0.3.0 extension installed), ' +
        'then retry.'
    );
  }

  // 0.4.0: pointer extractions land in `session.localStorage` keyed by
  // their declared `outputKey`. The raw `jStorage` JSON is never copied
  // into this process — only the four specific fields we actually need.
  const authToken = session.localStorage['HB_AUTH_TOKEN'];
  const userId = session.localStorage['HB_AUTH_USER_ID'];
  const trustedDevice = session.localStorage['HB_TRUSTED_DEVICE'];
  const companyNameFromHb = session.localStorage['HB_COMPANY_NAME'];

  if (!authToken) {
    throw new Error(
      'HoneyBook auth: HB_AUTH_TOKEN not found at jStorage./HB_AUTH_TOKEN. ' +
        'Sign into the vendor portal via the magic-link URL and retry.'
    );
  }
  if (!userId) {
    throw new Error('HoneyBook auth: HB_AUTH_USER_ID not found at jStorage./HB_AUTH_USER_ID.');
  }
  if (!trustedDevice) {
    throw new Error('HoneyBook auth: HB_TRUSTED_DEVICE not found at jStorage./HB_TRUSTED_DEVICE.');
  }

  const fingerprint = session.capturedHeaders['hb-api-fingerprint'];
  if (!fingerprint) {
    throw new Error(
      'HoneyBook auth: hb-api-fingerprint header not captured. ' +
        'Interact with the vendor portal (refresh the page, open a workspace) so the browser makes an ' +
        'api.honeybook.com/api/v2/* request, then retry.'
    );
  }

  // HB_CURR_USER may not be populated immediately on a fresh tab; fall
  // back to the portal subdomain so the user has a readable label.
  let companyName = companyNameFromHb || '';
  if (!companyName) {
    try {
      companyName = new URL(normalized).hostname.split('.')[0] ?? '';
    } catch {
      companyName = '';
    }
  }

  const captured: CapturedSession = {
    portalOrigin: normalized,
    companyName,
    authToken,
    userId,
    trustedDevice,
    fingerprint,
    capturedAt: Date.now(),
  };

  sessionStore.add(captured);
  return captured;
}
