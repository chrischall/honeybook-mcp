import type { CapturedSession } from './types.js';
import { sessionStore } from './sessions.js';
import { flowStore } from './flows.js';
import { readEnvVar, formatApiError } from '@chrischall/mcp-utils';

export const API_BASE = 'https://api.honeybook.com';

// Cache keyed by portalOrigin
const clientCache = new Map<string, HoneyBookClient>();
export const moduleState: { apiVersionPromise: Promise<number> | null } = { apiVersionPromise: null };

export async function fetchApiVersion(): Promise<number> {
  const override = readEnvVar('HONEYBOOK_API_VERSION');
  if (override) return Number(override);
  const res = await fetch(`${API_BASE}/api/gon?callback=parseGon`);
  const text = await res.text();
  const m = /"api_version":\s*(\d+)/.exec(text);
  if (!m) throw new Error(`Could not parse api_version from /api/gon response: ${text.slice(0, 200)}`);
  return Number(m[1]);
}

export type HbMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * What {@link hbApiRequest} needs from a credential in order to make a call.
 *
 * api.honeybook.com answers to two credential kinds — a portal session and a
 * flow (questionnaire) weak-auth credential — and the transport around them is
 * identical: the same 401, the same 404-plus-`HBUnauthorizedError` disguise for
 * a dead credential, the same 429 backoff, the same `HBWrongAPIVersionError`
 * refresh. Only the identity HEADERS and the "re-capture it" instruction
 * differ, so those are the seam. Duplicating the loop per kind is how the
 * 404 disguise would end up handled on one path and not the other.
 */
export interface HbApiCaller {
  /** Identity headers for this credential kind. Never a shared default. */
  authHeaders(): Record<string, string>;
  /** Current `hb-api-client-version`. */
  getApiVersion(): number;
  /** Adopt a server-reported version after an `HBWrongAPIVersionError`. */
  setApiVersion(version: number): void;
  /** The "this credential is dead, capture a fresh one" error for this kind. */
  authExpiredError(): Error;
}

/**
 * One authenticated request to api.honeybook.com, shared by every credential
 * kind. See {@link HbApiCaller} for why the identity is a parameter.
 */
export async function hbApiRequest<T>(
  caller: HbApiCaller,
  method: HbMethod,
  path: string,
  body?: unknown,
  isVersionRetry = false,
  isRateRetry = false
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'hb-api-client-version': String(caller.getApiVersion()),
    'hb-api-duplicate-calls-prevention-uuid': crypto.randomUUID(),
    ...caller.authHeaders(),
  };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401) throw caller.authExpiredError();

  if (response.status === 429) {
    if (!isRateRetry) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      return hbApiRequest<T>(caller, method, path, body, isVersionRetry, true);
    }
    throw new Error('Rate limited by HoneyBook API');
  }

  if (!response.ok) {
    const text = await response.text();
    // A revoked or stale credential does NOT come back as 401 — the API answers
    // 404 with an HBUnauthorizedError body. Without this, an expired session
    // surfaced as an opaque "HoneyBook error 404" instead of the re-capture
    // instruction. Gate on the body so a genuinely missing resource stays a
    // plain 404. Verified live for the flow path too: an unauthenticated GET of
    // /api/v2/flow/<id>/active answers exactly this shape.
    if (response.status === 404 && text.includes('HBUnauthorizedError')) {
      throw caller.authExpiredError();
    }
    if (text.includes('HBWrongAPIVersionError') && !isVersionRetry) {
      try {
        const parsed = JSON.parse(text) as { error_data?: { server_api_version?: number } };
        const fresh = parsed.error_data?.server_api_version ?? (await fetchApiVersion());
        caller.setApiVersion(fresh);
        moduleState.apiVersionPromise = Promise.resolve(fresh);
      } catch {
        caller.setApiVersion(await fetchApiVersion());
      }
      return hbApiRequest<T>(caller, method, path, body, true, isRateRetry);
    }
    throw new Error(formatApiError(response.status, method, path, text, { service: 'HoneyBook' }));
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export class HoneyBookClient implements HbApiCaller {
  public readonly scope: CapturedSession;
  private apiVersion: number;

  constructor(scope: CapturedSession, apiVersion: number) {
    this.scope = scope;
    this.apiVersion = apiVersion;
  }

  getApiVersion(): number {
    return this.apiVersion;
  }

  setApiVersion(version: number): void {
    this.apiVersion = version;
  }

  /**
   * Only the auth token, user id and a current client version are
   * load-bearing. `hb-trusted-device` and `hb-api-fingerprint` are sent when
   * the session has them — sessions captured by <=0.4.4 carry a fingerprint —
   * but the API answers 200 without either, so they are omitted rather than
   * serialized as the string "undefined".
   */
  authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'hb-api-auth-token': this.scope.authToken,
      'hb-api-user-id': this.scope.userId,
      'hb-admin-login': 'false',
    };
    if (this.scope.trustedDevice) headers['hb-trusted-device'] = this.scope.trustedDevice;
    if (this.scope.fingerprint) headers['hb-api-fingerprint'] = this.scope.fingerprint;
    return headers;
  }

  async request<T>(
    method: HbMethod,
    path: string,
    body?: unknown,
    isVersionRetry = false,
    isRateRetry = false
  ): Promise<T> {
    return hbApiRequest<T>(this, method, path, body, isVersionRetry, isRateRetry);
  }

  /** The one "your session died, re-capture it" error, raised from both auth paths. */
  authExpiredError(): Error {
    return new Error(
      `HoneyBook auth expired for portal "${this.scope.companyName}" (${this.scope.portalOrigin}). ` +
        `Use the \`use_magic_link\` tool to capture a fresh session.`
    );
  }
}

