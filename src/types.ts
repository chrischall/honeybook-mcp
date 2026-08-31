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

/**
 * The SECOND magic-link credential kind: a questionnaire ("flow") link.
 *
 * A vendor can send two different links. `/app/link/resolve/...` signs the
 * client into the whole client portal and writes
 * `HONEYBOOK_REACT_CURR_USER` — that is a {@link CapturedSession}. A
 * `/flow/<flowId>?hash=...` link opens ONE questionnaire and writes
 * `HONEYBOOK_REACT_WEAK_AUTH_<flowId>` instead: HoneyBook's own name for it
 * is **weak auth**, and it is scoped to that single flow.
 *
 * They are deliberately a different TYPE in a different store, because they
 * authorise different things:
 *
 * | | portal session | flow credential |
 * |---|---|---|
 * | storage key | `HONEYBOOK_REACT_CURR_USER` | `HONEYBOOK_REACT_WEAK_AUTH_<flowId>` |
 * | scope | every workspace the client can see | one flow |
 * | headers | `HB-Api-Auth-Token` + `HB-Api-User-Id` | `HB-Api-W-Hash` (+ `-W-User-Id` / `-W-Email`) |
 * | token | `authentication_token` | none — the URL `hash` IS the credential |
 *
 * Every row above was read out of the shipped flow app
 * (`public.honeybook.com/public_react_flow_app/<build>/main.<hash>.js`,
 * `getLimitedAuthStorageKey` / `setWeakTokenInStorage` / `getHeaders`) and the
 * header names out of `https://api.honeybook.com/api/gon`
 * (`hb_api_headers.weak_auth_*`) on 2026-08-31.
 */
export type CapturedFlowCredential = {
  /** The flow id, taken from the `/flow/<flowId>` path. The store's key. */
  flowId: string;
  /** Origin of the vendor portal the link pointed at (display + re-open help). */
  portalOrigin: string;
  /** Display label. Falls back to the portal subdomain, like a portal session's. */
  companyName: string;
  /**
   * The `?hash=` value from the link, as the page persists it. This IS the
   * credential — there is no bearer token on this path — so it is sent as
   * `HB-Api-W-Hash` and must never appear in a tool response.
   */
  hash: string;
  /** `_id` from the stored blob → `HB-Api-W-User-Id`. Absent on an anonymous flow. */
  userId?: string;
  /** `email` from the stored blob → `HB-Api-W-Email`. Absent until the client identifies. */
  email?: string;
  /**
   * `is_real_chargeable_user` from the stored blob. REPORTED by a capture and
   * by `list_active_sessions`; never sent upstream — the weak-auth headers are
   * hash, user id and email only.
   */
  isRealChargeableUser?: boolean;
  /** Epoch millis when this credential was captured. */
  capturedAt: number;
};
