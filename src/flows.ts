// ────────────────────────────────────────────────────────────────────────────
// Questionnaire ("flow") links — parsing, storage key, and the credential store
// ────────────────────────────────────────────────────────────────────────────
//
// A HoneyBook vendor sends two shapes of magic link, and only one of them was
// supported before this module existed:
//
//   https://<vendor>.hbportal.co/app/link/resolve/<id>/<uuid>?…   client portal
//   https://<vendor>.hbportal.co/flow/<flowId>?hash=…&userId=…    questionnaire
//
// The second signs nobody into the portal. It writes a per-flow **weak auth**
// record instead, and everything below is read out of the shipped flow app
// (`public.honeybook.com/public_react_flow_app/<build>/main.*.js`, inspected
// 2026-08-31):
//
//   getLimitedAuthStorageKey(flowId) => `HONEYBOOK_REACT_WEAK_AUTH_${flowId}`
//   getAuthHashUrlParameterFromSearchParam(p) => p.get('hash')
//   setWeakTokenInStorage(u) => setItem(key, JSON.stringify(
//     { hash, _id, email, is_real_chargeable_user }))
//
// The store is SEPARATE from the portal `sessionStore` on purpose. Keeping the
// two kinds in one keyed store would make "a portal tool must not accept a flow
// credential" a check that every call site has to remember; keeping them apart
// makes it structural — `sessionStore.get()` cannot return one.

import { join } from 'node:path';
import { SessionStore, normalizeOrigin } from '@chrischall/mcp-utils/session';
import { sessionsDir } from './sessions.js';
import type { CapturedFlowCredential } from './types.js';

/** The flow app's storage-key prefix, verbatim. The flow id is appended to it. */
export const FLOW_WEAK_AUTH_PREFIX = 'HONEYBOOK_REACT_WEAK_AUTH';

/** `localStorage` key holding the weak-auth record for one flow. */
export function flowStorageKey(flowId: string): string {
  return `${FLOW_WEAK_AUTH_PREFIX}_${flowId}`;
}

/** What {@link parseFlowLink} recovers from a questionnaire link. */
export interface ParsedFlowLink {
  /** The flow id from the `/flow/<flowId>` path segment. */
  flowId: string;
  /** The vendor portal origin the link points at. */
  portalOrigin: string;
  /**
   * The `?hash=` value, or `null` when the link carries none. Null is a real
   * outcome — a link the user copied after the app rewrote the URL has lost
   * it — so it is reported rather than defaulted.
   */
  hash: string | null;
}

/** Path shape of a questionnaire link: `/flow/<flowId>` plus optional step route. */
const FLOW_PATH = /^\/flow\/([^/?#]+)/;

/**
 * True when `input` is a questionnaire link.
 *
 * Exported so `use_magic_link` and `use_flow_link` can refuse each other's
 * input from ONE definition. Neither tool re-derives this, and nothing matches
 * on an error message to decide it.
 */
export function isFlowLinkUrl(input: string): boolean {
  try {
    return FLOW_PATH.test(new URL(input).pathname);
  } catch {
    return false;
  }
}

/**
 * Parse a questionnaire link into the flow id, portal origin and auth hash.
 *
 * Throws — naming `use_magic_link` — when handed a client-portal link, because
 * the alternative is capturing nothing and reporting an empty success.
 */
export function parseFlowLink(input: string): ParsedFlowLink {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`HoneyBook flow: "${input}" is not a URL.`);
  }
  const match = FLOW_PATH.exec(url.pathname);
  if (!match) {
    throw new Error(
      `HoneyBook flow: "${url.pathname}" is not a questionnaire link. A flow link looks like ` +
        'https://<vendor>.hbportal.co/flow/<flowId>?hash=… — for a client-portal link ' +
        '(/app/link/resolve/…) use the `use_magic_link` tool instead.'
    );
  }
  return {
    flowId: match[1]!,
    portalOrigin: normalizeOrigin(url.href),
    hash: url.searchParams.get('hash'),
  };
}

/**
 * Store key for a flow credential. Accepts a bare flow id or a full flow URL,
 * mirroring how `normalizeOrigin` lets the portal store be queried with either
 * an origin or a whole magic link.
 */
export function normalizeFlowKey(input: string): string {
  return isFlowLinkUrl(input) ? parseFlowLink(input).flowId : input.trim();
}

/**
 * Its own file beside `sessions.json`, under the same `HONEYBOOK_SESSIONS_DIR`
 * override so the test suite's isolation covers it for free.
 */
export const flowsFilePath = join(sessionsDir, 'flows.json');

export const flowStore = new SessionStore<CapturedFlowCredential>({
  filePath: flowsFilePath,
  keyOf: (credential) => credential.flowId,
  normalizeKey: normalizeFlowKey,
});
