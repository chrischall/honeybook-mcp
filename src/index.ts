import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMcp, loadDotenvSafely } from '@chrischall/mcp-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

import { SERVER_NAME, VERSION } from './version.js';
import { registrars } from './tools/index.js';
import { loadProjectDirectory } from './tools/project-labels.js';

// The projects are listed ONCE, before serving, so list_payments' workspace_id
// can publish their names as an enum (mcp-host context groups). The listing is
// bounded and never throws: with no session yet (install time) or a lapsed one
// it publishes no enum and the tools still work by workspace id.
const deps = { projects: await loadProjectDirectory() };

await runMcp({
  name: SERVER_NAME,
  version: VERSION,
  deps,
  tools: registrars,
});
