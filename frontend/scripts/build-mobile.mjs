#!/usr/bin/env node
/**
 * Build the static web bundle for the Capacitor Android app.
 *
 * Sets CAPACITOR_BUILD=true so next.config.mjs emits `output: 'export'`,
 * producing the static site in `out/` that `npx cap sync` copies into the
 * Android project's assets.
 *
 * Usage:  npm run build:mobile
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, '..');

const env = { ...process.env, CAPACITOR_BUILD: 'true' };
// Invoke Next's JS entrypoint directly with the current Node executable.
// Spawning `npx`/`npx.cmd` fails on Windows Node >= 20 unless shell:true
// (EINVAL from .cmd spawn restriction), which made this script fail silently.
const nextBin = join(frontendDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const res = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: frontendDir,
  env,
  stdio: 'inherit',
});

if (res.error) {
  console.error(`build-mobile: failed to launch next: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
