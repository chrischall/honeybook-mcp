import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { CapturedSession } from './types.js';

export type { CapturedSession };

// ---------------------------------------------------------------------------
// Pure helpers — testable without Puppeteer
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
// resolveChromePath — copied from scripts/setup-auth.mjs
// ---------------------------------------------------------------------------

function resolveChromePath(): string {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) return envPath;
  const defaults: Record<string, string> = {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  };
  const p = defaults[process.platform];
  if (!p || !existsSync(p)) {
    throw new Error(
      'Google Chrome not found. Install Chrome, or set PUPPETEER_EXECUTABLE_PATH to your Chrome binary.'
    );
  }
  return p;
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

  async activate(magicLinkUrl: string): Promise<CapturedSession> {
    const puppeteer = (await import('puppeteer-core')).default;

    const showBrowser = !!process.env.HONEYBOOK_SHOW_BROWSER;
    const chromePath = resolveChromePath();

    const browser = await puppeteer.launch({
      headless: !showBrowser,
      executablePath: chromePath,
      defaultViewport: null,
      args: ['--no-first-run', '--no-default-browser-check'],
    });

    const page = await browser.newPage();
    try {
      // Intercept the first api.honeybook.com/api/v2/* request to grab fingerprint
      const fingerprintPromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timed out waiting for first api.honeybook.com request (30s).')),
          30000
        );
        const onRequest = (req: { url(): string; headers(): Record<string, string> }) => {
          const u = req.url();
          if (u.includes('api.honeybook.com/api/v2/')) {
            const fp = req.headers()['hb-api-fingerprint'];
            if (fp) {
              clearTimeout(timer);
              page.off('request', onRequest as Parameters<typeof page.off>[1]);
              resolve(fp);
            }
          }
        };
        page.on('request', onRequest as Parameters<typeof page.on>[1]);
      });

      await page.goto(magicLinkUrl, { waitUntil: 'networkidle2', timeout: 60000 });

      const fingerprint = await fingerprintPromise;

      const captured = await page.evaluate(() => {
        const j = JSON.parse((window as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem('jStorage') || '{}') as Record<string, unknown>;
        const user = (j.HB_CURR_USER || {}) as { company?: { company_name?: string } };
        const company = (user.company && user.company.company_name) || '';
        return {
          authToken: j.HB_AUTH_TOKEN as string,
          userId: j.HB_AUTH_USER_ID as string,
          trustedDevice: j.HB_TRUSTED_DEVICE as string,
          companyName: company,
          portalOrigin: location.origin,
        };
      });

      if (!captured.authToken) {
        throw new Error('No HB_AUTH_TOKEN found — did the magic link fail to load?');
      }

      const session: CapturedSession = {
        portalOrigin: normalizeOrigin(captured.portalOrigin),
        companyName: captured.companyName,
        authToken: captured.authToken,
        userId: captured.userId,
        trustedDevice: captured.trustedDevice,
        fingerprint,
        capturedAt: Date.now(),
      };

      this.sessions.set(session.portalOrigin, session);
      this.mostRecentOrigin = session.portalOrigin;
      this.saveToDisk();
      return session;
    } finally {
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
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
