// ────────────────────────────────────────────────────────────────────────────
// Session capture — Pattern A template (read_local_storage)
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
//      We call `@fetchproxy/bootstrap` once to read the auth fields out
//      of localStorage["HONEYBOOK_REACT_CURR_USER"], then close the
//      bridge and operate from Node thereafter.
//
//      HoneyBook used to keep this state in the AngularJS `jStorage`
//      blob (HB_AUTH_TOKEN / HB_AUTH_USER_ID / HB_TRUSTED_DEVICE /
//      HB_CURR_USER). It has since moved to the React-era
//      `HONEYBOOK_REACT_CURR_USER` key; on a live signed-in portal
//      jStorage is down to HB_TRUSTED_DEVICE, SESSION_COMPANY_ID,
//      REDIRECT_URL and __jstorage_meta. We read the React key and keep
//      the surviving jStorage trusted-device as a fallback.
//
//      We no longer capture the `hb-api-fingerprint` request header.
//      The API accepts requests without it (verified against
//      /api/v2/users/{uid}/workspace_files), and capturing it was the
//      only part of bootstrap that had to block on a live outgoing
//      request — the "portal tab already went idle" timeout.
//
//   3. Error
//      Nothing to authenticate with. We throw a message that names the
//      one onboarding step: open the magic link in Chrome (with the
//      extension installed) and retry the tool call.
//
// Why fetchproxy is only a one-shot read:
//   The bootstrap call snapshots the declared storage fields and
//   returns. The MCP then operates from Node with direct fetch — latency
//   and reliability are not coupled to the browser bridge for normal
//   tool calls. When the bearer token eventually expires, the
//   expired-session handler in `HoneyBookClient` surfaces a helpful
//   "re-bootstrap" error and the user re-runs the capture (typically via
//   the `use_magic_link` tool, which now wraps this function instead of
//   running Puppeteer).
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
import { parseBoolEnv } from '@chrischall/mcp-utils';
import pkg from '../package.json' with { type: 'json' };
import { sessionStore, normalizeOrigin } from './sessions.js';
import type { CapturedSession } from './types.js';

/** True if the user has explicitly disabled the fetchproxy capture path. */
function fetchproxyDisabled(): boolean {
  return parseBoolEnv('HONEYBOOK_DISABLE_FETCHPROXY');
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
      // `hbportal.co` is where the vendor magic-link tab lives, so the
      // storage reads target it (via `storageDomain` below).
      // `honeybook.com` stays declared because the same session is valid
      // on the main app and callers may hold either origin.
      //
      // 0.4.1+ requires multi-domain MCPs to pick a `storageDomain` so
      // the cookie / localStorage / sessionStorage / indexedDb reads
      // know which tab to target.
      domains: ['honeybook.com', 'hbportal.co'],
      storageDomain: 'hbportal.co',
      declare: {
        cookies: [],
        // `HONEYBOOK_REACT_CURR_USER` is ~6.5KB of mostly unused user
        // state. 0.4.0's JSON-pointer extraction lets us declare exactly
        // the fields the MCP uses; bootstrap reads each storage key once
        // and applies all pointers in one call. The extension popup shows
        // the pointer paths verbatim so the user can see precisely what's
        // being read.
        localStorage: [],
        localStoragePointers: [
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
          // The one field of the old jStorage blob that survived the
          // migration. Kept as a fallback so a further reshuffle of the
          // React key doesn't cost us the trusted-device value too.
          {
            outputKey: 'HB_TRUSTED_DEVICE_LEGACY',
            storageKey: 'jStorage',
            jsonPointer: '/HB_TRUSTED_DEVICE',
          },
        ],
        sessionStorage: [],
        // Nothing to sniff off a live request any more — see the header note above.
        captureHeaders: [],
      },
      // 0.4.0: surface the pair code (six digits) on stderr so the user
      // can verify it against the extension popup. fetchproxy 0.4.0
      // binds both MCP and extension identities into the pair code, so
      // the user comparing both codes detects MITM-as-extension.
      onPairCode: (code) => {
        process.stderr.write(`[honeybook-mcp] fetchproxy pair code: ${code}\n`);
      },
      // Surface the library's own progress hint so a stalled bootstrap
      // tells the user what it is waiting on.
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
    // Now that nothing blocks on a live outgoing request, a timeout means the
    // extension never produced the declared storage reads — i.e. there is no
    // signed-in portal tab for it to read from. classifyBridgeError keys off
    // the error class, so this surfaces as a FetchproxyProtocolError
    // ('protocol'), not 'timeout' — match on the message too.
    if (bridgeError.type === 'timeout' || /timeout/i.test(msg)) {
      throw new Error(
        'HoneyBook auth: fetchproxy capture timed out. The extension never returned the vendor ' +
          "portal's stored session, which usually means no tab is open and signed in on that portal. " +
          'Open the vendor magic-link URL in Chrome (with the fetchproxy extension installed), confirm ' +
          'the portal page has loaded, then re-run use_magic_link.'
      );
    }
    throw new Error(
      `HoneyBook auth: fetchproxy capture failed: ${msg} — ` +
        'open the vendor magic-link URL in Chrome (with the fetchproxy 0.3.0 extension installed), ' +
        'then retry.'
    );
  }

  // 0.4.0: pointer extractions land in `session.localStorage` keyed by
  // their declared `outputKey`. No raw blob is ever copied into this
  // process — only the specific fields we actually need.
  const authToken = session.localStorage['HB_AUTH_TOKEN'];
  const userId = session.localStorage['HB_AUTH_USER_ID'];
  // Only these two are load-bearing. `hb-trusted-device` is sent when we have
  // it but the API returns 200 without it, so a missing value must not fail
  // the capture — requiring fields the API doesn't is what turned an upstream
  // storage rename into a total outage.
  const trustedDevice =
    session.localStorage['HB_TRUSTED_DEVICE'] || session.localStorage['HB_TRUSTED_DEVICE_LEGACY'];
  const companyNameFromHb = session.localStorage['HB_COMPANY_NAME'];

  if (!authToken) {
    throw new Error(
      'HoneyBook auth: no auth token at HONEYBOOK_REACT_CURR_USER./authentication_token. ' +
        'Sign into the vendor portal via the magic-link URL and retry.'
    );
  }
  if (!userId) {
    throw new Error('HoneyBook auth: no user id at HONEYBOOK_REACT_CURR_USER./_id.');
  }

  // `company` is null on a client-side portal user, so this pointer usually
  // resolves to nothing; fall back to the portal subdomain for a readable label.
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
    ...(trustedDevice ? { trustedDevice } : {}),
    capturedAt: Date.now(),
  };

  sessionStore.add(captured);
  return captured;
}
