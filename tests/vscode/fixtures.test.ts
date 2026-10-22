/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addReloadFixture, assertFixturesUnchanged, fixtureFiles, fixturePaths, isolatedEnvironment, prepareFixtures,
} from './fixtures';
import { discoverSuites, vscodeVersion } from './run';

const timestamp = Date.UTC(2026, 0, 15, 12);
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aec-fixtures-'));
  for (const [key, value] of Object.entries(isolatedEnvironment(root, {}))) vi.stubEnv(key, value);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe('desktop test fixtures', () => {
  it('parses real raw sessions with exact counts and discovers the added reload fixture', async () => {
    await prepareFixtures(root, timestamp, true);
    const { findLogsDirs, parseAllLogs } = await import('../../src/core/parser');
    expect(findLogsDirs()).toEqual([fixturePaths(root).logs]);
    const initial = parseAllLogs(findLogsDirs());
    expect(initial.sessions).toHaveLength(2);
    expect(initial.sessions.reduce((sum, session) => sum + session.requests.length, 0)).toBe(6);
    expect(initial.workspaces.size).toBe(2);
    await assertFixturesUnchanged(root, timestamp);
    await addReloadFixture(root, timestamp);
    const reloaded = parseAllLogs(findLogsDirs());
    expect(reloaded.sessions).toHaveLength(3);
    expect(reloaded.sessions.reduce((sum, session) => sum + session.requests.length, 0)).toBe(9);
    await assertFixturesUnchanged(root, timestamp, true);
  });

  it('does not create a discoverable source for the empty scenario', async () => {
    await prepareFixtures(root, timestamp, false);
    const { findLogsDirs } = await import('../../src/core/parser');
    const { hasExternalHarnessSources } = await import('../../src/core/parser-harnesses');
    expect(findLogsDirs()).toEqual([]);
    expect(hasExternalHarnessSources()).toBe(false);
  });

  it('detects session data modified by the application', async () => {
    await prepareFixtures(root, timestamp, true);
    const file = [...fixtureFiles(root, timestamp).keys()][0];
    await fs.appendFile(file, 'unexpected data');
    await expect(assertFixturesUnchanged(root, timestamp)).rejects.toThrow('Session-log input was modified');
  });

  it('isolates every discovery root without mutating the parent environment', () => {
    const parent = { HOME: '/personal', USERPROFILE: '/personal', COPILOT_HOME: '/personal/copilot',
      VSCODE_PORTABLE: '/personal/code', VSCODE_IPC_HOOK_CLI: 'personal-socket', ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--inspect', CODE_VERSION: 'latest', PATH: '/tools' };
    const env = isolatedEnvironment(root, parent);
    for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'COPILOT_HOME', 'TMP', 'TEMP', 'TMPDIR']) {
      expect(env[key]?.startsWith(root + path.sep)).toBe(true);
    }
    expect(env).not.toHaveProperty('VSCODE_PORTABLE');
    expect(env).not.toHaveProperty('VSCODE_IPC_HOOK_CLI');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('CODE_VERSION');
    expect(env.PATH).toBe('/tools');
    expect(parent.HOME).toBe('/personal');
  });

  it('places fixture logs in the platform-specific discovery locations', () => {
    expect(fixturePaths(root, 'win32').logs).toContain(path.join('AppData', 'Roaming', 'Code', 'User'));
    expect(fixturePaths(root, 'darwin').logs).toContain(path.join('Library', 'Application Support', 'Code', 'User'));
    expect(fixturePaths(root, 'linux').logs).toContain(path.join('.config', 'Code', 'User'));
  });
});

describe('desktop VS Code version selection', () => {
  it('uses the manifest minimum and accepts compatible pinned or latest versions', () => {
    expect(vscodeVersion('^1.125.0')).toBe('1.125.0');
    expect(vscodeVersion('^1.125.0', '1.140.0')).toBe('1.140.0');
    expect(vscodeVersion('^1.125.0', 'latest')).toBe('latest');
  });

  describe('desktop suite discovery', () => {
    it('automatically includes new source suites but never stale compiled files', async () => {
      for (const file of ['populated.spec.ts', 'new-feature.spec.ts', 'helper.ts', 'deleted.spec.js']) {
        await fs.writeFile(path.join(root, file), '');
      }
      expect(await discoverSuites(root)).toEqual(['new-feature', 'populated']);
    });

    it('rejects an empty test selection', async () => {
      await expect(discoverSuites(root)).rejects.toThrow('No desktop smoke suites found');
    });
  });

  it('rejects incompatible versions and malformed input', () => {
    for (const version of ['1.124.0', '2.0.0', '../Code', 'stable']) {
      expect(() => vscodeVersion('^1.125.0', version)).toThrow();
    }
    expect(() => vscodeVersion('>=1.125.0')).toThrow();
  });
});
