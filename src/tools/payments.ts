import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { minifiedResult, schemaOrigin, UNTRUSTED_CONTENT_RULE, untrustedEnvelope } from '@chrischall/mcp-utils';
import { apiPath, getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';
import { moneyMeta } from './hints.js';
import { today } from './tasks.js';
import type { HoneyBookDeps, ProjectDirectory } from './project-labels.js';

type Raw = Record<string, unknown>;

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

const BRIEF_MAX = 120;
const BRIEF_WHO_WROTE = 'File titles and payment descriptions are written by your vendor.';

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** A due date as `YYYY-MM-DD`, or undefined when there is none to read. */
function isoDate(v: unknown): string | undefined {
  const s = text(v);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

/**
 * One payment as one line, `title — <ISO date | no date> — <status>`, at most
 * 120 characters (the title is shortened). The title is the file it is on,
 * the payment's own description and its amount; the status is `paid`,
 * `pending` (HoneyBook is still settling it), `overdue` (unpaid past its due
 * date, against `todayIso`) or `unpaid`. A title starting with `-- ` or `\` is
 * escaped with one leading `\`, so a vendor's file title can never read as a
 * note line (the gateway strips that one backslash after its note check).
 */
export function briefPaymentLine(file: Raw, payment: Raw, todayIso: string = today()): string {
  const fileTitle = text(file.file_title);
  const description = text(payment.count_description) ?? text(payment.description);
  const amount = num(payment.amount) ?? num(payment.grand_total);
  const currency = text(file.currency);
  let title = [fileTitle, description].filter(Boolean).join(': ') || '(untitled)';
  if (amount !== undefined) title += ` (${amount}${currency ? ` ${currency}` : ''})`;
  if (title.startsWith('-- ') || title.startsWith('\\')) title = `\\${title}`;
  const due = isoDate(payment.due_date);
  const status = payment.is_paid
    ? 'paid'
    : payment.is_pending
      ? 'pending'
      : due !== undefined && due < todayIso
        ? 'overdue'
        : 'unpaid';
  const tail = ` — ${due ?? 'no date'} — ${status}`;
  const room = BRIEF_MAX - tail.length;
  const shown = title.length > room ? `${title.slice(0, Math.max(room - 1, 0))}…` : title;
  return `${shown}${tail}`;
}

/**
 * The portal's Payments tab: every payment on every file in the workspace,
 * paid or not. `/workspaces/<id>/payments` returns the files with their
 * `payments_container`; the per-payment rows are trimmed to what a client
 * reads off the page (payout bookkeeping and reminder timestamps dropped).
 */
export async function listPayments(
  args: { workspace_id: string; origin?: string; view?: 'full' | 'brief' },
  projects?: ProjectDirectory | null
): Promise<ToolResult> {
  // A project label (from the enum published at start) names its workspace
  // and its portal; an explicit origin still wins.
  const target = projects ? projects.resolve(args.workspace_id) : { workspace_id: args.workspace_id };
  const workspaceId = target.workspace_id;
  const client = await getActiveClient(args.origin ?? target.origin);
  const res = await client.request<{ workspace_files?: Raw[] } | null>(
    'GET',
    apiPath`/api/v2/workspaces/${workspaceId}/payments`
  );
  if (args.view === 'brief') {
    const todayIso = today();
    const lines = (res?.workspace_files ?? []).flatMap((f) => {
      const container = (f.payments_container ?? null) as Raw | null;
      const payments = Array.isArray(container?.payments) ? (container!.payments as Raw[]) : [];
      return payments.map((p) => briefPaymentLine(f, p, todayIso));
    });
    // File titles and payment descriptions are the vendor's text, so the lines
    // ride the fleet's untrusted-data envelope as `data: string[]`.
    return minifiedResult(
      untrustedEnvelope(lines.length > 0 ? lines : ['-- none'], { note: `${BRIEF_WHO_WROTE} ${UNTRUSTED_CONTENT_RULE}` })
    );
  }
  // Totals are kept PER CURRENCY: each file names its own, and a workspace
  // can mix them, so one bare number would be in no currency at all.
  const totals: Record<string, { paid: number; unpaid: number }> = {};
  const files = (res?.workspace_files ?? []).map((f) => {
    const container = (f.payments_container ?? null) as Raw | null;
    const currency = typeof f.currency === 'string' && f.currency ? f.currency : 'unknown';
    const payments = (Array.isArray(container?.payments) ? (container!.payments as Raw[]) : []).map((p) => {
      const amount = num(p.amount) ?? num(p.grand_total) ?? 0;
      const t = (totals[currency] ??= { paid: 0, unpaid: 0 });
      if (p.is_paid) t.paid += amount;
      else t.unpaid += amount;
      return {
        _id: p._id,
        description: p.count_description ?? null,
        amount: p.amount ?? null,
        grand_total: p.grand_total ?? null,
        tip_paid: p.tip_paid ?? null,
        due_date: p.due_date ?? null,
        is_paid: p.is_paid ?? null,
        is_pending: p.is_pending ?? null,
        charge_date: p.charge_date ?? null,
        charge_description: p.charge_description ?? null,
        invoice: p.invoice ?? null,
      };
    });
    return {
      file_id: f._id,
      file_title: f.file_title,
      file_type: f.file_type,
      status: f.status,
      currency: f.currency,
      has_pending_payment: f.has_pending_payment ?? null,
      unpaid_payments_left: container?.unpaid_payments_left ?? null,
      payments,
    };
  });
  return minifiedResult({ workspace_id: workspaceId, totals, files });
}

const WORKSPACE_DESC = 'The workspace _id (from list_projects).';

/**
 * `workspace_id` publishes the project LABELS as a JSON Schema `enum` when the
 * server could list them at start, via `.meta()`. With no listing the property
 * is published plain: an empty `enum` is invalid JSON Schema.
 *
 * The enum holds the NAMES only, each project once — the gateway reads a
 * top-level `enum` and nothing else, and adding the ids would make a host that
 * fans out over the enum's values read every project twice. So the schema
 * contract is the names, and that is what the description says. The server
 * stays lenient underneath: the runtime schema is still any string, and the
 * handler resolves a workspace _id from list_projects through
 * `ProjectDirectory.resolve`, so a caller that does not validate against the
 * schema may still send the raw id.
 */
function workspaceIdArg(projects: ProjectDirectory | null | undefined) {
  if (!projects) return z.string().describe(WORKSPACE_DESC);
  return z
    .string()
    .describe(
      'The project, by name as listed here. The server also resolves a workspace _id from list_projects, ' +
        'but this schema offers the names only.'
    )
    .meta({ enum: projects.labels });
}

export function registerPaymentTools(server: McpServer, deps: HoneyBookDeps = {}): void {
  const projects = deps.projects ?? null;
  server.registerTool(
    'list_payments',
    {
      description:
        'Payment schedule for a workspace — the portal\'s Payments tab: each file\'s payments with amount, ' +
        'due date, paid/pending state, how it was paid and the invoice number, plus paid/unpaid totals per currency. ' +
        'To pay one, use pay_invoice.',
      inputSchema: z.object({
        workspace_id: workspaceIdArg(projects),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active, or when workspace_id is a listed project name.'
        ),
        view: z
          .enum(['full', 'brief'])
          .optional()
          .describe(
            '"full" (default): the files, payments and per-currency totals. "brief": one line per payment — ' +
              'file: description (amount) — due <ISO date or "no date"> — <paid|pending|overdue|unpaid>, ' +
              'inside the untrusted-data envelope as data: string[]; "-- none" when there is no payment.'
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: moneyMeta('whats-due', {
        canonical: true,
        subject: 'workspace_id',
        aliases: ['payments', 'payment due', 'what do i owe', 'deposit', 'balance due', 'installment', 'vendor bill'],
      }),
    },
    (args) => listPayments(args, projects)
  );
}
