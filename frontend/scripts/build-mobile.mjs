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
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const res = spawnSync(cmd, ['next', 'build'], {
  cwd: frontendDir,
  env,
  stdio: 'inherit',
});

process.exit(res.status ?? 1);
