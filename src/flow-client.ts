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
// and the flow app's `getHeaders()` sends exactly those three, taken from
// `localStorage[HONEYBOOK_REACT_WEAK_AUTH_<flowId>]`, when the session is
// weak-authenticated. It sends NO `HB-Api-Auth-Token` and no user id on that
// branch, which is why this is a separate client rather than a flag on the
// portal one.

import { hbApiRequest, fetchApiVersion, moduleState, type HbApiCaller, type HbMethod } from './client.js';
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
   * The hash is the only mandatory field — it IS the credential. The user id
   * and email are present once the client has identified themselves on the
   * questionnaire and are omitted otherwise, rather than serialized as the
   * string "undefined".
   */
  authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'hb-api-w-hash': this.credential.hash };
    if (this.credential.userId) headers['hb-api-w-user-id'] = this.credential.userId;
    if (this.credential.email) headers['hb-api-w-email'] = this.credential.email;
    return headers;
  }

  async request<T>(method: HbMethod, path: string, body?: unknown): Promise<T> {
    return hbApiRequest<T>(this, method, path, body);
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
