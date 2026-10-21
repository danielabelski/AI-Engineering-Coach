/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./shared', () => ({ rpc: mocks.rpc }));

type CapabilitiesModule = typeof import('./capabilities');

/** Fresh module per test: capabilities are module-level state. */
async function loadModule(): Promise<CapabilitiesModule> {
  vi.resetModules();
  return import('./capabilities');
}

function pushFromHost(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('webview capabilities', () => {
  it('hides language model features when the VS Code host reports no Copilot model', async () => {
    const caps = await loadModule();
    const listener = vi.fn();
    caps.onCapabilitiesChanged(listener);
    mocks.rpc.mockResolvedValue({ host: 'vscode', llm: false });

    await caps.loadCapabilities();

    expect(mocks.rpc).toHaveBeenCalledWith('getCapabilities');
    expect(caps.llmAvailable()).toBe(false);
    expect(listener).toHaveBeenCalledWith({ host: 'vscode', llm: false });
    expect(caps.llmUnavailableNote()).toBe('Sign in to GitHub Copilot in VS Code to use this.');
  });

  it('keeps full capabilities when the probe RPC fails', async () => {
    const caps = await loadModule();
    mocks.rpc.mockRejectedValue(new Error('RPC timeout: getCapabilities'));

    await caps.loadCapabilities();

    expect(caps.llmAvailable()).toBe(true);
    expect(caps.capabilities()).toEqual({ host: 'vscode', llm: true });
  });

  it('points canvas users to VS Code', async () => {
    const caps = await loadModule();
    mocks.rpc.mockResolvedValue({ host: 'canvas', llm: false });

    await caps.loadCapabilities();

    expect(caps.capabilities()).toEqual({ host: 'canvas', llm: false });
    expect(caps.llmUnavailableNote()).toBe('Open in VS Code with the local Copilot agent to use this.');
  });
});

describe('capabilities pushed by the host', () => {
  it('follows availability changes and ignores repeats', async () => {
    const caps = await loadModule();
    mocks.rpc.mockResolvedValue({ host: 'vscode', llm: true });
    await caps.loadCapabilities();
    const listener = vi.fn();
    caps.onCapabilitiesChanged(listener);

    pushFromHost({ type: 'capabilities', host: 'vscode', llm: false });
    expect(caps.llmAvailable()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    pushFromHost({ type: 'capabilities', host: 'vscode', llm: false });
    pushFromHost({ type: 'response', id: '1', data: { llm: true } });
    expect(listener).toHaveBeenCalledTimes(1);

    pushFromHost({ type: 'capabilities', host: 'vscode', llm: true });
    expect(caps.llmAvailable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops notifying after unsubscribe', async () => {
    const caps = await loadModule();
    mocks.rpc.mockResolvedValue({ host: 'vscode', llm: true });
    await caps.loadCapabilities();
    const listener = vi.fn();
    const unsubscribe = caps.onCapabilitiesChanged(listener);

    unsubscribe();
    pushFromHost({ type: 'capabilities', host: 'vscode', llm: false });

    expect(listener).not.toHaveBeenCalled();
    expect(caps.llmAvailable()).toBe(false);
  });
});
