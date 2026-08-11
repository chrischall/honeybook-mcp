import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMcp, loadDotenvSafely } from '@chrischall/mcp-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

import { registerSessionTools } from './tools/sessions.js';
import { registerWorkspaceFileTools } from './tools/workspace_files.js';
import { registerWorkspaceTools } from './tools/workspaces.js';
import { registerPaymentMethodTools } from './tools/payment_methods.js';
import { registerContractTools } from './tools/contracts.js';
import { registerInvoiceTools } from './tools/invoices.js';

await runMcp({
  name: 'honeybook-mcp',
  version: '0.4.5', // x-release-please-version
  tools: [
    registerSessionTools,
    registerWorkspaceFileTools,
    registerWorkspaceTools,
    registerPaymentMethodTools,
    registerContractTools,
    registerInvoiceTools,
  ],
});
