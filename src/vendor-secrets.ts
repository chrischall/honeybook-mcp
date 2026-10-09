/**
 * Fields that are the VENDOR's credentials, never a client's business. The
 * known carrier is `calendar_item.video_meeting_host_link` (a Zoom host link
 * with a `zak` token).
 *
 * Applied in two places: `hbApiRequest` scrubs every parsed API response, so
 * no tool — raw views and passthrough lists included — can hand one to the
 * model (fleet-audit#505); and the feed summarizers scrub again, so the
 * property does not depend on which path a payload took.
 */
export const VENDOR_SECRET_KEYS = new Set([
  'video_meeting_host_link',
  'video_meeting_host_url',
  'host_link',
  'zak',
]);

/** Deep-copy `v` with every {@link VENDOR_SECRET_KEYS} key removed. */
export function scrubVendorSecrets<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrubVendorSecrets) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (VENDOR_SECRET_KEYS.has(k)) continue;
      out[k] = scrubVendorSecrets(val);
    }
    return out as T;
  }
  return v;
}
