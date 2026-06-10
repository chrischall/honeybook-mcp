// Global test setup — runs before any test module is imported.
//
// The exported `sessionStore` singleton in `src/sessions.ts` persists captured
// sessions to disk. By default that path is the developer's REAL credential
// store (`~/.honeybook-mcp/sessions.json`), so any test that exercises the
// capture/persist flow (e.g. tests/auth.test.ts) would clobber and read the
// user's actual session state.
//
// We point `HONEYBOOK_SESSIONS_DIR` at a throwaway temp dir BEFORE `src/*` is
// imported (setupFiles run before the test file's own imports are evaluated),
// so the singleton is constructed against an isolated directory. The temp dir
// is removed after the whole run.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const tempSessionsDir = mkdtempSync(join(tmpdir(), 'honeybook-mcp-test-'));
process.env.HONEYBOOK_SESSIONS_DIR = tempSessionsDir;

afterAll(() => {
  rmSync(tempSessionsDir, { recursive: true, force: true });
});
