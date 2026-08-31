// ────────────────────────────────────────────────────────────────────────────
// Flow (questionnaire) API client — weak auth, one flow
// ────────────────────────────────────────────────────────────────────────────
//
// Same transport as `HoneyBookClient` (both go through `hbApiRequest`), a
// different identity. The header names are not guessed: they come from
// `hb_api_headers` in https://api.honeybook.com/api/gon, read live on
// 2026-08-31 —
//
//   weak_auth_hash       => HB-Api-W-Hash
//   weak_auth_user_id    => HB-Api-W-User-Id
//   weak_auth_user_email => HB-Api-W-Email
//
// and the flow app's `getHeaders()` sends those, taken from
// `localStorage[HONEYBOOK_REACT_WEAK_AUTH_<flowId>]`, when the session is
// weak-authenticated. It sends NO `HB-Api-Auth-Token`, which is why this is a
// separate client rather than a flag on the portal one.
//
// A HAR of a live questionnaire (2026-08-31) then settled what the source could
// not. A successful read carries exactly THREE headers — `hb-api-w-hash`,
// `hb-api-w-user-id` and `hb-api-client-version` — and the client version is
// REQUIRED, isolated by elimination: hash + user-id alone is a 400, adding
// `hb-api-fingerprint` is still a 400, adding the version makes it a 200. The
// email header did not appear because the measured blob had no `email` in it at
// all (only `_id` and `hash`); `getHeaders()` does send it when there is one, so
// it stays conditional here rather than being deleted on one observation.

import {
  API_BASE,
  fetchApiVersion,
  hbApiRequest,
  isHoneyBookApiError,
  moduleState,
  type HbApiCaller,
  type HbMethod,
  type HoneyBookApiError,
} from './client.js';
import { flowStore } from './flows.js';
import type { CapturedFlowCredential } from './types.js';

/**
 * The one "no flow credential yet" message. Shared the way
 * `NO_ACTIVE_SESSION_MESSAGE` is, so nothing re-words it.
 */
export const NO_FLOW_CREDENTIAL_MESSAGE =
  'No active HoneyBook flow credential. Use the `use_flow_link` tool with a questionnaire link ' +
  "(https://<vendor>.hbportal.co/flow/<flowId>?hash=…) from a vendor's email to activate one.";

export class FlowClient implements HbApiCaller {
  public readonly credential: CapturedFlowCredential;
  private apiVersion: number;

  constructor(credential: CapturedFlowCredential, apiVersion: number) {
    this.credential = credential;
    this.apiVersion = apiVersion;
  }

  getApiVersion(): number {
    return this.apiVersion;
  }

  setApiVersion(version: number): void {
    this.apiVersion = version;
  }

  /**
   * The hash is the only mandatory field — it IS the credential.
   *
   * `userId` was present on the one live capture; `email` was NOT (the stored
   * blob held only `_id` and `hash`), so do not read the conditional as "these
   * are usually there". Both are omitted when absent rather than serialized as
   * the string "undefined".
   */
  authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'hb-api-w-hash': this.credential.hash };
    if (this.credential.userId) headers['hb-api-w-user-id'] = this.credential.userId;
    if (this.credential.email) headers['hb-api-w-email'] = this.credential.email;
    return headers;
  }

  async request<T>(method: HbMethod, path: string, body?: unknown): Promise<T> {
    try {
      return await hbApiRequest<T>(this, method, path, body);
    } catch (err) {
      // Branch on the STATUS, never on the message.
      if (isHoneyBookApiError(err) && err.status === 400) throw this.badRequestError(err);
      throw err;
    }
  }

  /**
   * Explain a bare 400.
   *
   * A flow read that is missing a required input answers `400` with
   * `"Unexpected server error"` and no `error_type` — nothing in the body says
   * which input, and it reads exactly like an auth failure. Left alone it sends
   * people to re-capture a credential that is fine, so the two known causes are
   * named here and the auth reading is denied outright.
   */
  private badRequestError(err: HoneyBookApiError): Error {
    return new Error(
      `${err.message}\n\n` +
        'HoneyBook answers a flow read with a bare 400 when a required input is missing, without ' +
        'saying which. The two that do it:\n' +
        `  1. hb-api-client-version — sent as ${this.apiVersion}. It is read from /api/gon at ` +
        'startup, so it normally tracks HoneyBook; if HONEYBOOK_API_VERSION is pinned in your ' +
        'environment that value can have rotted, so unset it to re-read the live one.\n' +
        '  2. ctxc — the company id from /api/v2/flow/<flowId>/minimal, required on every ' +
        '/api/v2/client/… read.\n' +
        'This is NOT an auth failure — the credential is very likely fine, so re-running ' +
        '`use_flow_link` will not help.'
    );
  }

  /** The flow twin of the portal client's expired-session error. */
  authExpiredError(): Error {
    return new Error(
      `HoneyBook flow credential expired or rejected for flow ${this.credential.flowId} ` +
        `(${this.credential.portalOrigin}). Re-open the questionnaire link in Chrome and use the ` +
        '`use_flow_link` tool to capture a fresh credential.'
    );
  }
}

