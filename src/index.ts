import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  // bundled mode — rely on process.env
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerVendorTools } from './tools/vendors.js';
import { registerWorkspaceFileTools } from './tools/workspace_files.js';
import { registerWorkspaceTools } from './tools/workspaces.js';

const server = new McpServer({
  name: 'honeybook-mcp',
  version: '0.1.0',
});

registerVendorTools(server);
registerWorkspaceFileTools(server);
registerWorkspaceTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
