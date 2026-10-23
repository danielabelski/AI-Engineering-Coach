/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { after, before, describe, it } from 'mocha';
import { VSBrowser } from 'vscode-extension-tester';
import { Dashboard } from '../dashboard';
import {
  addReloadFixture, assertFixturesUnchanged, FIRST_PROMPT, fixturePaths,
  INITIAL_COUNTS, RELOADED_COUNTS, scenarioContext,
} from '../fixtures';

describe('Packaged VSIX with synthetic sessions', () => {
  const dashboard = new Dashboard();
  const { root, timestamp } = scenarioContext();
  let reloaded = false;

  before(async () => {
    await dashboard.open();
  });

  after(async () => {
    await assertFixturesUnchanged(root, timestamp, reloaded);
    const runtime = await fs.readFile(fixturePaths(root).runtimeLog, 'utf8');
    assert.match(runtime, /\[extension\] activate/);
    assert.match(runtime, /\[panel\] parse-complete/);
    assert.match(runtime, /\[panel\] warmUp-done/);
    assert.doesNotMatch(runtime, /uncaught-exception|unhandled-rejection|loadData-error|rules-load-error|metrics-load-error/);
  });

  it('activates the installed extension and renders real worker results', async () => {
    await dashboard.expectStats(INITIAL_COUNTS);
    await dashboard.waitForText('#content', 'Local Agent');
    await dashboard.snapshot('01-dashboard', 'Dashboard: 2 sessions and 6 requests from synthetic logs');
  });

  it('navigates to the timeline and displays a synthetic session', async () => {
    await dashboard.navigate('timeline', 'Timeline');
    await dashboard.waitForText('#timelineStats', '2 sessions');
    await dashboard.waitForText('#timelineStats', '6 requests');
    await dashboard.click('.timeline-lane');
    await dashboard.waitForText('#timelineDetail', FIRST_PROMPT);
    await dashboard.expectHealthy();
    await dashboard.snapshot('02-timeline', 'Timeline: synthetic session details');
  });

  it('loads the Output page through the real webview message bridge', async () => {
    await dashboard.navigate('output', 'Output');
    await dashboard.waitForText('#content', 'AI-Generated LoC');
    await dashboard.expectHealthy();
    await dashboard.snapshot('03-output', 'Output: analysis through the real webview message bridge');
  });

  it('reloads changed files without retaining stale results or duplicating sessions', async () => {
    await addReloadFixture(root, timestamp);
    reloaded = true;
    await dashboard.command('Reload Data');
    await dashboard.click('[data-page="dashboard"]');
    await dashboard.expectStats(RELOADED_COUNTS);
    const log = fixturePaths(root).runtimeLog;
    const parsesBefore = (await fs.readFile(log, 'utf8')).match(/\[panel\] parse-complete/g)?.length ?? 0;
    await dashboard.command('Reload Data');
    await VSBrowser.instance.driver.wait(async () =>
      ((await fs.readFile(log, 'utf8')).match(/\[panel\] parse-complete/g)?.length ?? 0) > parsesBefore,
    60_000, 'Reload should run the parse worker again');
    await dashboard.expectStats(RELOADED_COUNTS);
    const runtime = await fs.readFile(log, 'utf8');
    assert.match(runtime, /\[extension\] command-reload/);
    assert.match(runtime, /\[panel\] parse-complete[^\n]*sessions=3/);
    await dashboard.snapshot('04-reloaded', 'Reloaded twice: 3 sessions and 9 requests, without duplicates');
  });

  it('reopens the dashboard with the same data', async () => {
    await dashboard.close();
    await dashboard.open();
    await dashboard.expectStats(RELOADED_COUNTS);
    await dashboard.snapshot('05-reopened', 'Reopened dashboard: the same 3 sessions and 9 requests');
  });
});
