// ────────────────────────────────────────────────────────────────────────────
// Flow (questionnaire) credential capture — the weak-auth twin of `auth.ts`
// ────────────────────────────────────────────────────────────────────────────
//
// Same one-shot `@fetchproxy/bootstrap` lift as `captureSessionViaFetchproxy`,
// pointed at a DIFFERENT storage key and producing a DIFFERENT credential kind.
// The portal capture reads `HONEYBOOK_REACT_CURR_USER`; this one reads
// `HONEYBOOK_REACT_WEAK_AUTH_<flowId>` — a record HoneyBook itself calls weak
// auth, scoped to one flow and carrying no `authentication_token` at all.
//
// One consequence is worth stating up front because it looks like a bug the
// first time it happens: the declared scope contains the flow id, so it is a
// NEW key for every new flow, and the extension gates on the scope approved at
// pair time. The first capture of each flow therefore needs a re-approval in
// the Transporter popup. That is the extension doing its job — consent is per
// key, and this key is per questionnaire — so the refusal is surfaced with
// that explanation rather than the generic "open the link in Chrome" copy.

import { bootstrap } from '@fetchproxy/bootstrap';
import { bridgeErrorInfo } from '@chrischall/mcp-utils/fetchproxy';
import { parseBoolEnv } from '@chrischall/mcp-utils';
import pkg from '../package.json' with { type: 'json' };
import { flowStorageKey, flowStore, parseFlowLink } from './flows.js';
import type { CapturedFlowCredential } from './types.js';

export interface CaptureFlowOpts {
  /** Full `/flow/<flowId>?hash=…` URL from the vendor's questionnaire email. */
  flowLinkUrl: string;
}

/** True if the user has explicitly disabled the fetchproxy capture path. */
function fetchproxyDisabled(): boolean {
  return parseBoolEnv('HONEYBOOK_DISABLE_FETCHPROXY');
}

/**
 * Capture a flow credential from the user's signed-in questionnaire tab and
 * persist it to `~/.honeybook-mcp/flows.json`, keyed by flow id.
 *
 * Preconditions: the fetchproxy extension is installed and the questionnaire
 * link has been opened in that browser (the page writes the weak-auth record
 * on load). The link itself is never navigated to from here.
 */
export async function captureFlowCredentialViaFetchproxy(
  opts: CaptureFlowOpts
): Promise<CapturedFlowCredential> {
  // Parse BEFORE the disabled check and before the bridge opens: a portal link
  // handed to this tool is a mistake we can name without touching the browser.
  const link = parseFlowLink(opts.flowLinkUrl);

  if (fetchproxyDisabled()) {
    throw new Error(
      'HoneyBook flow auth: fetchproxy capture is disabled by HONEYBOOK_DISABLE_FETCHPROXY. ' +
        'Unset that env var to enable credential capture via the browser extension.'
    );
  }

  const storageKey = flowStorageKey(link.flowId);

  let session;
  try {
    session = await bootstrap({
      serverName: pkg.name,
      version: pkg.version,
      domains: ['honeybook.com', 'hbportal.co'],
      storageDomain: 'hbportal.co',
      declare: {
        cookies: [],
        localStorage: [],
        // Pointers into the one flow-scoped key. Nothing here reads the portal
        // session blob — a flow credential is not made out of it.
        localStoragePointers: [
          { outputKey: 'HB_FLOW_HASH', storageKey, jsonPointer: '/hash' },
          { outputKey: 'HB_FLOW_USER_ID', storageKey, jsonPointer: '/_id' },
          { outputKey: 'HB_FLOW_EMAIL', storageKey, jsonPointer: '/email' },
          {
            outputKey: 'HB_FLOW_CHARGEABLE',
            storageKey,
            jsonPointer: '/is_real_chargeable_user',
          },
        ],
        sessionStorage: [],
        captureHeaders: [],
      },
      onPairCode: (code) => {
        process.stderr.write(`[honeybook-mcp] fetchproxy pair code: ${code}\n`);
      },
      onWaiting: (hint) => {
        process.stderr.write(`[honeybook-mcp] ${hint}\n`);
      },
    });
  } catch (e) {
    const bridgeError = bridgeErrorInfo(e);
    if (bridgeError.type === 'bridge_down') {
      throw new Error(
        `HoneyBook flow auth: fetchproxy bridge is down (extension service worker unreachable after retry). ${bridgeError.hint ?? ''}`.trimEnd()
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    // Match on the class NAME rather than `instanceof` so a duplicated
    // @fetchproxy/server copy in the dependency tree cannot defeat the check —
    // same reasoning as `auth.ts`.
    const errName = (e as { name?: string } | null)?.name;
    if (errName === 'FetchproxyScopeError' || /not in declared set/i.test(msg)) {
      throw new Error(
        `HoneyBook flow auth: ${msg} — the declared scope names ONE key per flow ` +
          `("${storageKey}"), so the extension asks you to approve each new questionnaire ` +
          'once. Revoke honeybook-mcp in the Transporter popup, re-run this tool, and approve ' +
          'the new scope.'
      );
    }
    if (bridgeError.type === 'timeout' || /timeout/i.test(msg)) {
      throw new Error(
        'HoneyBook flow auth: fetchproxy capture timed out. The extension never returned ' +
          `"${storageKey}", which usually means the questionnaire is not open and loaded in ` +
          'that browser. Open the /flow/ link in Chrome (with the fetchproxy extension ' +
          'installed), let the questionnaire render, then re-run use_flow_link.'
      );
    }
    throw new Error(
      `HoneyBook flow auth: fetchproxy capture failed: ${msg} — ` +
        'open the questionnaire link in Chrome (with the fetchproxy extension installed), ' +
        'then retry.'
    );
  }

  const storedHash = session.localStorage['HB_FLOW_HASH'];
  const userId = session.localStorage['HB_FLOW_USER_ID'];
  const email = session.localStorage['HB_FLOW_EMAIL'];
  const chargeable = session.localStorage['HB_FLOW_CHARGEABLE'];

  // The page copies `?hash=` into storage on load, so the two normally agree.
  // Prefer the STORED one: that is the value the page would actually send, and
  // it survives a link whose query the app has since rewritten. Fall back to
  // the link's own hash for a tab that has not re-rendered since.
  const hash = storedHash || link.hash;
  if (!hash) {
    throw new Error(
      `HoneyBook flow auth: no auth hash for flow ${link.flowId}. Neither ` +
        `localStorage["${storageKey}"]./hash nor the link's ?hash= parameter supplied one. ` +
        'Re-open the original questionnaire link from the vendor email (the one that still ' +
        'has ?hash=… on it) and re-run use_flow_link.'
    );
  }

  let companyName = '';
  try {
    companyName = new URL(link.portalOrigin).hostname.split('.')[0] ?? '';
  } catch {
    companyName = '';
  }

  const captured: CapturedFlowCredential = {
    flowId: link.flowId,
    portalOrigin: link.portalOrigin,
    companyName,
    hash,
    ...(userId ? { userId } : {}),
    ...(email ? { email } : {}),
    ...(chargeable !== undefined ? { isRealChargeableUser: chargeable === 'true' } : {}),
    capturedAt: Date.now(),
  };

  flowStore.add(captured);
  return captured;
}
