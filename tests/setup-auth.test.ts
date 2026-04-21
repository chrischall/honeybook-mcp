import { describe, it, expect } from 'vitest';
import {
  slugify,
  mergeEnvForVendor,
  parseExistingVendors,
} from '../scripts/setup-auth.mjs';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with underscores', () => {
    expect(slugify('The Silk Veil Events by Ivy LLC')).toBe('the_silk_veil_events_by_ivy_llc');
    expect(slugify('Joe & Jane Photography!')).toBe('joe_jane_photography');
    expect(slugify('  double  spaces  ')).toBe('double_spaces');
  });
});

describe('parseExistingVendors', () => {
  it('extracts comma-separated slugs from an env body', () => {
    const env = 'HONEYBOOK_VENDORS=a,b,c\nOTHER=x';
    expect(parseExistingVendors(env)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] when HONEYBOOK_VENDORS is missing', () => {
    expect(parseExistingVendors('FOO=bar')).toEqual([]);
  });
});

describe('mergeEnvForVendor', () => {
  it('appends new HB_<SLUG>_* block and adds slug to HONEYBOOK_VENDORS', () => {
    const env = 'HONEYBOOK_VENDORS=existing\nHB_EXISTING_AUTH_TOKEN=x\n';
    const merged = mergeEnvForVendor(env, {
      slug: 'photog',
      label: 'Acme Photography',
      authToken: 't',
      userId: 'u',
      trustedDevice: 'd',
      fingerprint: 'f',
      portalOrigin: 'https://acme.hbportal.co',
    });
    expect(merged).toContain('HONEYBOOK_VENDORS=existing,photog');
    expect(merged).toContain('HB_PHOTOG_AUTH_TOKEN=t');
    expect(merged).toContain('HB_PHOTOG_LABEL=Acme Photography');
    expect(merged).toContain('HB_PHOTOG_PORTAL_ORIGIN=https://acme.hbportal.co');
  });

  it('replaces existing block when the slug already exists', () => {
    const env =
      'HONEYBOOK_VENDORS=photog\nHB_PHOTOG_LABEL=Old Label\nHB_PHOTOG_PORTAL_ORIGIN=https://old.hbportal.co\nHB_PHOTOG_AUTH_TOKEN=old\nHB_PHOTOG_USER_ID=u\nHB_PHOTOG_TRUSTED_DEVICE=d\nHB_PHOTOG_FINGERPRINT=f\n';
    const merged = mergeEnvForVendor(env, {
      slug: 'photog',
      label: 'New Label',
      authToken: 'new',
      userId: 'u2',
      trustedDevice: 'd2',
      fingerprint: 'f2',
      portalOrigin: 'https://new.hbportal.co',
    });
    expect(merged).toContain('HB_PHOTOG_AUTH_TOKEN=new');
    expect(merged).toContain('HB_PHOTOG_LABEL=New Label');
    expect(merged).toContain('HB_PHOTOG_PORTAL_ORIGIN=https://new.hbportal.co');
    expect(merged).not.toContain('HB_PHOTOG_AUTH_TOKEN=old');
    expect(merged).not.toContain('HB_PHOTOG_PORTAL_ORIGIN=https://old.hbportal.co');
    const vendorsLine = merged.split('\n').find((l) => l.startsWith('HONEYBOOK_VENDORS='))!;
    expect(vendorsLine).toBe('HONEYBOOK_VENDORS=photog');
  });

  it('creates the HONEYBOOK_VENDORS line when the file is empty', () => {
    const merged = mergeEnvForVendor('', {
      slug: 'photog',
      label: 'Acme',
      authToken: 't',
      userId: 'u',
      trustedDevice: 'd',
      fingerprint: 'f',
      portalOrigin: 'https://acme.hbportal.co',
    });
    expect(merged).toMatch(/^HONEYBOOK_VENDORS=photog\n/m);
  });
});
