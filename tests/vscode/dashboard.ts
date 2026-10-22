/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { By, EditorView, error, until, VSBrowser, WebView, Workbench } from 'vscode-extension-tester';

const READY_TIMEOUT = 60_000;

export class Dashboard {
  private currentWebview: WebView | undefined;

  private get webview(): WebView {
    return this.currentWebview ??= new WebView();
  }

  async command(title: string): Promise<void> {
    await VSBrowser.instance.driver.switchTo().defaultContent();
    await new Workbench().executeCommand(`AI Engineer Coach: ${title}`);
    // Page-object constructors resolve immediately; wait until the editor exists first.
    await VSBrowser.instance.driver.wait(until.elementLocated(By.css('.editor-instance')), READY_TIMEOUT);
    this.currentWebview = new WebView();
    await this.webview.switchToFrame(READY_TIMEOUT);
  }

  async open(): Promise<void> {
    await this.command('Open Dashboard');
  }

  async close(): Promise<void> {
    await VSBrowser.instance.driver.switchTo().defaultContent();
    const editors = new EditorView();
    await editors.closeEditor('AI Engineer Coach');
    await VSBrowser.instance.driver.wait(async () =>
      !(await editors.getOpenEditorTitles()).includes('AI Engineer Coach'), READY_TIMEOUT);
    this.currentWebview = undefined;
  }

  async waitForText(selector: string, expected: string, exact = false): Promise<void> {
    await VSBrowser.instance.driver.wait(async () => {
      try {
        const elements = await this.webview.findWebElements(By.css(selector));
        for (const element of elements) {
          const text = (await element.getText()).toLowerCase();
          const target = expected.toLowerCase();
          if (exact ? text === target : text.includes(target)) return true;
        }
        return false;
      } catch (err: unknown) {
        if (err instanceof error.StaleElementReferenceError || err instanceof error.NoSuchElementError) return false;
        throw err;
      }
    }, READY_TIMEOUT, `Expected ${selector} to ${exact ? 'equal' : 'contain'} ${JSON.stringify(expected)}`);
  }

  async click(selector: string): Promise<void> {
    await VSBrowser.instance.driver.wait(async () => {
      const elements = await this.webview.findWebElements(By.css(selector));
      return elements.length > 0 && await elements[0].isDisplayed();
    }, READY_TIMEOUT, `Expected visible control: ${selector}`);
    await (await this.webview.findWebElement(By.css(selector))).click();
  }

  async expectStats(expected: Record<string, string>): Promise<void> {
    for (const [label, value] of Object.entries(expected)) {
      await VSBrowser.instance.driver.wait(async () => {
        try {
          for (const stat of await this.webview.findWebElements(By.css('.dash-stat'))) {
            if ((await stat.findElement(By.css('.dash-stat-lbl')).getText()).toLowerCase() === label.toLowerCase()) {
              return await stat.findElement(By.css('.dash-stat-val')).getText() === value;
            }
          }
          return false;
        } catch (err: unknown) {
          if (err instanceof error.StaleElementReferenceError || err instanceof error.NoSuchElementError) return false;
          throw err;
        }
      }, READY_TIMEOUT, `Expected dashboard ${label}: ${value}`);
    }
    await this.expectHealthy();
  }

  async navigate(page: string, heading: string): Promise<void> {
    await this.click(`[data-page="${page}"]`);
    await this.waitForText('#content h1', heading, true);
  }

  async expectHealthy(): Promise<void> {
    const problems = await this.webview.findWebElements(By.css('.error-boundary, .error, .loading-screen, .loading-spinner'));
    for (const problem of problems) {
      if (await problem.isDisplayed()) throw new Error(`Dashboard is not ready: ${await problem.getText()}`);
    }
  }
}
