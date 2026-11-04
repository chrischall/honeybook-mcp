/**
 * Project labels: `list_payments`' `workspace_id` as the person's own project
 * names (mcp-host context groups, spec D5: a subject is an enum of LABELS,
 * label-or-id accepted).
 *
 * At start the server lists the projects of every captured portal session once
 * (`loadProjectDirectory`), bounded so a host listing tools never waits on it.
 * A listing that fails — no session yet, a lapsed one, HoneyBook down, or past
 * the deadline — or that finds nothing publishes the property with no `enum`
 * (never an empty one, which is invalid JSON Schema), and the tool works by
 * workspace id as before.
 */
import { McpToolError } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import { sessionStore, vendorPortalSubdomain } from '../sessions.js';

/** One project as listed: its name, its workspace, and the portal it lives on. */
export interface ProjectRow {
  label: string;
  workspace_id: string;
  origin: string;
}

export interface ResolvedWorkspace {
  workspace_id: string;
  /** The portal the project was listed from; absent for a raw id passed through. */
  origin?: string;
}

export interface ProjectDirectory {
  /** One label per project, in listing order; never empty. */
  labels: string[];
  /**
   * A label (any case, trimmed) → that project's workspace and portal. A
   * workspace id passes through (with its portal when it was listed), so a
   * project booked after start is still reachable. Anything else is refused,
   * naming the labels.
   */
  resolve(value: string): ResolvedWorkspace;
}

/** What `registrars` are handed by `runMcp`. */
export interface HoneyBookDeps {
  projects?: ProjectDirectory | null;
}

/** Bound on the start-time listing: a host must not wait on it to list tools. */
export const PROJECT_LIST_TIMEOUT_MS = 5_000;

/** HoneyBook ids are Mongo ObjectIds; a project's name never looks like one. */
const WORKSPACE_ID = /^[0-9a-f]{24}$/i;

const normal = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function vendorOf(origin: string): string {
  try {
    return vendorPortalSubdomain(origin);
  } catch {
    return origin;
  }
}

export function buildProjectDirectory(rows: ProjectRow[]): ProjectDirectory | null {
  if (rows.length === 0) return null;
  const countBy = (key: (r: ProjectRow) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return m;
  };
  const byName = countBy((r) => normal(r.label));
  const byNameVendor = countBy((r) => `${normal(r.label)}\u0000${vendorOf(r.origin)}`);
  // A name two projects share carries the vendor; one a vendor repeats also
  // carries the id, so every label names exactly one project.
  const labelled = rows.map((r) => {
    if (byName.get(normal(r.label))! === 1) return { ...r };
    const vendor = vendorOf(r.origin);
    const sameVendor = byNameVendor.get(`${normal(r.label)}\u0000${vendor}`)! > 1;
    return { ...r, label: sameVendor ? `${r.label} (${vendor}, ${r.workspace_id})` : `${r.label} (${vendor})` };
  });
  const labels = labelled.map((r) => r.label);
  return {
    labels,
    resolve(value: string): ResolvedWorkspace {
      const ref = value.trim();
      const hit =
        labelled.find((r) => normal(r.label) === normal(ref)) ?? labelled.find((r) => r.workspace_id === ref);
      if (hit) return { workspace_id: hit.workspace_id, origin: hit.origin };
      if (WORKSPACE_ID.test(ref)) return { workspace_id: ref };
      throw new McpToolError(`No HoneyBook project named "${value}". Known projects: ${labels.join(', ')}.`, {
        hint: 'Use one of those names, or a workspace_id from list_projects.',
      });
    },
  };
}

interface ClientEventsPage {
  data?: Array<Record<string, unknown>>;
  last_page?: boolean;
  total_pages?: number;
}

/** Every project of every captured portal session (each vendor is one session). */
export async function listAllProjects(): Promise<ProjectRow[]> {
  const rows: ProjectRow[] = [];
  for (const session of sessionStore.list()) {
    const client = await getActiveClient(session.portalOrigin);
    for (let page = 1; page <= 20; page++) {
      const res = await client.request<ClientEventsPage>(
        'GET',
        page === 1 ? '/api/v2/client/events' : `/api/v2/client/events?page=${page}`,
      );
      for (const e of res?.data ?? []) {
        if (typeof e.workspace_id !== 'string' || e.workspace_id === '') continue;
        const name = typeof e.event_name === 'string' && e.event_name.trim() !== '' ? e.event_name.trim() : e.workspace_id;
        rows.push({ label: name, workspace_id: e.workspace_id, origin: session.portalOrigin });
      }
      if (res?.last_page !== false || (res.total_pages !== undefined && page >= res.total_pages)) break;
    }
  }
  return rows;
}

/**
 * List the projects ONCE, at server start, for the `workspace_id` enum. Answers
 * null when there are none, when the listing fails, or when it has not
 * answered within `timeoutMs`. Never throws.
 */
export async function loadProjectDirectory(
  list: () => Promise<ProjectRow[]> = listAllProjects,
  timeoutMs: number = PROJECT_LIST_TIMEOUT_MS,
): Promise<ProjectDirectory | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref();
  });
  const listing = Promise.resolve()
    .then(list)
    .then(buildProjectDirectory)
    .catch(() => null);
  try {
    return await Promise.race([listing, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
