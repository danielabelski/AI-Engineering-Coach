/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = 'v0.79.8';
const sourceChecksum = 'h1:FSQ364c85xL/YDay7/wbFTLWvyJ+/0l+IbD2A5bYeqY=';
const source = JSON.parse(execFileSync('go', [
  'mod', 'download', '-json', `github.com/github/gh-aw@${version}`,
], { cwd: root, encoding: 'utf8' }));

if (source.Sum !== sourceChecksum) {
  throw new Error(`Unexpected gh-aw ${version} source checksum: ${source.Sum}`);
}

const actionLock = JSON.parse(readFileSync(join(root, '.github', 'aw', 'actions-lock.json'), 'utf8'));
const overriddenRepos = new Set();
for (const [key, pin] of Object.entries(actionLock.entries)) {
  if (key !== `${pin.repo}@${pin.version}` || !/^[a-f0-9]{40}$/.test(pin.sha)) {
    throw new Error(`Invalid action pin: ${key}`);
  }
  if (overriddenRepos.has(pin.repo)) {
    throw new Error(`Expected one pinned version for ${pin.repo}`);
  }
  overriddenRepos.add(pin.repo);
}

const buildDir = mkdtempSync(join(tmpdir(), 'ai-engineer-coach-gh-aw-'));
try {
  cpSync(source.Dir, buildDir, { recursive: true });
  const pinsPath = join(buildDir, 'pkg', 'actionpins', 'data', 'action_pins.json');
  const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
  pins.entries = Object.fromEntries(Object.entries(pins.entries)
    .filter(([, pin]) => !overriddenRepos.has(pin.repo)));
  Object.assign(pins.entries, actionLock.entries);
  const serialized = JSON.stringify(pins, null, 2) + '\n';
  const sourceLockDir = join(buildDir, '.github', 'aw');
  mkdirSync(sourceLockDir, { recursive: true });

  // Mirrors gh-aw's sync-action-pins target; Go's shared module cache stays untouched.
  for (const destination of [
    join(sourceLockDir, 'actions-lock.json'),
    pinsPath,
    join(buildDir, 'pkg', 'workflow', 'data', 'action_pins.json'),
  ]) {
    chmodSync(destination, 0o644);
    writeFileSync(destination, serialized);
  }

  const compiler = join(buildDir, process.platform === 'win32' ? 'gh-aw.exe' : 'gh-aw');
  execFileSync('go', [
    'build', '-ldflags', `-s -w -X main.version=${version} -X main.isRelease=true`, '-o', compiler,
    `.${sep}${join('cmd', 'gh-aw')}`,
  ], { cwd: buildDir, stdio: 'inherit' });

  const result = spawnSync(compiler, ['compile', 'issue-triage', '--strict', '--no-check-update'], {
    cwd: root,
    env: { ...process.env, GH_AW_DISABLE_UPDATE_CHECK: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // Lip Gloss otherwise opens CONIN$ during initialization and can hang in Windows wrappers.
    detached: process.platform === 'win32',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`gh-aw ${version} compilation failed (${result.signal ?? result.status})`);
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}
