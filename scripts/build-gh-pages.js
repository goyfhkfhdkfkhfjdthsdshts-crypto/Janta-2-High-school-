#!/usr/bin/env node

/**
 * GitHub Pages Static Export Build Script
 * Delegates to the unified scripts/build.js orchestrator in GitHub Pages mode.
 */

const { execFileSync } = require('child_process');
const path = require('path');

execFileSync(process.execPath, [path.join(__dirname, 'build.js'), '--gh-pages'], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    GITHUB_PAGES: 'true',
    STATIC_EXPORT: 'true',
  },
});
