/**
 * Standard MCP tool return type. All tool handlers return a single text block.
 */
export type ToolResult = { content: [{ type: 'text'; text: string }] };

/**
 * Paginated list envelope returned by HoneyBook v2 list endpoints
 * (e.g. GET /api/v2/users/{uid}/workspace_files).
 */
export interface HBListEnvelope<T> {
  data: T[];
  cur_page: number | null;
  last_page: boolean;
  last_id?: string | null;
  total_count?: number;
}

/**
 * Per-vendor auth scope loaded from HB_<SLUG>_* env vars.
 * One of these per entry in HONEYBOOK_VENDORS.
 */
export interface VendorScope {
  slug: string;
  label: string;
  authToken: string;
  userId: string;
  trustedDevice: string;
  fingerprint: string;
  /** The vendor's branded portal origin, e.g. https://thesilkveileventsbyivy.hbportal.co */
  portalOrigin: string;
}

/**
 * Known file types. HoneyBook uses many; these are the ones this MCP cares about.
 */
export const FILE_TYPES = ['agreement', 'invoice', 'brochure', 'proposal'] as const;
export type FileType = (typeof FILE_TYPES)[number];
