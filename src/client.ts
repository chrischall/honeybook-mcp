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
