import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult } from '@chrischall/mcp-utils';
import { captureFlowCredentialViaFetchproxy } from '../flow-auth.js';
import { fetchFlowMinimal, flowContextId, getActiveFlowClient } from '../flow-client.js';
import type { CapturedFlowCredential, ToolResult } from '../types.js';

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
  return flowCaptureResult(credential);
}

/**
 * What a capture reports back. Pure, so the shape is testable without driving
 * the browser — and so the "never return the hash" rule has one place to hold.
 */
export function flowCaptureResult(credential: CapturedFlowCredential): ToolResult {
  return textResult({
    ok: true,
    kind: 'flow-credential',
    flowId: credential.flowId,
    portalOrigin: credential.portalOrigin,
    companyName: credential.companyName,
    // The identity the credential carries, so the caller can see WHOSE
    // questionnaire it is. The hash itself is never returned. Expect `null`:
    // the one live blob measured held only `_id` and `hash`.
    email: credential.email ?? null,
    // Captured from the stored blob, so report it: a credential field nothing
    // consumes is a claim the code does not keep. `null` rather than omitted
    // when the blob carried none, so "anonymous flow" and "not chargeable" are
    // distinguishable instead of both reading as absent — and `null` IS the
    // ordinary case, since the measured blob carried neither this nor `email`.
    isRealChargeableUser: credential.isRealChargeableUser ?? null,
    capturedAt: new Date(credential.capturedAt).toISOString(),
  });
}

/**
 * Byte ceiling on the default `get_flow` response.
 *
 * A questionnaire is the same class of object as a workspace file, and
 * `pruneWorkspaceFile` exists because a real proposal measured ~1.3 MB. A real
 * `/active` payload has since been measured — 96,246 bytes on 2026-08-31 — so
 * this ceiling is now calibrated against a measurement rather than a guess, and
 * the ordinary case passes it with room to spare. One measurement is a size and
 * not a schema, though, so pruning by FIELD is still not done: the guard stays
 * schema-agnostic, bounding BYTES and naming the top-level keys, and knows
 * nothing about what a flow contains.
 */
const MAX_FLOW_BYTES = 200_000;

/**
 * Read one questionnaire. TWO calls, not one.
 *
 * The read the questionnaire page actually makes is
 *
 *     GET /api/v2/client/flow/<flowId>/active?ctxc=<companyId>
 *
 * and both of the parts that are not `/flow/<id>/active` are invisible in the
 * app's own adapter, which is why the first version of this tool got them
 * wrong. `_fetchFlow` composes `/api/v2/flow/<id>/active`; the shared request
 * interceptor one layer below then rewrites the path
 * (`addClientToUrl(u) => u.replace('/api/v2/', '/api/v2/client/')`) and sets
 * `params.ctxc` from `clientPortalConfigStore.clientPortalCompanyId`. Nor is
 * the difference visible by probing: BOTH paths answer 404 +
 * `HBUnauthorizedError` without a credential, so only a real 200 tells them
 * apart. A HAR of the live questionnaire did (2026-08-31).
 *
 * So step one asks the PUBLIC `/minimal` route for that company id, and step
 * two is the authenticated read. Still the only read path a flow credential
 * has: the other `/api/v2/…/flow/{id}/…` routes in that bundle are writes
 * (`submit`, `answer_question`, `select_service`, `sign_contract`, `auth`, the
 * payment routes), and none of them are exposed here.
 */
export async function getFlow(args: { flow_id?: string; section?: 'summary' | 'raw' }): Promise<ToolResult> {
  const client = await getActiveFlowClient(args.flow_id);
  const flowId = client.credential.flowId;

  const minimal = await fetchFlowMinimal(flowId, {
    ...(client.credential.userId ? { userId: client.credential.userId } : {}),
    apiVersion: client.getApiVersion(),
  });
  const contextId = flowContextId(minimal);
  // Refuse rather than calling /active without it. A missing ctxc produces the
  // same bare 400 as a stale client version, and a 400 here reads as an auth
  // failure — so falling through would send someone to re-capture a credential
  // that is perfectly good.
  if (!contextId) {
    throw new Error(
      `HoneyBook flow: no context id for flow ${flowId}. The questionnaire read requires ` +
        '`ctxc`, the vendor company id, and GET /api/v2/flow/<flowId>/minimal did not carry one ' +
        'at branding_data.company_id. Calling /active without it answers a bare 400 that reads ' +
        'like an auth failure, so this stops here: it is not an auth problem and re-running ' +
        '`use_flow_link` will not help.'
    );
  }

  const query = new URLSearchParams({ ctxc: contextId });
  const flow = await client.request(
    'GET',
    `/api/v2/client/flow/${encodeURIComponent(flowId)}/active?${query}`
  );
  const head = {
    flowId,
    portalOrigin: client.credential.portalOrigin,
    // Reported because it is a second input the read depends on: when this call
    // fails, knowing which company id was used is half the diagnosis.
    contextId,
  };
  if (args.section === 'raw') return textResult({ ...head, flow });

  const bytes = Buffer.byteLength(JSON.stringify(flow ?? null), 'utf8');
  if (bytes <= MAX_FLOW_BYTES) return textResult({ ...head, flow });
  // The keys are the navigational half: a caller has to be able to learn what
  // IS in there without being handed the whole thing to find out.
  return textResult({
    ...head,
    truncated: {
      bytes,
      limit: MAX_FLOW_BYTES,
      topLevelKeys:
        flow && typeof flow === 'object' && !Array.isArray(flow) ? Object.keys(flow).sort() : [],
      hint: 'This questionnaire is larger than the default ceiling. Call get_flow again with section="raw" for the full payload (may exceed MCP size limits).',
    },
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
        'Read a HoneyBook questionnaire (flow) — its pages, questions and any answers already submitted — using a credential captured by `use_flow_link`. Requires a flow credential; a client-portal session will NOT work here, and vice versa. Defaults to the most recently captured flow. Makes two calls: the public /api/v2/flow/<id>/minimal for the vendor company id, then /api/v2/client/flow/<id>/active?ctxc=<companyId>. A questionnaire larger than the default ceiling answers with its size and top-level keys instead; call again with section="raw" for the whole thing.',
      inputSchema: {
        flow_id: z
          .string()
          .optional()
          .describe(
            'Flow id to read. Omit to use the most recently captured flow credential. Run `list_active_sessions` to see the active flow ids.'
          ),
        section: z
          .enum(['summary', 'raw'])
          .optional()
          .describe(
            'Default "summary" returns the questionnaire unless it exceeds a byte ceiling, in which case it answers with its size and top-level keys instead. "raw" returns the full payload however large (may exceed MCP size limits).'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    getFlow
  );
}
