import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { ToolResult } from '../types.js';

interface InvoiceFile {
  _id: string;
  file_title?: string;
  file_type?: string;
  has_pending_payment?: boolean;
  status_name?: string;
}

export async function payInvoice(args: {
  file_id: string;
  vendor?: string;
  confirm?: boolean;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const file = await client.request<InvoiceFile>('GET', `/api/v2/workspace_files/${args.file_id}`);
  if (file.file_type !== 'invoice') {
    throw new Error(
      `File ${args.file_id} is not an invoice (file_type=${file.file_type}). Only invoices can be paid.`
    );
  }
  if (!args.confirm) {
    return {
      content: [
        {
          type: 'text',
          text:
            `About to pay "${file.file_title}" (${file.status_name || 'open'}).\n` +
            `Re-run pay_invoice with { confirm: true } to proceed.`,
        },
      ],
    };
  }
  const url = `${client.scope.portalOrigin}/app/workspace_file/${file._id}/invoice`;
  const pendingNote = file.has_pending_payment
    ? '\n\nNote: this invoice already has a pending payment — check the status before re-paying.'
    : '';
  return {
    content: [
      {
        type: 'text',
        text:
          `HoneyBook's payment flow requires browser-side card/SCA handling that this MCP cannot replay headlessly yet.\n\n` +
          `Open this link to pay the invoice in your HoneyBook portal:\n\n${url}${pendingNote}`,
      },
    ],
  };
}

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool(
    'pay_invoice',
    {
      description:
        'Pay an invoice from a vendor. In v1 this returns a deep link to the HoneyBook portal instead of paying headlessly. Requires confirm:true.',
      inputSchema: {
        file_id: z.string().describe('The invoice file _id from list_workspace_files (file_type=invoice).'),
        vendor: z.string().optional().describe('Vendor slug.'),
        confirm: z.boolean().optional().describe('Must be true to proceed. Without this, tool returns a preview.'),
      },
      annotations: { destructiveHint: true },
    },
    payInvoice
  );
}
