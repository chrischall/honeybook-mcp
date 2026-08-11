import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Standard MCP tool return type. Aliased to the SDK's `CallToolResult` so
 * handlers can return the shared `@chrischall/mcp-utils` formatters
 * (`textResult`, `rawTextResult`) directly. All tool handlers still emit a
 * single text block.
 */
export type ToolResult = CallToolResult;

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
 * Auth session captured from a vendor's signed-in portal tab via
 * `@fetchproxy/bootstrap` (v3+; v2 used embedded Puppeteer).
 *
 * A `type` (not an `interface`) so it structurally satisfies the shared
 * SessionStore's `T extends Record<string, unknown>` constraint.
 */
export type CapturedSession = {
  /** Full origin of the vendor's branded portal (e.g. `https://thesilkveileventsbyivy.hbportal.co`). */
  portalOrigin: string;
  /**
   * Company name as reported by HONEYBOOK_REACT_CURR_USER.company.company_name.
   * Display only — `company` is null on a client-side portal user, so this
   * usually falls back to the portal subdomain.
   */
  companyName: string;
  authToken: string;
  userId: string;
  /**
   * `hb-trusted-device`. Optional: the API returns 200 without it, and the
   * value moved between storage keys once already. Sent when present.
   */
  trustedDevice?: string;
  /**
   * `hb-api-fingerprint`. No longer captured — the API accepts requests
   * without it. Retained so sessions persisted by <=0.4.4 keep working, and
   * still sent when a stored session carries one.
   */
  fingerprint?: string;
  /** Epoch millis when this session was captured. */
  capturedAt: number;
};

/**
 * Known file types. HoneyBook uses many; these are the ones this MCP cares about.
 */
export const FILE_TYPES = ['agreement', 'invoice', 'brochure', 'proposal'] as const;
export type FileType = (typeof FILE_TYPES)[number];
