// Disk-persisted session cache — thin adapter over the shared SessionStore in
// @chrischall/mcp-utils/session (this repo was the donor that store was
// extracted from). The shared store keeps the same semantics (keyed by
// normalized portalOrigin, most-recently-added is active, JSON array on disk
// in insertion order) and adds two hardening upgrades the local copy lacked:
//   - file perms are re-asserted 0600 (dir 0700) on EVERY save, so a loose
//     pre-existing sessions.json gets tightened before secrets are written;
//   - a corrupt sessions.json is preserved as `<path>.corrupt` instead of
//     being silently overwritten on the next save.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { SessionStore, normalizeOrigin } from '@chrischall/mcp-utils/session';
import { readEnvVar } from '@chrischall/mcp-utils';
import type { CapturedSession } from './types.js';

export type { CapturedSession };
export { normalizeOrigin };

// Base directory holding `sessions.json`. Defaults to the real per-user store
// (`~/.honeybook-mcp`). Overridable via `HONEYBOOK_SESSIONS_DIR` so the test
// suite can redirect persistence into an isolated temp dir and never touch the
// developer's real captured-session credentials. Production never sets the env
// var, so the default is unchanged.
export const sessionsDir = readEnvVar('HONEYBOOK_SESSIONS_DIR', {
  default: join(homedir(), '.honeybook-mcp'),
})!;

export const sessionsFilePath = join(sessionsDir, 'sessions.json');

export const sessionStore = new SessionStore<CapturedSession>({
  filePath: sessionsFilePath,
  keyOf: (session) => session.portalOrigin,
  normalizeKey: normalizeOrigin,
});
