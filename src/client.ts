import type { CapturedSession } from './types.js';
import { sessionStore } from './sessions.js';

const API_BASE = 'https://api.honeybook.com';

// Cache keyed by portalOrigin
const clientCache = new Map<string, HoneyBookClient>();
export const moduleState: { apiVersionPromise: Promise<number> | null } = { apiVersionPromise: null };

export async function fetchApiVersion(): Promise<number> {
  const override = process.env.HONEYBOOK_API_VERSION;
  if (override) return Number(override);
  const res = await fetch(`${API_BASE}/api/gon?callback=parseGon`);
  const text = await res.text();
  const m = /"api_version":\s*(\d+)/.exec(text);
  if (!m) throw new Error(`Could not parse api_version from /api/gon response: ${text.slice(0, 200)}`);
  return Number(m[1]);
}

export class HoneyBookClient {
  public readonly scope: CapturedSession;
  private apiVersion: number;

  constructor(scope: CapturedSession, apiVersion: number) {
    this.scope = scope;
    this.apiVersion = apiVersion;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
    isVersionRetry = false,
    isRateRetry = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'hb-api-auth-token': this.scope.authToken,
      'hb-api-user-id': this.scope.userId,
      'hb-trusted-device': this.scope.trustedDevice,
      'hb-api-client-version': String(this.apiVersion),
      'hb-api-fingerprint': this.scope.fingerprint,
      'hb-api-duplicate-calls-prevention-uuid': crypto.randomUUID(),
      'hb-admin-login': 'false',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 401) {
      throw new Error(
        `HoneyBook auth expired for portal "${this.scope.companyName}" (${this.scope.portalOrigin}). ` +
          `Use the \`use_magic_link\` tool to capture a fresh session.`
      );
    }

    if (response.status === 429) {
      if (!isRateRetry) {
        await new Promise<void>((r) => setTimeout(r, 2000));
        return this.request<T>(method, path, body, isVersionRetry, true);
      }
      throw new Error('Rate limited by HoneyBook API');
    }

    if (!response.ok) {
      const text = await response.text();
      if (text.includes('HBWrongAPIVersionError') && !isVersionRetry) {
        try {
          const parsed = JSON.parse(text) as { error_data?: { server_api_version?: number } };
          const fresh = parsed.error_data?.server_api_version ?? (await fetchApiVersion());
          this.apiVersion = fresh;
          moduleState.apiVersionPromise = Promise.resolve(fresh);
        } catch {
          this.apiVersion = await fetchApiVersion();
        }
        return this.request<T>(method, path, body, true, isRateRetry);
      }
      throw new Error(
        `HoneyBook API error ${response.status} ${response.statusText} for ${method} ${path}: ${text.slice(0, 200)}`
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}

export function clearClientCache(): void {
  clientCache.clear();
}

export function resetClientsForTest(): void {
  clientCache.clear();
  moduleState.apiVersionPromise = null;
}

export async function getActiveClient(origin?: string): Promise<HoneyBookClient> {
  const session = sessionStore.get(origin);
  if (!session) {
    const active = sessionStore.list();
    if (active.length === 0) {
      throw new Error(
        'No active HoneyBook session. Use the `use_magic_link` tool with a magic-link URL from a vendor\'s email to activate one.'
      );
    }
    throw new Error(
      `No active session for origin "${origin}". Active origins: ${active.map((s) => s.portalOrigin).join(', ')}`
    );
  }

  const cached = clientCache.get(session.portalOrigin);
  if (cached) return cached;

  if (!moduleState.apiVersionPromise) moduleState.apiVersionPromise = fetchApiVersion();
  const apiVersion = await moduleState.apiVersionPromise;
  const client = new HoneyBookClient(session, apiVersion);
  clientCache.set(session.portalOrigin, client);
  return client;
}

/** Test-only — do not use in production code. Returns the currently cached api version, if any. */
export async function currentModuleApiVersion(): Promise<number | null> {
  return moduleState.apiVersionPromise ? await moduleState.apiVersionPromise : null;
}
