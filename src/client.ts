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

const clientCache = new Map<string, HoneyBookClient>();
const moduleState: { apiVersionPromise: Promise<number> | null } = { apiVersionPromise: null };

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

export function resetClientsForTest(): void {
  clientCache.clear();
  moduleState.apiVersionPromise = null;
}

export async function getClientFor(vendor?: string): Promise<HoneyBookClient> {
  // Fast path: if vendor is explicitly provided and already cached, skip env reload.
  if (vendor) {
    const cached = clientCache.get(vendor);
    if (cached) return cached;
  }
  const scopes = loadVendorScopes();
  const slugs = Object.keys(scopes);
  if (slugs.length === 0) {
    throw new Error(
      'No HoneyBook vendors configured. Set HONEYBOOK_VENDORS and run `npm run auth` to populate credentials.'
    );
  }
  let slug: string;
  if (!vendor) {
    if (slugs.length > 1) {
      throw new Error(
        `Multiple vendors configured (${slugs.join(', ')}). Please specify the \`vendor\` argument.`
      );
    }
    slug = slugs[0]!;
  } else {
    if (!scopes[vendor]) {
      throw new Error(
        `Vendor "${vendor}" not in HONEYBOOK_VENDORS. Configured: ${slugs.join(', ') || '(none)'}.`
      );
    }
    slug = vendor;
  }
  const existing = clientCache.get(slug);
  if (existing) return existing;
  if (!moduleState.apiVersionPromise) moduleState.apiVersionPromise = fetchApiVersion();
  const apiVersion = await moduleState.apiVersionPromise;
  const client = new HoneyBookClient(scopes[slug]!, apiVersion);
  clientCache.set(slug, client);
  return client;
}

export function listConfiguredVendors(): { slug: string; label: string }[] {
  const scopes = loadVendorScopes();
  return Object.values(scopes).map((s) => ({ slug: s.slug, label: s.label }));
}

/** Test-only — do not use in production code. Returns the currently cached api version, if any. */
export async function currentModuleApiVersion(): Promise<number | null> {
  return moduleState.apiVersionPromise ? await moduleState.apiVersionPromise : null;
}
