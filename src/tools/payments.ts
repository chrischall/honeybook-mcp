import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { minifiedResult, schemaOrigin } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

type Raw = Record<string, unknown>;

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * The portal's Payments tab: every payment on every file in the workspace,
 * paid or not. `/workspaces/<id>/payments` returns the files with their
 * `payments_container`; the per-payment rows are trimmed to what a client
 * reads off the page (payout bookkeeping and reminder timestamps dropped).
 */
export async function listPayments(args: { workspace_id: string; origin?: string }): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<{ workspace_files?: Raw[] } | null>(
    'GET',
    `/api/v2/workspaces/${args.workspace_id}/payments`
  );
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
  return minifiedResult({ workspace_id: args.workspace_id, totals, files });
}

export function registerPaymentTools(server: McpServer): void {
  server.registerTool(
    'list_payments',
    {
      description:
        'Payment schedule for a workspace — the portal\'s Payments tab: each file\'s payments with amount, ' +
        'due date, paid/pending state, how it was paid and the invoice number, plus paid/unpaid totals per currency. ' +
        'To pay one, use pay_invoice.',
      inputSchema: {
        workspace_id: z.string().describe('The workspace _id (from list_projects).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      },
      annotations: { readOnlyHint: true },
    },
    listPayments
  );
}
