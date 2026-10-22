/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const INITIAL_COUNTS = { Requests: '6', Sessions: '2', Workspaces: '2' };
export const RELOADED_COUNTS = { Requests: '9', Sessions: '3', Workspaces: '2' };
export const FIRST_PROMPT = 'Explain how the synthetic API handles a missing item.';

export function isolatedEnvironment(root: string, original: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const home = path.join(root, 'home');
  const env: NodeJS.ProcessEnv = {
    ...original,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    COPILOT_HOME: path.join(home, '.copilot'),
    TMPDIR: path.join(root, 'tmp'),
    TMP: path.join(root, 'tmp'),
    TEMP: path.join(root, 'tmp'),
  };
  for (const key of Object.keys(env)) {
    if (key.startsWith('VSCODE_') || key.startsWith('NODE_')
      || ['ELECTRON_RUN_AS_NODE', 'EXTENSION_DEV_PATH', 'EXTENSIONS_FOLDER', 'TEST_RESOURCES', 'CODE_VERSION'].includes(key)) {
      delete env[key];
    }
  }
  return env;
}

export function fixturePaths(root: string, platform: NodeJS.Platform = process.platform) {
  const home = path.join(root, 'home');
  const codeUser = platform === 'win32'
    ? path.join(home, 'AppData', 'Roaming', 'Code', 'User')
    : platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Code', 'User')
      : path.join(home, '.config', 'Code', 'User');
  return {
    home,
    logs: path.join(codeUser, 'workspaceStorage'),
    workspace: path.join(home, 'workspaces', 'smoke-workspace'),
    runtimeLog: path.join(home, '.copilot-analytics-cache', 'runtime.log'),
  };
}

function sessionJson(id: string, timestamp: number, firstPrompt: string): string {
  const prompts = [firstPrompt, 'Add a deterministic test for the missing item.', 'Explain the test result.'];
  return JSON.stringify({
    sessionId: id,
    customTitle: id,
    creationDate: timestamp,
    lastMessageDate: timestamp + 120_000,
    requests: prompts.map((text, index) => ({
      requestId: `${id}-request-${index}`,
      timestamp: timestamp + index * 60_000,
      message: { text },
      response: [{ value: `Synthetic answer ${index + 1}: the example is handled without external services.` }],
      modelId: 'gpt-4o',
      result: { timings: { firstProgress: 100, totalElapsed: 500 }, metadata: {} },
    })),
  }, null, 2) + '\n';
}

export function fixtureFiles(root: string, timestamp: number, reloaded = false): Map<string, string> {
  const { home, logs } = fixturePaths(root);
  const files = new Map<string, string>();
  for (const [index, name] of ['smoke-api', 'smoke-ui'].entries()) {
    const workspace = path.join(home, 'workspaces', name);
    files.set(path.join(logs, name, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(workspace).href }) + '\n');
    files.set(
      path.join(logs, name, 'chatSessions', `${name}.json`),
      sessionJson(name, timestamp + index * 600_000, index === 0 ? FIRST_PROMPT : 'Explain the synthetic dashboard.'),
    );
  }
  if (reloaded) {
    files.set(path.join(logs, 'smoke-api', 'chatSessions', 'smoke-reload.json'),
      sessionJson('smoke-reload', timestamp + 1_200_000, 'Verify that reloading discovers this new synthetic session.'));
  }
  return files;
}

export async function prepareFixtures(root: string, timestamp: number, populated: boolean): Promise<void> {
  const { home, workspace } = fixturePaths(root);
  await Promise.all([
    fs.mkdir(workspace, { recursive: true }),
    fs.mkdir(path.join(root, 'tmp'), { recursive: true }),
    fs.mkdir(path.join(home, 'workspaces', 'smoke-api'), { recursive: true }),
    fs.mkdir(path.join(home, 'workspaces', 'smoke-ui'), { recursive: true }),
  ]);
  if (!populated) return;
  for (const [file, content] of fixtureFiles(root, timestamp)) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, { flag: 'wx' });
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(file));
    else files.push(file);
  }
  return files;
}

export async function assertFixturesUnchanged(root: string, timestamp: number, reloaded = false): Promise<void> {
  const expected = fixtureFiles(root, timestamp, reloaded);
  assert.deepEqual((await listFiles(fixturePaths(root).logs)).sort(), [...expected.keys()].sort(),
    'Session-log files were added or removed unexpectedly');
  for (const [file, content] of expected) {
    assert.equal(await fs.readFile(file, 'utf8'), content, `Session-log input was modified: ${file}`);
  }
}

export async function addReloadFixture(root: string, timestamp: number): Promise<void> {
  await assertFixturesUnchanged(root, timestamp);
  const original = fixtureFiles(root, timestamp);
  for (const [file, content] of fixtureFiles(root, timestamp, true)) {
    if (!original.has(file)) await fs.writeFile(file, content, { flag: 'wx' });
  }
}

export function scenarioContext(): { root: string; timestamp: number } {
  const root = process.env.AIC_E2E_SCENARIO_ROOT;
  const timestamp = Number(process.env.AIC_E2E_TIMESTAMP);
  if (!root || !path.isAbsolute(root) || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('Missing isolated test context. Run these tests through npm run test:vscode.');
  }
  return { root, timestamp };
}
