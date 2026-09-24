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

interface ContractFile {
  _id: string;
  file_title?: string;
  file_type?: string;
  is_file_accepted?: boolean;
  workspace?: { _id?: string };
  status_name?: string;
}

export async function signContract(
  args: {
    file_id: string;
    origin?: string;
    confirmToken?: string;
  },
  ctx: ServerContext
): Promise<ToolResult | InputRequiredResult> {
  const client = await getActiveClient(args.origin);
  const file = await client.request<ContractFile>(
    'GET',
    apiPath`/api/v2/workspace_files/${args.file_id}`
  );
  if (file.file_type !== 'agreement') {
    throw new Error(
      `File ${args.file_id} is not an agreement (file_type=${file.file_type}). Only contracts can be signed.`
    );
  }
  if (file.is_file_accepted) {
    throw new Error(`Contract ${args.file_id} ("${file.file_title}") is already signed.`);
  }
  const preview = {
    file_id: file._id,
    file_title: file.file_title,
    status: file.status_name || 'not signed',
  };
  const gate = await requireConfirmationWithFallback(
    ctx,
    confirmationFromEnv({
      action: 'contract.sign',
      message: 'Review and confirm signing this contract:',
      details: preview,
      tool: 'sign_contract',
      account: client.scope.portalOrigin,
      confirmToken: args.confirmToken,
      subject: () => ({
        target: String(file._id),
        payload: { file_id: file._id, file_title: file.file_title },
        preview,
      }),
    })
  );
  if (gate) return gate;
  // Re-checked here, not only at capture: a sessions.json written before the
  // host rule existed can still hold a foreign origin (fleet-audit#139).
  vendorPortalSubdomain(client.scope.portalOrigin);
  const url = `${client.scope.portalOrigin}/app/workspace_file/${encodeURIComponent(String(file._id))}/agreement`;
  return rawTextResult(
    `HoneyBook's signing flow requires a browser signature that this MCP cannot replay headlessly yet.\n\n` +
      `Open this link to sign the contract in your HoneyBook portal:\n\n${url}\n\n` +
      `(If you'd like the MCP to sign directly in a future version, sign one contract while running a network capture — see docs/risks.md.)`
  );
}

export function registerContractTools(server: McpServer): void {
  server.registerTool(
    'sign_contract',
    {
      description:
        'Sign a contract you received from a vendor. In v1 this returns a deep link to the HoneyBook portal instead of signing headlessly. ' +
        'Asks the user to confirm first: a confirmation prompt where the client supports one; otherwise the first call returns a preview and a confirmToken, and only a repeat call with that token proceeds (see MCP_CONFIRM_MODE).',
      inputSchema: z.object({
        file_id: z
          .string()
          .describe('The agreement file _id from list_workspace_files (file_type=agreement).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
        confirmToken: confirmTokenParam,
      }),
      annotations: { destructiveHint: true },
    },
    signContract
  );
}
