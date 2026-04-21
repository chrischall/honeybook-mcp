import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import { loadVendorScopes, fetchApiVersion } from '../src/client.js';

describe('loadVendorScopes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
  });

  it('returns empty map when HONEYBOOK_VENDORS is unset', () => {
    expect(loadVendorScopes()).toEqual({});
  });

  it('parses a single vendor from slug-prefixed env vars', () => {
    process.env.HONEYBOOK_VENDORS = 'silk_veil';
    process.env.HB_SILK_VEIL_LABEL = 'The Silk Veil Events by Ivy';
    process.env.HB_SILK_VEIL_AUTH_TOKEN = 'tok_43';
    process.env.HB_SILK_VEIL_USER_ID = 'uid_24';
    process.env.HB_SILK_VEIL_TRUSTED_DEVICE = 'td_64';
    process.env.HB_SILK_VEIL_FINGERPRINT = 'fp_32';
    process.env.HB_SILK_VEIL_PORTAL_ORIGIN = 'https://thesilkveileventsbyivy.hbportal.co';
    const scopes = loadVendorScopes();
    expect(scopes).toEqual({
      silk_veil: {
        slug: 'silk_veil',
        label: 'The Silk Veil Events by Ivy',
        authToken: 'tok_43',
        userId: 'uid_24',
        trustedDevice: 'td_64',
        fingerprint: 'fp_32',
        portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
      },
    });
  });

  it('strips trailing slash from PORTAL_ORIGIN', () => {
    process.env.HONEYBOOK_VENDORS = 'x';
    process.env.HB_X_AUTH_TOKEN = 'a';
    process.env.HB_X_USER_ID = 'b';
    process.env.HB_X_TRUSTED_DEVICE = 'c';
    process.env.HB_X_FINGERPRINT = 'd';
    process.env.HB_X_PORTAL_ORIGIN = 'https://x.hbportal.co/';
    expect(loadVendorScopes().x?.portalOrigin).toBe('https://x.hbportal.co');
  });

  it('trims whitespace and ignores empty slugs', () => {
    process.env.HONEYBOOK_VENDORS = ' silk_veil , , photog ';
    process.env.HB_SILK_VEIL_AUTH_TOKEN = 'a';
    process.env.HB_SILK_VEIL_USER_ID = 'b';
    process.env.HB_SILK_VEIL_TRUSTED_DEVICE = 'c';
    process.env.HB_SILK_VEIL_FINGERPRINT = 'd';
    process.env.HB_SILK_VEIL_PORTAL_ORIGIN = 'https://sv.hbportal.co';
    process.env.HB_PHOTOG_AUTH_TOKEN = 'a2';
    process.env.HB_PHOTOG_USER_ID = 'b2';
    process.env.HB_PHOTOG_TRUSTED_DEVICE = 'c2';
    process.env.HB_PHOTOG_FINGERPRINT = 'd2';
    process.env.HB_PHOTOG_PORTAL_ORIGIN = 'https://p.hbportal.co';
    const scopes = loadVendorScopes();
    expect(Object.keys(scopes).sort()).toEqual(['photog', 'silk_veil']);
  });

  it('defaults label to slug when HB_<SLUG>_LABEL is missing', () => {
    process.env.HONEYBOOK_VENDORS = 'photog';
    process.env.HB_PHOTOG_AUTH_TOKEN = 'a';
    process.env.HB_PHOTOG_USER_ID = 'b';
    process.env.HB_PHOTOG_TRUSTED_DEVICE = 'c';
    process.env.HB_PHOTOG_FINGERPRINT = 'd';
    process.env.HB_PHOTOG_PORTAL_ORIGIN = 'https://p.hbportal.co';
    expect(loadVendorScopes().photog?.label).toBe('photog');
  });

  it('throws with a clear message when a required field is missing', () => {
    process.env.HONEYBOOK_VENDORS = 'venue';
    process.env.HB_VENUE_AUTH_TOKEN = 'a';
    // user_id, trusted_device, fingerprint, portal_origin all missing
    expect(() => loadVendorScopes()).toThrow(/venue.*HB_VENUE_USER_ID/);
  });
});

describe('fetchApiVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HONEYBOOK_API_VERSION;
  });

  it('uses HONEYBOOK_API_VERSION when set', async () => {
    process.env.HONEYBOOK_API_VERSION = '9999';
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchApiVersion()).toBe(9999);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches /api/gon and parses the JSONP callback', async () => {
    const body = '/**/parseGon({"api_version":2578,"version":"36.122.376"})';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200 })
    );
    expect(await fetchApiVersion()).toBe(2578);
  });

  it('throws when the callback body is unparseable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 200 })
    );
    await expect(fetchApiVersion()).rejects.toThrow(/api_version/);
  });
});
