#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { execSync } from 'node:child_process';

export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseExistingVendors(envBody) {
  const m = envBody.match(/^HONEYBOOK_VENDORS=(.*)$/m);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mergeEnvForVendor(envBody, captured) {
  const { slug, label, authToken, userId, trustedDevice, fingerprint, portalOrigin } = captured;
  const UP = slug.toUpperCase();
  const newBlock = [
    `HB_${UP}_LABEL=${label}`,
    `HB_${UP}_PORTAL_ORIGIN=${portalOrigin}`,
    `HB_${UP}_AUTH_TOKEN=${authToken}`,
    `HB_${UP}_USER_ID=${userId}`,
    `HB_${UP}_TRUSTED_DEVICE=${trustedDevice}`,
    `HB_${UP}_FINGERPRINT=${fingerprint}`,
  ].join('\n');

  // Strip any existing block for this slug
  const stripped = envBody.replace(new RegExp(`(^HB_${UP}_[A-Z_]+=.*\\n?)+`, 'gm'), '');

  // Update HONEYBOOK_VENDORS
  const existing = parseExistingVendors(stripped);
  const next = existing.includes(slug) ? existing : [...existing, slug];
  const vendorsLine = `HONEYBOOK_VENDORS=${next.join(',')}`;

  let updated;
  if (/^HONEYBOOK_VENDORS=/m.test(stripped)) {
    updated = stripped.replace(/^HONEYBOOK_VENDORS=.*$/m, vendorsLine);
  } else {
    updated = vendorsLine + '\n' + stripped;
  }
  if (!updated.endsWith('\n')) updated += '\n';
  return updated + newBlock + '\n';
}

// Everything below only runs when invoked directly.
const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;

async function main() {
  const envPath = resolve(process.cwd(), '.env');
  const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

  // Lazy-install puppeteer-core
  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer-core'));
  } catch {
    console.log('Installing puppeteer-core (first-run only)…');
    execSync('npm install --no-save puppeteer-core@^24.0.0', { stdio: 'inherit' });
    ({ default: puppeteer } = await import('puppeteer-core'));
  }

  const profileDir = join(homedir(), '.honeybook-mcp', 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });
  chmodSync(profileDir, 0o700);

  const chromePath = resolveChromePath();
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath,
    userDataDir: profileDir,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const rl = createInterface({ input: stdin, output: stdout });
  let merged = existingEnv;

  try {
    while (true) {
      const url = (
        await rl.question(
          'Paste a magic-link URL from a vendor\'s HoneyBook email (or press Enter to open hbportal.co):\n> '
        )
      ).trim();
      const captured = await captureFromMagicLink(browser, url || 'https://www.hbportal.co');
      const suggestedSlug = slugify(captured.companyName || 'vendor');
      const slug =
        (await rl.question(`Vendor slug [${suggestedSlug}]: `)).trim() || suggestedSlug;
      const label =
        (await rl.question(`Display label [${captured.companyName}]: `)).trim() || captured.companyName;
      merged = mergeEnvForVendor(merged, {
        slug,
        label,
        authToken: captured.authToken,
        userId: captured.userId,
        trustedDevice: captured.trustedDevice,
        fingerprint: captured.fingerprint,
        portalOrigin: captured.portalOrigin,
      });
      writeFileSync(envPath, merged, { mode: 0o600 });
      console.log(`Saved credentials for "${slug}" to ${envPath}`);
      const more = (await rl.question('Add another vendor? [y/N] ')).trim().toLowerCase();
      if (more !== 'y' && more !== 'yes') break;
    }
  } finally {
    rl.close();
    await browser.close();
  }
  console.log('Done.');
}

async function captureFromMagicLink(browser, url) {
  const page = await browser.newPage();
  try {
    const fingerprintPromise = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error('Timed out waiting for first api.honeybook.com request (30s).')),
        30000
      );
      const onRequest = (req) => {
        const u = req.url();
        if (u.includes('api.honeybook.com/api/v2/')) {
          const fp = req.headers()['hb-api-fingerprint'];
          if (fp) {
            clearTimeout(timer);
            page.off('request', onRequest);
            resolvePromise(fp);
          }
        }
      };
      page.on('request', onRequest);
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    const fingerprint = await fingerprintPromise;
    const captured = await page.evaluate(() => {
      const j = JSON.parse(localStorage.getItem('jStorage') || '{}');
      const user = j.HB_CURR_USER || {};
      const company = (user.company && user.company.company_name) || '';
      return {
        authToken: j.HB_AUTH_TOKEN,
        userId: j.HB_AUTH_USER_ID,
        trustedDevice: j.HB_TRUSTED_DEVICE,
        companyName: company,
        portalOrigin: location.origin,
      };
    });
    if (!captured.authToken) throw new Error('No HB_AUTH_TOKEN found — did the magic link fail to load?');
    return { ...captured, fingerprint };
  } finally {
    await page.close().catch(() => {});
  }
}

function resolveChromePath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) return envPath;
  const defaults = {
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

if (invokedAsScript) {
  main().catch((err) => {
    console.error('setup-auth error:', err?.message || err);
    process.exit(1);
  });
}
