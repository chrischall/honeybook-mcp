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
   * Explain an untyped 400.
   *
   * A 400 with no `error_type` says nothing about which input was wrong and
   * reads exactly like an auth failure; left alone it sends people to
   * re-capture a credential that is fine, so the auth reading is denied
   * outright.
   *
   * What can NOT reach here is the client version. Probed live 2026-08-31,
   * every version failure — stale, garbage, empty, omitted — answers 400 with
   * `error_type: HBWrongAPIVersionError` and `error_data.server_api_version`,
   * which `hbApiRequest` intercepts and retries once on the server's own
   * number, so it self-heals a layer below. `ctxc` cannot reach here either:
   * the API ignores it entirely (omitted, bogus, and `/client/`-less all return
   * the same 200, byte-identical), and naming it here only misdirected. So the
   * version is offered as the input to CHECK rather than as a known cause, and
   * this is deliberately vaguer than 0.8.0's message: no cause is confirmed.
   */
  private badRequestError(err: HoneyBookApiError): Error {
    return new Error(
      `${err.message}\n\n` +
        'HoneyBook answered this flow read with a 400 carrying no error_type, so nothing in the ' +
        'response says which input it objected to. The input worth checking is ' +
        `hb-api-client-version, sent as ${this.apiVersion}: it is read from /api/gon at startup, ` +
        'so it normally tracks HoneyBook, but a pinned HONEYBOOK_API_VERSION can have rotted — ' +
        'unset it to re-read the live one. (A version HoneyBook actively rejects answers with ' +
        'error_type HBWrongAPIVersionError and is retried automatically, so it would not surface ' +
        'here.)\n' +
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
    // The body, and a cause keyed on the STATUS — not one blanket "HoneyBook is
    // broken". This route is public, so it is never a credential problem, but
    // that does not make every failure the same: a 404 is a flow that is gone
    // or was never there, and an HBWrongAPIVersionError is this package's
    // pinned `hb-api-client-version` having rotted, which is ours to fix and
    // nothing to do with HoneyBook being down.
    const body = await response.text().catch(() => '');
    const detail = body.slice(0, 300);
    const cause =
      response.status === 404
        ? `no flow ${flowId} — it may have been deleted, or the id is wrong`
        : /WrongAPIVersion/i.test(body)
          ? `HoneyBook rejected hb-api-client-version ${opts.apiVersion}; this package's pinned value needs updating`
          : 'that route is public, so this is a HoneyBook-side problem rather than a credential one';
    throw new Error(
      `HoneyBook flow: GET /api/v2/flow/${flowId}/minimal answered ${response.status} — ${cause}. ` +
        `It is where the context id (ctxc) the questionnaire read sends comes from.` +
        (detail ? ` Response: ${detail}` : '')
    );
  }
  return (await response.json()) as FlowMinimal;
}

/**
 * The `ctxc` value: the vendor's company id.
 *
 * The app sets `params.ctxc` from `clientPortalConfigStore.clientPortalCompanyId`
 * in its request interceptor, and `branding_data.company_id` is that same id.
 * (0.8.0's docblock called it the only 24-hex value in `/minimal`; it is not —
 * `theme._id` is another — so this reads the field by name, as it always did.)
 *
 * Returns `null` rather than guessing, and `null` is a normal outcome: the read
 * omits `ctxc` entirely in that case. The API ignores the value regardless —
 * verified live 2026-08-31 that a bogus one returns the same 200 — so a
 * fabricated id would be neither safer nor more honest than sending none.
 */
export function flowContextId(minimal: FlowMinimal): string | null {
  return minimal.branding_data?.company_id ?? null;
}
