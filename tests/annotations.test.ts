// fleet-audit#504: every tool states its hints explicitly, and the deep-link
// tools (pay_invoice, sign_contract) and the credential-capture tools are not
// advertised as destructive.
import { describe, it, expect } from 'vitest';
import { registerSessionTools } from '../src/tools/sessions.js';
import { registerFlowTools } from '../src/tools/flows.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerWorkspaceFileTools } from '../src/tools/workspace_files.js';
import { registerWorkspaceTools } from '../src/tools/workspaces.js';
import { registerPaymentMethodTools } from '../src/tools/payment_methods.js';
import { registerContractTools } from '../src/tools/contracts.js';
import { registerInvoiceTools } from '../src/tools/invoices.js';
import { registerProjectTools } from '../src/tools/projects.js';
import { registerMessageTools } from '../src/tools/messages.js';
import { registerMeetingTools } from '../src/tools/meetings.js';
import { registerTaskTools } from '../src/tools/tasks.js';
import { registerNoteTools } from '../src/tools/notes.js';
import { registerAttachmentTools } from '../src/tools/attachments.js';
import { registerPaymentTools } from '../src/tools/payments.js';

type Annotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

/**
 * The registration config each tool declares. Read off registerTool directly:
 * the shared test harness's listTools() returns names and descriptions only.
 */
async function allAnnotations(): Promise<Map<string, Annotations>> {
  const seen = new Map<string, Annotations>();
  const server = {
    registerTool: (name: string, config: { annotations?: Annotations }) => {
      seen.set(name, config.annotations ?? {});
    },
  } as unknown as Parameters<typeof registerSessionTools>[0];
  for (const register of [
    registerSessionTools,
    registerFlowTools,
    registerWorkspaceFileTools,
    registerWorkspaceTools,
    registerPaymentMethodTools,
    registerContractTools,
    registerInvoiceTools,
    registerProjectTools,
    registerMessageTools,
    registerMeetingTools,
    registerTaskTools,
    registerNoteTools,
    registerAttachmentTools,
    registerPaymentTools,
    registerHealthcheckTools,
  ]) {
    register(server);
  }
  return seen;
}

describe('tool annotations', () => {
  it('every tool states readOnlyHint and openWorldHint; every write also states destructive/idempotent', async () => {
    const all = await allAnnotations();
    expect(all.size).toBeGreaterThan(20);
    for (const [name, a] of all) {
      expect(typeof a.readOnlyHint, `${name}.readOnlyHint`).toBe('boolean');
      expect(typeof a.openWorldHint, `${name}.openWorldHint`).toBe('boolean');
      if (a.readOnlyHint === false) {
        expect(typeof a.destructiveHint, `${name}.destructiveHint`).toBe('boolean');
        expect(typeof a.idempotentHint, `${name}.idempotentHint`).toBe('boolean');
      }
    }
  });

  it('pay_invoice and sign_contract only return a deep link, so they are read-only', async () => {
    const all = await allAnnotations();
    for (const name of ['pay_invoice', 'sign_contract']) {
      expect(all.get(name)).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(all.get(name)?.destructiveHint).not.toBe(true);
    }
  });

  it('the capture tools only write the local credential store: not destructive, idempotent', async () => {
    const all = await allAnnotations();
    for (const name of ['use_magic_link', 'use_flow_link']) {
      expect(all.get(name)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
    }
  });

  it('mark_messages_seen and send_message reach HoneyBook (open world)', async () => {
    const all = await allAnnotations();
    expect(all.get('mark_messages_seen')?.openWorldHint).toBe(true);
    expect(all.get('send_message')).toMatchObject({ destructiveHint: true, openWorldHint: true });
  });
});
