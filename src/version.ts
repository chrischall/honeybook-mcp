// Single source of truth for the server's name and version. Release-please
// bumps the VERSION literal (listed in release-please-config.json
// `extra-files`), and tests/version-sync.test.ts guards it against
// package.json drift. Importing these instead of package.json keeps the
// whole manifest — npm scripts included — out of dist/bundle.js.
export const SERVER_NAME = 'honeybook-mcp';
export const VERSION = '1.2.7'; // x-release-please-version
