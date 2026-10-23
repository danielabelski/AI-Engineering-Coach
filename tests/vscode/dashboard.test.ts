/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from 'vscode-extension-tester';
import { Dashboard } from './dashboard';

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn<(title: string) => Promise<void>>(),
  defaultContent: vi.fn<() => Promise<void>>(),
  switchToFrame: vi.fn<(timeout: number) => Promise<void>>(),
  documentId: vi.fn<() => Promise<string>>(),
  editorReady: vi.fn<() => Promise<boolean>>(),
  wait: vi.fn<(condition: () => Promise<boolean>, timeout: number, message?: string) => Promise<boolean>>(),
}));

vi.mock('vscode-extension-tester', async importOriginal => {
  const actual = await importOriginal<typeof import('vscode-extension-tester')>();
  return {
    ...actual,
    VSBrowser: { instance: { driver: {
      switchTo: () => ({ defaultContent: mocks.defaultContent }),
      findElement: () => ({ getId: mocks.documentId }),
      wait: mocks.wait,
    } } },
    Workbench: class { executeCommand = mocks.executeCommand; },
    WebView: class { switchToFrame = mocks.switchToFrame; },
    until: { ...actual.until, elementLocated: () => mocks.editorReady },
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.executeCommand.mockResolvedValue();
  mocks.defaultContent.mockResolvedValue();
  mocks.switchToFrame.mockResolvedValue();
  mocks.documentId.mockResolvedValue('initial-document');
  mocks.editorReady.mockResolvedValue(true);
  mocks.wait.mockImplementation(async (condition, _timeout, message) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await condition()) return true;
    }
    throw new Error(message ?? 'Wait timed out');
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('desktop webview synchronization', () => {
  it('opens the dashboard once and waits for its editor before entering the webview', async () => {
    await new Dashboard().open();
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('AI Engineer Coach: Open Dashboard');
    expect(mocks.editorReady.mock.invocationCallOrder[0]).toBeLessThan(mocks.switchToFrame.mock.invocationCallOrder[0]);
    expect(mocks.switchToFrame).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['stale frame', new error.StaleElementReferenceError('The inner frame was replaced')],
    ['missing frame', new error.NoSuchFrameError('The inner frame was removed')],
    ['missing document', new error.NoSuchElementError('The document was removed')],
  ])('reacquires a %s without executing the reload command again', async (_name, failure) => {
    const dashboard = new Dashboard();
    await dashboard.open();
    vi.clearAllMocks();
    mocks.documentId.mockResolvedValueOnce('initial-document').mockResolvedValue('replacement-document');
    mocks.switchToFrame.mockRejectedValueOnce(failure);

    await dashboard.command('Reload Data');

    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('AI Engineer Coach: Reload Data');
    expect(mocks.switchToFrame).toHaveBeenCalledTimes(2);
    const resets = mocks.defaultContent.mock.invocationCallOrder;
    expect(resets.at(-1)).toBeGreaterThan(mocks.switchToFrame.mock.invocationCallOrder[0]);
    expect(resets.at(-1)).toBeLessThan(mocks.switchToFrame.mock.invocationCallOrder[1]);
  });

  it('does not accept the old document while a reload is still being delivered', async () => {
    const dashboard = new Dashboard();
    await dashboard.open();
    vi.clearAllMocks();
    mocks.documentId.mockResolvedValueOnce('initial-document')
      .mockResolvedValueOnce('initial-document').mockResolvedValue('replacement-document');

    await dashboard.command('Reload Data');

    expect(mocks.switchToFrame).toHaveBeenCalledTimes(2);
    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('uses the remaining deadline rather than restarting the timeout after a stale frame', async () => {
    mocks.switchToFrame.mockRejectedValueOnce(new error.StaleElementReferenceError());
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValue(1100);

    await new Dashboard().open();

    expect(mocks.switchToFrame.mock.calls).toEqual([[60_000], [59_900]]);
  });
});

describe('desktop webview failures', () => {
  it('fails if a reload never replaces the document', async () => {
    const dashboard = new Dashboard();
    await dashboard.open();
    vi.clearAllMocks();

    await expect(dashboard.command('Reload Data')).rejects.toThrow('replacement webview');

    expect(mocks.executeCommand).toHaveBeenCalledTimes(1);
  });

  it('does not retry unexpected driver failures', async () => {
    const failure = new Error('Driver session disconnected');
    mocks.switchToFrame.mockRejectedValueOnce(failure);

    await expect(new Dashboard().open()).rejects.toBe(failure);

    expect(mocks.switchToFrame).toHaveBeenCalledTimes(1);
  });
});
