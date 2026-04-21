import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { ToolResult } from '../types.js';

interface ContractFile {
  _id: string;
  file_title?: string;
  file_type?: string;
  is_file_accepted?: boolean;
  workspace?: { _id?: string };
  status_name?: string;
}

export async function signContract(args: {
  file_id: string;
  vendor?: string;
  confirm?: boolean;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const file = await client.request<ContractFile>(
    'GET',
    `/api/v2/workspace_files/${args.file_id}`
  );
  if (file.file_type !== 'agreement') {
    throw new Error(
      `File ${args.file_id} is not an agreement (file_type=${file.file_type}). Only contracts can be signed.`
    );
  }
  if (file.is_file_accepted) {
    throw new Error(`Contract ${args.file_id} ("${file.file_title}") is already signed.`);
  }
  if (!args.confirm) {
    return {
      content: [
        {
          type: 'text',
          text:
            `About to sign "${file.file_title}" (${file.status_name || 'not signed'}).\n` +
            `Re-run sign_contract with { confirm: true } to proceed.`,
        },
      ],
    };
  }
  const url = `${client.scope.portalOrigin}/app/workspace_file/${file._id}/agreement`;
  return {
    content: [
      {
        type: 'text',
        text:
          `HoneyBook's signing flow requires a browser signature that this MCP cannot replay headlessly yet.\n\n` +
          `Open this link to sign the contract in your HoneyBook portal:\n\n${url}\n\n` +
          `(If you'd like the MCP to sign directly in a future version, sign one contract while running a network capture — see docs/risks.md.)`,
      },
    ],
  };
}

export function registerContractTools(server: McpServer): void {
  server.registerTool(
    'sign_contract',
    {
      description:
        'Sign a contract you received from a vendor. In v1 this returns a deep link to the HoneyBook portal instead of signing headlessly. Requires confirm:true.',
      inputSchema: {
        file_id: z.string().describe('The agreement file _id from list_workspace_files (file_type=agreement).'),
        vendor: z.string().optional().describe('Vendor slug.'),
        confirm: z.boolean().optional().describe('Must be true to proceed. Without this, tool returns a preview.'),
      },
      annotations: { destructiveHint: true },
    },
    signContract
  );
}
