import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult } from '@chrischall/mcp-utils';
import { captureFlowCredentialViaFetchproxy } from '../flow-auth.js';
import { getActiveFlowClient } from '../flow-client.js';
import type { ToolResult } from '../types.js';

/**
 * Capture (or refresh) the weak-auth credential a questionnaire ("flow") link
 * writes into the browser.
 *
 * The link is used only to derive the flow id and the auth hash; nothing here
 * navigates to it. As with `use_magic_link`, the user must already have opened
 * it in the browser holding the fetchproxy extension.
 */
export async function useFlowLink(args: { flow_link_url: string }): Promise<ToolResult> {
  const credential = await captureFlowCredentialViaFetchproxy({ flowLinkUrl: args.flow_link_url });
  return textResult({
    ok: true,
    kind: 'flow-credential',
    flowId: credential.flowId,
    portalOrigin: credential.portalOrigin,
    companyName: credential.companyName,
    // The identity the credential carries, so the caller can see WHOSE
    // questionnaire it is. The hash itself is never returned.
    email: credential.email ?? null,
    capturedAt: new Date(credential.capturedAt).toISOString(),
  });
}

/**
 * Read one questionnaire.
 *
 * `GET /api/v2/flow/{flowId}/active` is the call the questionnaire page itself
 * makes to render (`_fetchFlow` in the shipped flow app). It is the only read
 * path a flow credential has: the other `/api/v2/flow/{id}/…` routes in that
 * bundle are writes (`submit`, `answer_question`, `select_service`,
 * `sign_contract`, the payment routes), and none of them are exposed here.
 */
export async function getFlow(args: { flow_id?: string }): Promise<ToolResult> {
  const client = await getActiveFlowClient(args.flow_id);
  const flow = await client.request(
    'GET',
    `/api/v2/flow/${encodeURIComponent(client.credential.flowId)}/active`
  );
  return textResult({
    flowId: client.credential.flowId,
    portalOrigin: client.credential.portalOrigin,
    flow,
  });
}

export function registerFlowTools(server: McpServer): void {
  server.registerTool(
    'use_flow_link',
    {
      description:
        "Capture a HoneyBook QUESTIONNAIRE (flow) credential via the fetchproxy browser extension. Use this for a link shaped https://<vendor>.hbportal.co/flow/<flowId>?hash=… — for a client-portal link (/app/link/resolve/…) use `use_magic_link` instead. Prerequisites: install the fetchproxy extension, open the questionnaire link in that browser and let the page render, then run this tool. It snapshots localStorage[\"HONEYBOOK_REACT_WEAK_AUTH_<flowId>\"] into ~/.honeybook-mcp/flows.json. A flow credential is HoneyBook's 'weak auth': it is scoped to that ONE questionnaire and cannot read portal workspaces, files, invoices or payment methods. Because the storage key contains the flow id, the extension asks you to re-approve the scope once per new questionnaire.",
      inputSchema: {
        flow_link_url: z
          .string()
          .url()
          .describe(
            'Full questionnaire link from the vendor email, e.g. https://<vendor>.hbportal.co/flow/<flowId>?hash=…&userId=… The ?hash= parameter is the credential, so use the original link rather than the URL the page rewrites to.'
          ),
      },
      annotations: { readOnlyHint: false },
    },
    useFlowLink
  );

  server.registerTool(
    'get_flow',
    {
      description:
        'Read a HoneyBook questionnaire (flow) — its pages, questions and any answers already submitted — using a credential captured by `use_flow_link`. Requires a flow credential; a client-portal session will NOT work here, and vice versa. Defaults to the most recently captured flow.',
      inputSchema: {
        flow_id: z
          .string()
          .optional()
          .describe(
            'Flow id to read. Omit to use the most recently captured flow credential. Run `list_active_sessions` to see the active flow ids.'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    getFlow
  );
}