export function clearClientCache(): void {
  clientCache.clear();
}

export function resetClientsForTest(): void {
  clientCache.clear();
  moduleState.apiVersionPromise = null;
}

/**
 * The one "no session yet" message, shared with `honeybook_healthcheck` so the
 * two cannot drift into telling the user different things about the same
 * state.
 */
export const NO_ACTIVE_SESSION_MESSAGE =
  'No active HoneyBook session. Use the `use_magic_link` tool with a magic-link URL from a vendor\'s email to activate one.';

/**
 * Thrown when a tool needs a PORTAL session and there isn't one.
 *
 * A class rather than a bare `Error` because the reader has to be able to tell
 * this apart from "HoneyBook rejected the session", and the two messages both
 * name `use_magic_link` — once as a remedy, once as a symptom. Matching on the
 * prose is how that collision keeps coming back (it was a live bug in
 * `tools/healthcheck.ts` on 2026-08-30), so the classifier keys off
 * {@link isNoPortalSessionError} instead.
 */
export class NoPortalSessionError extends Error {
  /** Structural marker, so the predicate survives a duplicated module copy. */
  readonly noPortalSession = true;
  /** How many flow (questionnaire) credentials WERE present. Never their ids. */
  readonly flowCredentialCount: number;

  constructor(message: string, flowCredentialCount: number) {
    super(message);
    this.name = 'NoPortalSessionError';
    this.flowCredentialCount = flowCredentialCount;
  }
}

/** The predicate a reader imports instead of re-deriving the condition from prose. */
export function isNoPortalSessionError(err: unknown): err is NoPortalSessionError {
  return (
    err instanceof NoPortalSessionError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { noPortalSession?: unknown }).noPortalSession === true)
  );
}

/**
 * Build the "no portal session" refusal, naming the credential kind that IS
 * present when it is the wrong one.
 *
 * A flow credential is weak auth scoped to a single questionnaire; it carries
 * no `authentication_token` and the portal endpoints will not answer to it.
 * Accepting it here would trade an answerable refusal for an opaque upstream
 * 404 several calls later. The count is named rather than the flow ids: a
 * healthcheck result is something people paste into chats.
 */
export function noPortalSessionError(): NoPortalSessionError {
  const flowCount = flowStore.list().length;
  if (flowCount === 0) return new NoPortalSessionError(NO_ACTIVE_SESSION_MESSAGE, 0);
  return new NoPortalSessionError(
    `No active HoneyBook portal session. ${flowCount} flow (questionnaire) credential${
      flowCount === 1 ? ' is' : 's are'
    } active, but a flow credential is weak auth scoped to one questionnaire and cannot read ` +
      'portal data. This tool needs a portal session: run `use_magic_link` with a client-portal ' +
      'link (/app/link/resolve/…). To read a questionnaire instead, use `get_flow`.',
    flowCount
  );
}

export async function getActiveClient(origin?: string): Promise<HoneyBookClient> {
  const session = sessionStore.get(origin);
  if (!session) {
    const active = sessionStore.list();
    if (active.length === 0) {
      throw noPortalSessionError();
    }
    throw new Error(
      `No active session for origin "${origin}". Active origins: ${active.map((s) => s.portalOrigin).join(', ')}`
    );
  }

  const cached = clientCache.get(session.portalOrigin);
  if (cached) return cached;

  if (!moduleState.apiVersionPromise) {
    // Memoize the one-time fetch, but only on success — if it rejects, clear
    // the cache so the next call retries instead of re-awaiting the same
    // rejection until process restart.
    moduleState.apiVersionPromise = fetchApiVersion().catch((err: unknown) => {
      moduleState.apiVersionPromise = null;
      throw err;
    });
  }
  const apiVersion = await moduleState.apiVersionPromise;
  const client = new HoneyBookClient(session, apiVersion);
  clientCache.set(session.portalOrigin, client);
  return client;
}

/** Test-only — do not use in production code. Returns the currently cached api version, if any. */
export async function currentModuleApiVersion(): Promise<number | null> {
  return moduleState.apiVersionPromise ? await moduleState.apiVersionPromise : null;
}