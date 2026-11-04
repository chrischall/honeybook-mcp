import type { ToolRegistrar } from '@chrischall/mcp-utils';
import type { HoneyBookDeps } from './project-labels.js';
import { registerSessionTools } from './sessions.js';
import { registerFlowTools } from './flows.js';
import { registerHealthcheckTools } from './healthcheck.js';
import { registerWorkspaceFileTools } from './workspace_files.js';
import { registerWorkspaceTools } from './workspaces.js';
import { registerPaymentMethodTools } from './payment_methods.js';
import { registerContractTools } from './contracts.js';
import { registerInvoiceTools } from './invoices.js';
import { registerProjectTools } from './projects.js';
import { registerMessageTools } from './messages.js';
import { registerMeetingTools } from './meetings.js';
import { registerTaskTools } from './tasks.js';
import { registerNoteTools } from './notes.js';
import { registerAttachmentTools } from './attachments.js';
import { registerPaymentTools } from './payments.js';

/** Every registrar the server runs, in order — the hints test enumerates this list. */
export const registrars: ToolRegistrar<HoneyBookDeps>[] = [
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
  (server, deps) => registerPaymentTools(server, deps),
  registerHealthcheckTools,
];
