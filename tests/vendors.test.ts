import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listVendors } from '../src/tools/vendors.js';

describe('listVendors', () => {
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
  });

  it('returns configured vendors with slug and label', async () => {
    process.env.HONEYBOOK_VENDORS = 'silk_veil,photog';
    process.env.HB_SILK_VEIL_LABEL = 'Silk Veil Events';
    for (const v of ['SILK_VEIL', 'PHOTOG']) {
      process.env[`HB_${v}_AUTH_TOKEN`] = 'x';
      process.env[`HB_${v}_USER_ID`] = 'x';
      process.env[`HB_${v}_TRUSTED_DEVICE`] = 'x';
      process.env[`HB_${v}_FINGERPRINT`] = 'x';
      process.env[`HB_${v}_PORTAL_ORIGIN`] = `https://${v.toLowerCase()}.hbportal.co`;
    }
    const result = await listVendors();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([
      { slug: 'silk_veil', label: 'Silk Veil Events' },
      { slug: 'photog', label: 'photog' },
    ]);
  });

  it('returns empty array when no vendors configured', async () => {
    const result = await listVendors();
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
