import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { SessionStore } from '@chrischall/mcp-utils/session';
import { normalizeOrigin, sessionStore, sessionsDir, sessionsFilePath } from '../src/sessions.js';
import type { CapturedSession } from '../src/types.js';

// src/sessions.ts is now a thin adapter over @chrischall/mcp-utils/session —
// this repo was the donor SessionStore was extracted from. These tests assert
// the adapter wiring (re-exports, key normalization, persistence semantics)
// rather than re-testing the shared store's internals.

// ---- normalizeOrigin (re-exported from @chrischall/mcp-utils/session) ----

describe('normalizeOrigin', () => {
  it('strips path and query from a full URL', () => {
    expect(normalizeOrigin('https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/123'))
      .toBe('https://thesilkveileventsbyivy.hbportal.co');
  });

  it('strips trailing slash from an origin', () => {
    expect(normalizeOrigin('https://x.hbportal.co/')).toBe('https://x.hbportal.co');
  });

  it('returns an origin as-is (no trailing slash)', () => {
    expect(normalizeOrigin('https://x.hbportal.co')).toBe('https://x.hbportal.co');
  });

  it('handles URLs with query strings', () => {
    expect(normalizeOrigin('https://x.hbportal.co/app/file/abc?token=xyz'))
      .toBe('https://x.hbportal.co');
  });
});

// ---- exported sessionStore singleton: empty-state behavior ----

const MOCK_SESSION: CapturedSession = {
  portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
  companyName: 'The Silk Veil Events by Ivy',
  authToken: 'tok_43',
  userId: 'uid_24',
  trustedDevice: 'td_64',
  fingerprint: 'fp_32',
  capturedAt: 1745000000000,
};

// ---- test isolation: the singleton must NOT write to the real home store ----
// `HONEYBOOK_SESSIONS_DIR` (set by tests/setup.ts) redirects persistence into a
// throwaway temp dir, so the suite never clobbers the developer's real
// ~/.honeybook-mcp/sessions.json.

describe('sessionStore test isolation', () => {
  it('resolves the store path under os.tmpdir(), never the real home dir', () => {
    expect(sessionsDir.startsWith(tmpdir())).toBe(true);
    expect(sessionsFilePath.startsWith(tmpdir())).toBe(true);
    expect(sessionsFilePath).not.toContain(pathJoin(homedir(), '.honeybook-mcp'));
  });

  it('honors the HONEYBOOK_SESSIONS_DIR override', () => {
    expect(sessionsDir).toBe(process.env.HONEYBOOK_SESSIONS_DIR);
  });
});

describe('sessionStore (exported singleton)', () => {
  beforeEach(() => sessionStore.resetForTest());

  it('get() returns null when no sessions are active', () => {
    expect(sessionStore.get()).toBeNull();
    expect(sessionStore.get('https://x.hbportal.co')).toBeNull();
  });

  it('list() returns empty array when no sessions are active', () => {
    expect(sessionStore.list()).toEqual([]);
  });

  it('remove() returns false for an unknown origin', () => {
    expect(sessionStore.remove('https://unknown.hbportal.co')).toBe(false);
  });
});

// ---- adapter-shaped store against a temp file: full lifecycle ----
// Mirrors the exact options src/sessions.ts passes to SessionStore so the
// integration semantics (key normalization, MRU pointer, disk round-trip,
// hardened perms, corrupt-file preservation) are pinned for this repo.

function tmpStorePath(): string {
  const dir = pathJoin(tmpdir(), `hb-sessions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return pathJoin(dir, 'sessions.json');
}

function newStore(filePath: string): SessionStore<CapturedSession> {
  return new SessionStore<CapturedSession>({
    filePath,
    keyOf: (s) => s.portalOrigin,
    normalizeKey: normalizeOrigin,
  });
}

describe('SessionStore adapter wiring', () => {
  it('keys by portalOrigin and normalizes lookups (full URL → origin)', () => {
    const store = newStore(tmpStorePath());
    store.add(MOCK_SESSION);
    const hit = store.get('https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/123?x=1');
    expect(hit?.authToken).toBe('tok_43');
  });

  it('get() with no key returns the most-recently-added session', () => {
    const store = newStore(tmpStorePath());
    store.add({ ...MOCK_SESSION, portalOrigin: 'https://a.hbportal.co', companyName: 'A' });
    store.add({ ...MOCK_SESSION, portalOrigin: 'https://b.hbportal.co', companyName: 'B' });
    expect(store.get()?.companyName).toBe('B');
  });

  it('remove() fixes up the most-recent pointer', () => {
    const store = newStore(tmpStorePath());
    store.add({ ...MOCK_SESSION, portalOrigin: 'https://a.hbportal.co', companyName: 'A' });
    store.add({ ...MOCK_SESSION, portalOrigin: 'https://b.hbportal.co', companyName: 'B' });
    expect(store.remove('https://b.hbportal.co')).toBe(true);
    expect(store.get()?.companyName).toBe('A');
    expect(store.list()).toHaveLength(1);
  });

  it('persists across instances (JSON array, insertion order, last = most recent)', () => {
    const filePath = tmpStorePath();
    const store = newStore(filePath);
    store.add({ ...MOCK_SESSION, portalOrigin: 'https://a.hbportal.co', companyName: 'A' });
    store.add({ ...MOCK_SESSION, portalOrigin: 'https://b.hbportal.co', companyName: 'B' });

    const reloaded = newStore(filePath);
    expect(reloaded.list().map((s) => s.companyName)).toEqual(['A', 'B']);
    expect(reloaded.get()?.companyName).toBe('B');
  });

  it('writes the sessions file with mode 0600 (audit C-2 upgrade)', () => {
    const filePath = tmpStorePath();
    const store = newStore(filePath);
    store.add(MOCK_SESSION);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('re-tightens a loose pre-existing file to 0600 on save (audit C-2 upgrade)', () => {
    const filePath = tmpStorePath();
    writeFileSync(filePath, '[]', { mode: 0o644 });
    const store = newStore(filePath);
    store.add(MOCK_SESSION);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('preserves a corrupt sessions file as a .corrupt backup instead of overwriting it (0.7.0 upgrade)', () => {
    const filePath = tmpStorePath();
    writeFileSync(filePath, 'not json at all', { mode: 0o600 });

    const store = newStore(filePath);
    expect(store.list()).toEqual([]);
    const backup = `${filePath}.corrupt`;
    expect(existsSync(backup)).toBe(true);
    expect(readFileSync(backup, 'utf8')).toBe('not json at all');

    // A subsequent save must not clobber the preserved backup.
    store.add(MOCK_SESSION);
    expect(readFileSync(backup, 'utf8')).toBe('not json at all');
  });
});
