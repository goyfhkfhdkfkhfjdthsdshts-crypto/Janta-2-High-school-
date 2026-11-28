#!/usr/bin/env node

/**
 * Unified Production Build Script for Janta +2 High School - Khalari
 *
 * Automatically supports:
 * 1. Full-Stack Server Builds (Node.js / Cloud Run / AI Studio) -> `.next/`
 *    Keeps all `/api/*` route handlers and `middleware.ts` active.
 * 2. Cloudflare Pages Static Export (`CF_PAGES=1`, `CLOUDFLARE_PAGES=true`, or `--cloudflare`) -> `out/`
 * 3. GitHub Pages Static Export (`GITHUB_PAGES=true` or `--gh-pages`) -> `out/`
 * 4. Generic Static Export (`STATIC_EXPORT=true`, `NEXT_EXPORT=true`, or `--static`) -> `out/`
 *
 * For static export targets, Next.js `output: 'export'` does not permit dynamic
 * server-side Route Handlers (e.g. `/api/about` PUT/POST) or Edge Middleware.
 * This script validates full TypeScript types across the entire repo (including
 * `app/api/*` and `middleware.ts`), isolates server-only files only during the
 * static HTML export compilation, and always restores them immediately afterward.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const args = new Set(process.argv.slice(2));

const isCloudflare =
  args.has('--cloudflare') ||
  process.env.CF_PAGES === '1' ||
  process.env.CF_PAGES === 'true' ||
  process.env.CLOUDFLARE_PAGES === 'true';

const isGitHubPages =
  !isCloudflare &&
  (args.has('--gh-pages') || process.env.GITHUB_PAGES === 'true');

const isStaticExport =
  isCloudflare ||
  isGitHubPages ||
  args.has('--static') ||
  process.env.STATIC_EXPORT === 'true' ||
  process.env.NEXT_EXPORT === 'true';

function run(cmd, env) {
  execSync(cmd, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...env,
    },
  });
}

// 1. Standard Full-Stack Next.js Server Build (AI Studio / Cloud Run / Node.js)
if (!isStaticExport) {
  console.log('🔨 Running Next.js full-stack production build...');
  run('npx next build', { NODE_ENV: 'production' });
  process.exit(0);
}

// 2. Static Export Build (Cloudflare Pages / GitHub Pages)
const targetName = isCloudflare
  ? 'Cloudflare Pages'
  : isGitHubPages
    ? 'GitHub Pages'
    : 'Static Export';

console.log(`🚀 Starting Next.js Static Export Build for ${targetName}...\n`);

const APP_API_DIR = path.join(ROOT_DIR, 'app', 'api');
const BACKUP_API_DIR = path.join(ROOT_DIR, '.api_static_export_backup');
const MIDDLEWARE_FILE = path.join(ROOT_DIR, 'middleware.ts');
const BACKUP_MIDDLEWARE_FILE = path.join(ROOT_DIR, '.middleware_static_export_backup.ts');
const NEXT_TYPES_DIR = path.join(ROOT_DIR, '.next', 'types');
const OUT_DIR = path.join(ROOT_DIR, 'out');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

// Resolve basePath safely
let repoName = '';
const hasCname =
  fs.existsSync(path.join(PUBLIC_DIR, 'CNAME')) ||
  fs.existsSync(path.join(ROOT_DIR, 'CNAME'));

if (isGitHubPages && !hasCname && process.env.GITHUB_REPOSITORY) {
  const parts = process.env.GITHUB_REPOSITORY.split('/');
  const repo = parts[1];
  if (repo && !repo.endsWith('.github.io')) {
    repoName = `/${repo}`;
  }
}

const rawBasePath = isCloudflare
  ? process.env.NEXT_PUBLIC_BASE_PATH || process.env.BASE_PATH || ''
  : process.env.ACTIONS_PAGES_BASE_PATH ||
    process.env.NEXT_PUBLIC_BASE_PATH ||
    process.env.BASE_PATH ||
    repoName;

const basePath =
  rawBasePath && rawBasePath !== '/'
    ? (rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`).replace(/\/$/, '')
    : '';

console.log('📦 Build Configuration:');
console.log(`   - Target:             ${targetName}`);
console.log(`   - Resolved basePath:  "${basePath || '/'}"`);
console.log(`   - Output directory:   out/\n`);

// Recover any leftover backups from an interrupted prior run
if (!fs.existsSync(APP_API_DIR) && fs.existsSync(BACKUP_API_DIR)) {
  fs.renameSync(BACKUP_API_DIR, APP_API_DIR);
}
if (!fs.existsSync(MIDDLEWARE_FILE) && fs.existsSync(BACKUP_MIDDLEWARE_FILE)) {
  fs.renameSync(BACKUP_MIDDLEWARE_FILE, MIDDLEWARE_FILE);
}

// Step A: Run full TypeScript check BEFORE isolating server-only routes so no errors are ever hidden
console.log('🔍 Running full TypeScript type check (including all API routes & middleware)...');
run('npx tsc --noEmit', {});
console.log('✅ TypeScript check passed!\n');

// Ensure public/.nojekyll exists for static hosting compatibility
const publicNoJekyll = path.join(PUBLIC_DIR, '.nojekyll');
if (!fs.existsSync(publicNoJekyll)) {
  if (!fs.existsSync(PUBLIC_DIR)) {
    fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  }
  fs.writeFileSync(publicNoJekyll, '');
}

let movedApi = false;
let movedMiddleware = false;

function restoreServerFiles() {
  if (movedApi && fs.existsSync(BACKUP_API_DIR)) {
    try {
      fs.renameSync(BACKUP_API_DIR, APP_API_DIR);
      movedApi = false;
      console.log('🔄 Restored app/api directory.');
    } catch (err) {
      console.error('❌ Failed to restore app/api:', err);
    }
  }
  if (movedMiddleware && fs.existsSync(BACKUP_MIDDLEWARE_FILE)) {
    try {
      fs.renameSync(BACKUP_MIDDLEWARE_FILE, MIDDLEWARE_FILE);
      movedMiddleware = false;
      console.log('🔄 Restored middleware.ts.');
    } catch (err) {
      console.error('❌ Failed to restore middleware.ts:', err);
    }
  }
}

process.on('SIGINT', () => {
  restoreServerFiles();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restoreServerFiles();
  process.exit(143);
});

let buildError = null;

try {
  // Step B: Temporarily isolate server-only Route Handlers & Middleware incompatible with `output: 'export'`
  if (fs.existsSync(APP_API_DIR)) {
    console.log('📦 Isolating server-only app/api routes for static HTML export...');
    fs.renameSync(APP_API_DIR, BACKUP_API_DIR);
    movedApi = true;
  }

  if (fs.existsSync(MIDDLEWARE_FILE)) {
    console.log('📦 Isolating middleware.ts for static HTML export...');
    fs.renameSync(MIDDLEWARE_FILE, BACKUP_MIDDLEWARE_FILE);
    movedMiddleware = true;
  }

  // Remove stale .next/types generated from server routes so TypeScript does not reference moved API routes
  if (fs.existsSync(NEXT_TYPES_DIR)) {
    fs.rmSync(NEXT_TYPES_DIR, { recursive: true, force: true });
  }

  // Step C: Compile Next.js static export with full ESLint + TypeScript validation enabled
  console.log('🔨 Compiling static Next.js export...');
  run('npx next build', {
    NODE_ENV: 'production',
    STATIC_EXPORT: 'true',
    CLOUDFLARE_PAGES: isCloudflare ? 'true' : 'false',
    GITHUB_PAGES: isGitHubPages ? 'true' : 'false',
    NEXT_PUBLIC_BASE_PATH: basePath,
    BASE_PATH: basePath,
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes('ais-dev-')
        ? process.env.NEXT_PUBLIC_API_URL
        : '',
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes('ais-dev-')
        ? process.env.NEXT_PUBLIC_APP_URL
        : '',
  });

  console.log('\n✅ Static compilation finished successfully!');
} catch (err) {
  buildError = err;
} finally {
  restoreServerFiles();
}

if (buildError) {
  console.error(`\n❌ ${targetName} static build failed.`);
  process.exit(1);
}

// Step D: Post-build verification and deployment metadata
if (!fs.existsSync(OUT_DIR) || !fs.existsSync(path.join(OUT_DIR, 'index.html'))) {
  console.error('❌ Error: out/index.html was not generated.');
  process.exit(1);
}

// Ensure .nojekyll in out/
const outNoJekyll = path.join(OUT_DIR, '.nojekyll');
if (!fs.existsSync(outNoJekyll)) {
  fs.writeFileSync(outNoJekyll, '');
}

// Add Cloudflare Pages caching & security headers file
if (isCloudflare) {
  const headersPath = path.join(OUT_DIR, '_headers');
  const headersContent = `/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`;
  fs.writeFileSync(headersPath, headersContent, 'utf-8');
  console.log('✅ Generated out/_headers for Cloudflare Pages');
}

// Ensure 404.html fallback exists for GitHub Pages SPA routing
if (isGitHubPages) {
  const outIndex = path.join(OUT_DIR, 'index.html');
  const out404 = path.join(OUT_DIR, '404.html');
  if (fs.existsSync(outIndex) && !fs.existsSync(out404)) {
    fs.copyFileSync(outIndex, out404);
    console.log('✅ Created out/404.html fallback for GitHub Pages');
  }
}

console.log(`\n🎉 SUCCESS! ${targetName} build is ready in ./out`);
