import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMcp, loadDotenvSafely } from '@chrischall/mcp-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

import { registerSessionTools } from './tools/sessions.js';
import { registerFlowTools } from './tools/flows.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerWorkspaceFileTools } from './tools/workspace_files.js';
import { registerWorkspaceTools } from './tools/workspaces.js';
import { registerPaymentMethodTools } from './tools/payment_methods.js';
import { registerContractTools } from './tools/contracts.js';
import { registerInvoiceTools } from './tools/invoices.js';

await runMcp({
  name: 'honeybook-mcp',
  version: '0.8.2', // x-release-please-version
  tools: [
    registerSessionTools,
    registerFlowTools,
    registerWorkspaceFileTools,
    registerWorkspaceTools,
    registerPaymentMethodTools,
    registerContractTools,
    registerInvoiceTools,
    registerHealthcheckTools,
  ],
});
