import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { CapturedSession } from './types.js';

export type { CapturedSession };

// ---------------------------------------------------------------------------
// Pure helpers — testable without a browser
// ---------------------------------------------------------------------------

/**
 * Given a full URL or just an origin, return the origin without trailing slash.
 * e.g. normalizeOrigin('https://x.hbportal.co/app/workspace_file/123') → 'https://x.hbportal.co'
 *      normalizeOrigin('https://x.hbportal.co/') → 'https://x.hbportal.co'
 */
export function normalizeOrigin(input: string): string {
  try {
    const url = new URL(input);
    return url.origin.replace(/\/$/, '');
  } catch {
    return input.replace(/\/$/, '');
  }
}

/**
 * JSON stringify — sessions as an array in insertion order.
 */
export function serializeSessions(sessions: Map<string, CapturedSession>): string {
  return JSON.stringify(Array.from(sessions.values()), null, 2);
}

/**
 * Parse JSON array back into a Map keyed by portalOrigin; return empty map on invalid input.
 */
export function deserializeSessions(body: string): Map<string, CapturedSession> {
  try {
    const arr = JSON.parse(body) as CapturedSession[];
    if (!Array.isArray(arr)) return new Map();
    const map = new Map<string, CapturedSession>();
    for (const s of arr) {
      if (s && typeof s.portalOrigin === 'string') {
        map.set(s.portalOrigin, s);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// SessionStore — manages in-memory + disk-persisted sessions
// ---------------------------------------------------------------------------

class SessionStore {
  private sessions: Map<string, CapturedSession>;
  private mostRecentOrigin: string | null;
  private diskPath: string;

  constructor(diskPath?: string) {
    this.diskPath = diskPath ?? join(homedir(), '.honeybook-mcp', 'sessions.json');
    this.sessions = new Map();
    this.mostRecentOrigin = null;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.diskPath)) return;
    try {
      const body = readFileSync(this.diskPath, 'utf8');
      this.sessions = deserializeSessions(body);
      const last = Array.from(this.sessions.keys()).pop();
      this.mostRecentOrigin = last ?? null;
    } catch {
      this.sessions = new Map();
      this.mostRecentOrigin = null;
    }
  }

  private saveToDisk(): void {
    mkdirSync(dirname(this.diskPath), { recursive: true });
    writeFileSync(this.diskPath, serializeSessions(this.sessions), { mode: 0o600 });
    try {
      chmodSync(dirname(this.diskPath), 0o700);
    } catch {
      // best-effort
    }
  }

  /**
   * Insert (or replace) a fully-constructed CapturedSession. Used by
   * `src/auth.ts` after `@fetchproxy/bootstrap` has supplied the
   * jStorage + fingerprint values from the user's browser tab.
   *
   * Marks the session as most-recent so the next tool call that doesn't
   * pass `origin` picks it up automatically.
   */
  add(session: CapturedSession): void {
    const normalized = normalizeOrigin(session.portalOrigin);
    const stored: CapturedSession = { ...session, portalOrigin: normalized };
    this.sessions.set(normalized, stored);
    this.mostRecentOrigin = normalized;
    this.saveToDisk();
  }

  get(origin?: string): CapturedSession | null {
    if (origin) return this.sessions.get(normalizeOrigin(origin)) ?? null;
    if (this.mostRecentOrigin) return this.sessions.get(this.mostRecentOrigin) ?? null;
    return null;
  }

  list(): CapturedSession[] {
    return Array.from(this.sessions.values());
  }

  deactivate(origin: string): boolean {
    const normalized = normalizeOrigin(origin);
    const had = this.sessions.delete(normalized);
    if (had) {
      if (this.mostRecentOrigin === normalized) {
        const remaining = Array.from(this.sessions.keys());
        this.mostRecentOrigin = remaining[remaining.length - 1] ?? null;
      }
      this.saveToDisk();
    }
    return had;
  }

  /** Test-only — clears in-memory state without touching disk. */
  resetForTest(): void {
    this.sessions.clear();
    this.mostRecentOrigin = null;
  }
}

export const sessionStore = new SessionStore();
