import type { InputRequiredResult, McpServer, ServerContext } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  confirmationFromEnv,
  confirmTokenParam,
  rawTextResult,
  requireConfirmationWithFallback,
  schemaOrigin,
} from '@chrischall/mcp-utils';
import { apiPath, getActiveClient } from '../client.js';
import { vendorPortalSubdomain } from '../sessions.js';
import type { ToolResult } from '../types.js';

interface InvoiceFile {
  _id: string;
  file_title?: string;
  file_type?: string;
  has_pending_payment?: boolean;
  status_name?: string;
}

export async function payInvoice(
  args: {
    file_id: string;
    origin?: string;
    confirmToken?: string;
  },
  ctx: ServerContext
): Promise<ToolResult | InputRequiredResult> {
  const client = await getActiveClient(args.origin);
  const file = await client.request<InvoiceFile>('GET', apiPath`/api/v2/workspace_files/${args.file_id}`);
  if (file.file_type !== 'invoice') {
    throw new Error(
      `File ${args.file_id} is not an invoice (file_type=${file.file_type}). Only invoices can be paid.`
    );
  }
  const preview = {
    file_id: file._id,
    file_title: file.file_title,
    status: file.status_name || 'open',
    has_pending_payment: Boolean(file.has_pending_payment),
  };
  const gate = await requireConfirmationWithFallback(
    ctx,
    confirmationFromEnv({
      action: 'invoice.pay',
      message: 'Review and confirm paying this invoice:',
      details: preview,
      tool: 'pay_invoice',
      account: client.scope.portalOrigin,
      confirmToken: args.confirmToken,
      subject: () => ({
        target: String(file._id),
        payload: { file_id: file._id, file_title: file.file_title, has_pending_payment: preview.has_pending_payment },
        preview,
      }),
    })
  );
  if (gate) return gate;
  // Re-checked here, not only at capture: a sessions.json written before the
  // host rule existed can still hold a foreign origin (fleet-audit#139).
  vendorPortalSubdomain(client.scope.portalOrigin);
  const url = `${client.scope.portalOrigin}/app/workspace_file/${encodeURIComponent(String(file._id))}/invoice`;
  const pendingNote = file.has_pending_payment
    ? '\n\nNote: this invoice already has a pending payment — check the status before re-paying.'
    : '';
  return rawTextResult(
    `HoneyBook's payment flow requires browser-side card/SCA handling that this MCP cannot replay headlessly yet.\n\n` +
      `Open this link to pay the invoice in your HoneyBook portal:\n\n${url}${pendingNote}`
  );
}

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool(
    'pay_invoice',
    {
      description:
        'Pay an invoice from a vendor. In v1 this returns a deep link to the HoneyBook portal instead of paying headlessly. ' +
        'Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE).',
      inputSchema: z.object({
        file_id: z
          .string()
          .describe('The invoice file _id from list_workspace_files (file_type=invoice).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
        confirmToken: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
    },
    payInvoice
  );
}
