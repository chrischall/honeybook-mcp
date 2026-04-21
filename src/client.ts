import type { VendorScope } from './types.js';

const REQUIRED_FIELDS = ['AUTH_TOKEN', 'USER_ID', 'TRUSTED_DEVICE', 'FINGERPRINT', 'PORTAL_ORIGIN'] as const;

export function loadVendorScopes(): Record<string, VendorScope> {
  const list = process.env.HONEYBOOK_VENDORS;
  if (!list) return {};
  const slugs = list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const scopes: Record<string, VendorScope> = {};
  for (const slug of slugs) {
    const UP = slug.toUpperCase();
    const get = (suffix: string) => process.env[`HB_${UP}_${suffix}`];
    for (const field of REQUIRED_FIELDS) {
      if (!get(field)) {
        throw new Error(
          `Vendor "${slug}": missing required env var HB_${UP}_${field}. ` +
            `Run \`npm run auth\` to capture credentials for this vendor.`
        );
      }
    }
    scopes[slug] = {
      slug,
      label: get('LABEL') || slug,
      authToken: get('AUTH_TOKEN')!,
      userId: get('USER_ID')!,
      trustedDevice: get('TRUSTED_DEVICE')!,
      fingerprint: get('FINGERPRINT')!,
      portalOrigin: get('PORTAL_ORIGIN')!.replace(/\/$/, ''),
    };
  }
  return scopes;
}

const API_BASE = 'https://api.honeybook.com';

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
  public readonly scope: VendorScope;
  private apiVersion: number;

  constructor(scope: VendorScope, apiVersion: number) {
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
        `HoneyBook auth expired for vendor "${this.scope.slug}". ` +
          `Run \`npm run auth\` to capture a fresh session.`
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