/**
 * Resolve a {@link FlowClient} for `flowId`, or for the most recently captured
 * credential when none is named.
 *
 * Deliberately reads ONLY `flowStore`: a portal session is not a fallback here,
 * and the refusal says which tool to run rather than letting the call proceed
 * and fail upstream.
 */
export async function getActiveFlowClient(flowId?: string): Promise<FlowClient> {
  const credential = flowStore.get(flowId);
  if (!credential) {
    const active = flowStore.list();
    if (active.length === 0) throw new Error(NO_FLOW_CREDENTIAL_MESSAGE);
    throw new Error(
      `No flow credential for "${flowId}". Active flows: ${active
        .map((c) => c.flowId)
        .join(', ')}. Capture this one with \`use_flow_link\`.`
    );
  }

  if (!moduleState.apiVersionPromise) {
    moduleState.apiVersionPromise = fetchApiVersion().catch((err: unknown) => {
      moduleState.apiVersionPromise = null;
      throw err;
    });
  }
  return new FlowClient(credential, await moduleState.apiVersionPromise);
}

/**
 * The public metadata a flow exposes with no credential at all.
 *
 * Only the fields this MCP reads are typed; the response carries more (theme,
 * owner, expiration, `require_authentication`, `client_facing_host`).
 */
export interface FlowMinimal {
  branding_data?: { company_id?: string; title?: string };
  title?: string;
}

/**
 * `GET /api/v2/flow/<flowId>/minimal` — the app's `fetchFlowMinimalData`.
 *
 * Three things about it are easy to get wrong:
 *
 *  * It is the PUBLIC route, with no `/client/` segment. The app fetches it
 *    through its no-auth service, which does not run the interceptor that
 *    rewrites `/api/v2/` to `/api/v2/client/`. Verified live: it answers 200
 *    with no credential.
 *  * `user_id` is a QUERY parameter here, not a header — the one place in this
 *    MCP where a user id travels in the query string.
 *  * Because it needs no credential, it is not given one. Spending the flow
 *    hash on a call that does not ask for it is authority for nothing.
 */
export async function fetchFlowMinimal(
  flowId: string,
  opts: { userId?: string; apiVersion: number }
): Promise<FlowMinimal> {
  const query = new URLSearchParams();
  if (opts.userId) query.set('user_id', opts.userId);
  const suffix = query.size > 0 ? `?${query}` : '';
  const url = `${API_BASE}/api/v2/flow/${encodeURIComponent(flowId)}/minimal${suffix}`;

  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'hb-api-client-version': String(opts.apiVersion),
    },
  });
  if (!response.ok) {
    throw new Error(
      `HoneyBook flow: GET /api/v2/flow/${flowId}/minimal answered ${response.status}. That route ` +
        'is public, so this is a HoneyBook-side problem rather than a credential one; it is where ' +
        'the context id (ctxc) required by the questionnaire read comes from.'
    );
  }
  return (await response.json()) as FlowMinimal;
}

/**
 * The `ctxc` value: the vendor's company id.
 *
 * The app sets `params.ctxc` from `clientPortalConfigStore.clientPortalCompanyId`
 * in its request interceptor, and `branding_data.company_id` is that same id —
 * verified live as the only 24-hex value the `/minimal` response carries.
 *
 * Returns `null` rather than guessing: a wrong `ctxc` is the same bare 400 as a
 * missing one, so a fabricated value would be indistinguishable from a genuine
 * failure.
 */
export function flowContextId(minimal: FlowMinimal): string | null {
  return minimal.branding_data?.company_id ?? null;
}
