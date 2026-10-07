import { test, expect, type Page } from '@playwright/test';
import type { CuriosityData } from '../../src/core/types/curiosity-types';
import { curiosityBalance } from '../../src/core/curiosity-balance';

const URL = 'http://localhost:3999/tests/e2e/harness?page=curiosity';
type MockWindow = Window & {
  getMockData: (method: string, params: Record<string, unknown>) => unknown;
  curiosityParams?: Record<string, unknown>;
  curiosityCalls?: Record<string, unknown>[];
  mockResponseDelay?: (method: string, params: Record<string, unknown>) => number;
  curiosityAxis?: { text: string; color: string }[];
  curiosityPoints?: { x: number; y: number }[];
  curiosityCurveStarts?: number[];
  previewHides?: number;
};
const values = '.curiosity-summary dd > strong';
const badgeProperties = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-variant-numeric',
  'line-height', 'letter-spacing', 'border-radius', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'display'];

async function patchCuriosity(page: Page, patch: Partial<CuriosityData>): Promise<void> {
  await page.evaluate(patch => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => {
      const data = original(method, params);
      return method === 'getCuriosity' ? { ...(data as CuriosityData), ...patch } : data;
    };
  }, patch);
}
async function dataFor(page: Page): Promise<CuriosityData> {
  return page.evaluate(() => (window as MockWindow).getMockData('getCuriosity', {}) as CuriosityData);
}
function captureChartText(page: Page) {
  return page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof original>) {
      if (this.canvas.id === 'curiosityBalance' && typeof this.fillStyle === 'string') {
        ((window as MockWindow).curiosityAxis ??= []).push({ text: args[0], color: this.fillStyle });
      }
      original.apply(this, args);
    };
  });
}

function captureSharePoints(page: Page) {
  return page.addInitScript(() => {
    const arc = CanvasRenderingContext2D.prototype.arc;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    const move = Path2D.prototype.moveTo;
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    const starts = new WeakMap<Path2D, number[]>();
    const shareContext = (context: CanvasRenderingContext2D) => {
      const target = document.querySelector('#curiosity-results');
      return context.canvas.id === 'curiosityBalance' && target
        && context.strokeStyle === getComputedStyle(target).getPropertyValue('--curiosity-share').trim();
    };
    CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof clear>) {
      if (this.canvas.id === 'curiosityBalance') {
        (window as MockWindow).curiosityPoints = [];
        (window as MockWindow).curiosityCurveStarts = [];
      }
      clear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.arc = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof arc>) {
      if (args[2] === 2 && shareContext(this)) {
        ((window as MockWindow).curiosityPoints ??= []).push({ x: args[0], y: args[1] });
      }
      arc.apply(this, args);
    };
    Path2D.prototype.moveTo = function (this: Path2D, ...args: Parameters<typeof move>) {
      starts.set(this, [...starts.get(this) ?? [], args[0]]);
      move.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.stroke = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof stroke>) {
      if (this.lineWidth === 2 && shareContext(this) && args[0] instanceof Path2D) {
        ((window as MockWindow).curiosityCurveStarts ??= []).push(...starts.get(args[0]) ?? []);
      }
      stroke.apply(this, args);
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
});

test('shows a compact overview, exact totals, SVGs and no inline activity evidence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(URL);
  await expect(page.locator(values)).toHaveText(['3', '8', '2']);
  await expect(page.locator('.curiosity-summary')).toContainText('/ 3 100%');
  await expect(page.locator('.curiosity-summary > div').first()).toHaveAttribute('title', /3 inquiry sessions also included Build turns/);
  await expect(page.locator('.curiosity-summary')).toContainText('66.7% of classified turns');
  await expect(page.locator('.curiosity-tabs, .curiosity-flow, .curiosity-pathways, .curiosity-reading, .curiosity-footer, .curiosity-filters')).toHaveCount(0);
  await expect(page.locator('#curiosity-results select')).toHaveCount(0);
  for (const removed of ['How this is measured', 'Pathways', 'Inquiry alongside project work',
    'File context, not question topic. Rows overlap.', 'coverage', 'unique human turns', 'Balance checks need',
    'Hover a bar for session names', 'View periods']) {
    await expect(page.locator('#curiosity-results')).not.toContainText(removed);
  }
  await expect(page.locator('.curiosity-summary button')).toHaveCount(0);
  await expect(page.locator('#curiosity-results')).not.toContainText('Loading recorded activity');
  await expect(page.locator('#curiosity-evidence')).toHaveCount(0);
  await expect(page.locator('.curiosity-source-icon svg')).toHaveCount(3);
  await expect(page.locator('.curiosity-language-icon, .curiosity-language-list svg')).toHaveCount(0);
  await expect(page.locator('.curiosity-languages')).toContainText('Files touched in each session');
  await expect(page.getByRole('heading', { name: 'How your answers were grounded', exact: true })).toBeVisible();
  await expect(page.locator('.curiosity-legend')).toContainText('Model knowledge inquiry');
  await expect(page.locator('.curiosity-legend')).toContainText('Web-grounded inquiry');
  await expect(page.locator('#curiosity-results')).not.toContainText('Direct inquiry');
  await expect(page.locator('#curiosity-results')).not.toContainText('Exploratory search');
  expect(errors).toEqual([]);
});

test('previews recent follow-ups with elapsed spans on pointer hover and keyboard focus', async ({ page }) => {
  await page.goto(URL);
  const target = page.locator('[aria-label="Preview follow-up sequences"]');
  const overlay = page.getByRole('tooltip');
  await target.hover();
  await expect(target).toHaveCSS('cursor', 'pointer');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('h3')).toHaveText('Follow-up sequences');
  await expect(overlay.locator('.curiosity-hover-duration')).toHaveText([
    '~2 min elapsed / 2 inquiry turns', '~5 min elapsed / 5 inquiry turns',
  ]);
  await expect(overlay.locator('.curiosity-hover-duration').first()).toHaveAttribute('title', /Includes response time and pauses, not active learning time/);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await target.focus();
  await expect(overlay).toBeVisible();
  await page.locator('.curiosity-language-list button').first().focus();
  await expect(overlay).toContainText('~2 min elapsed / 2 inquiry turns');
});

test('shows only the latest sampled follow-up per session and omits missing timing', async ({ page }) => {
  await page.goto(URL);
  const data = await dataFor(page);
  const latest = data.chains.examples[0];
  await patchCuriosity(page, { chains: { ...data.chains, total: 3, examples: [
    { ...latest, elapsedMs: 30_000 },
    { ...data.chains.examples[1], elapsedMs: undefined },
    { ...latest, elapsedMs: 90_000 },
  ] } });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await page.locator('[aria-label="Preview follow-up sequences"]').focus();
  const overlay = page.getByRole('tooltip');
  await expect(overlay.locator('li')).toHaveCount(2);
  await expect(overlay.locator('.curiosity-hover-duration')).toHaveText(['<1 min elapsed / 2 inquiry turns']);
  await expect(overlay).not.toContainText('~2 min');
  await expect(overlay).not.toContainText('~0 min');
});

test('does not attach elapsed spans to sessions without a sampled follow-up', async ({ page }) => {
  await page.goto(URL);
  const data = await dataFor(page);
  await patchCuriosity(page, { chains: { ...data.chains, total: 0, sustained: 0, examples: [] } });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await page.locator('.curiosity-legend > span').first().focus();
  await expect(page.getByRole('tooltip').locator('li')).toHaveCount(2);
  await expect(page.locator('.curiosity-hover-duration')).toHaveCount(0);
  await page.locator('[aria-label="Preview follow-up sequences"]').focus();
  await expect(page.getByRole('tooltip')).toContainText('No recent sessions recorded.');
});

test('uses the standard five date-range buttons with exact selected bounds', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => {
      if (method === 'getCuriosity' && !params.toDate) root.curiosityParams = params;
      return original(method, params);
    };
  });
  const range = page.getByRole('group', { name: 'Date range', exact: true });
  await expect(range).toHaveClass(/cons-range-bar/);
  await expect(range.getByRole('button')).toHaveText(['Last 7 days', 'Last 4 weeks', 'Last 3 months', 'Last 6 months', 'All time']);
  for (const days of [7, 28, 90, 180, 0]) {
    await range.locator(`[data-range="${days}"]`).click();
    await expect(range.locator('.active')).toHaveAttribute('data-range', String(days));
    await expect(range.locator('[aria-pressed="true"]')).toHaveCount(1);
    const expected = days ? { fromDate: new Date(Date.UTC(2026, 8, 30) - (days - 1) * 86_400_000).toISOString().slice(0, 10) } : {};
    await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityParams)).toEqual(expected);
  }
  expect(await dataFor(page)).not.toHaveProperty('pathways');
});

test('matches exact Anti-Patterns category-card badge styles, bounds and row alignment', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => {
      const data = original(method, params) as CuriosityData;
      if (method !== 'getCuriosity') return data;
      const priorWeek = params.fromDate === '2026-09-17';
      const priorMonth = params.fromDate === '2026-08-06';
      const inquiry = priorWeek ? 10 : priorMonth ? 40 : 20;
      return { ...data, counts: { direct: inquiry, web: 0, repository: 0, action: 100 - inquiry },
        coverage: { ...data.coverage, human: 100, classified: 100 },
        sessionCounts: { ...data.sessionCounts, human: 20, inquiry: priorWeek ? 4 : priorMonth ? 12 : 6 },
        chains: { ...data.chains, total: priorWeek ? 2 : priorMonth ? 6 : 3 } };
    };
  });
  await page.getByRole('button', { name: 'Last 4 weeks', exact: true }).click();
  await expect(page.locator(values)).toHaveText(['6', '20', '3']);
  await expect(page.locator('.curiosity-summary-trends .trend-badge')).toHaveText([
    '+50% WoW', '-50% MoM', '+100% WoW', '-50% MoM', '+50% WoW', '-50% MoM',
  ]);
  await expect(page.locator('.curiosity-summary-trends .trend-improving')).toHaveCount(3);
  await expect(page.locator('.curiosity-summary-trends .trend-worsening')).toHaveCount(3);
  await expect(page.locator('.curiosity-summary-trends > .trend-badge')).toHaveCount(6);
  await expect(page.locator('.curiosity-summary-trends').first().locator('[title]').first())
    .toHaveAttribute('title', /6 \(2026-09-24 to 2026-09-30\) compared with 4 \(2026-09-17 to 2026-09-23\)/);
  const curiosityStyles = await page.locator('.curiosity-summary-trends .trend-badge').evaluateAll((elements, properties) =>
    elements.slice(0, 2).map(element => Object.fromEntries(properties.map(key => [key, getComputedStyle(element).getPropertyValue(key)]))),
    badgeProperties);
  const rowBounds = (row: Element) => {
    const bounds = row.getBoundingClientRect();
    const badges = [...row.children].map(element => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height, top: box.top - bounds.top };
    });
    const [first, second] = [...row.children].map(element => element.getBoundingClientRect());
    return { width: bounds.width, height: bounds.height, gap: second.left - first.right, badges };
  };
  const curiosityBounds = await page.locator('.curiosity-summary-trends').first().evaluate(rowBounds);
  await page.getByRole('link', { name: /Anti-Patterns/ }).click();
  const category = page.locator('.ap-score-card[data-group="prompt-quality"]');
  await expect(category.locator('.ap-score-deltas .trend-badge').first()).toBeVisible();
  const antiPatternStyles = await category.locator('.ap-score-deltas .trend-badge').evaluateAll((elements, properties) =>
    elements.slice(0, 2).map(element => Object.fromEntries(properties.map(key => [key, getComputedStyle(element).getPropertyValue(key)]))),
    badgeProperties);
  expect(curiosityStyles).toEqual([antiPatternStyles[1], antiPatternStyles[0]]);
  // Match content and available width before comparing the rendered pill layout.
  await category.locator('.ap-score-deltas').evaluate((row, width) => {
    (row as HTMLElement).style.width = `${width}px`;
    row.children[0].textContent = '+50% WoW';
    row.children[0].className = 'trend-badge trend-improving';
    row.children[1].textContent = '-50% MoM';
    row.children[1].className = 'trend-badge trend-worsening';
  }, curiosityBounds.width);
  expect(await category.locator('.ap-score-deltas').evaluate(rowBounds)).toEqual(curiosityBounds);
});

test('does not invent percentages when previous activity is missing', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('.curiosity-summary-trends .trend-badge')).toHaveText([
    '-- WoW', '-- MoM', '-- WoW', '-- MoM', '-- WoW', '-- MoM',
  ]);
  await expect(page.locator('.curiosity-summary-trends').first().locator('[title]').first())
    .toHaveAttribute('title', /No prior recorded activity/);
  await expect(page.locator('.curiosity-summary-trends .trend-improving, .curiosity-summary-trends .trend-worsening')).toHaveCount(0);
});

test('shows New rather than infinity when previous recorded activity has zero inquiries', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => {
      const data = original(method, params) as CuriosityData;
      return method === 'getCuriosity' && (params.fromDate === '2026-09-17' || params.fromDate === '2026-08-06')
        ? { ...data, coverage: { ...data.coverage, human: 8, classified: 8 },
          counts: { direct: 0, web: 0, repository: 0, action: 8 },
          sessionCounts: { human: 1, inquiry: 0, action: 1, mixed: 0 },
          chains: { ...data.chains, total: 0 } } : data;
    };
  });
  await page.getByRole('button', { name: 'Last 4 weeks', exact: true }).click();
  await expect(page.locator('.curiosity-summary-trends .trend-badge')).toHaveText([
    'New WoW', 'New MoM', 'New WoW', 'New MoM', 'New WoW', 'New MoM',
  ]);
  await expect(page.locator('#curiosity-results')).not.toContainText(/Infinity|NaN/);
});

test('surfaces a failed trend request instead of displaying a success-shaped comparison', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator(values)).toHaveText(['3', '8', '2']);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => method === 'getCuriosity' && params.fromDate === '2026-08-06'
      ? { error: 'Comparison unavailable' } : original(method, params);
  });
  await page.getByRole('button', { name: 'Last 4 weeks', exact: true }).click();
  await expect(page.locator('.error-boundary')).toContainText('Comparison unavailable');
  await expect(page.locator('.curiosity-summary-trends')).toHaveCount(0);
});

test('ignores a late comparison error after leaving Curiosity', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator(values)).toHaveText(['3', '8', '2']);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => method === 'getCuriosity' && params.fromDate === '2026-08-06'
      ? { error: 'Stale comparison failed' } : original(method, params);
    root.mockResponseDelay = (method, params) =>
      method === 'getCuriosity' && params.fromDate === '2026-08-06' ? 500 : 5;
  });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await page.waitForTimeout(100);
  await page.locator('#sidebar [data-page="timeline"]').click();
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.locator('.error-boundary')).toHaveCount(0);
});

test('shows real session names on source hover and keeps research within project work separate', async ({ page }) => {
  await page.goto(URL);
  const web = page.getByRole('region', { name: 'Recorded investigation sources' }).getByRole('button', { name: /Web sources/ });
  await web.hover();
  await expect(page.getByRole('tooltip')).toContainText('How does recursion use the stack?');
  await expect(page.getByRole('tooltip')).toContainText('What does the Python reference say?');
  await web.click();
  await expect(page.locator('.curiosity-trend')).toContainText('7 recorded turns; 1 during Build turns');
  await expect(page.locator(values)).toHaveText(['3', '8', '2']);
  await expect(page.locator('#content')).not.toContainText('Program comprehension evidence');
});

test('chart hover renders session names instead of a turn-count-only tooltip', async ({ page }) => {
  await captureChartText(page);
  await page.goto(URL);
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityAxis?.length ?? 0)).toBeGreaterThan(0);
  const canvas = page.locator('#curiosityBalance');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await canvas.hover({ position: { x: bounds!.width / 2, y: bounds!.height - 45 } });
  const overlay = page.getByRole('tooltip');
  await expect(overlay).toContainText(/How does recursion use the stack\?|Why does the parser fail\?/);
  await expect(overlay.locator('.curiosity-hover-heading p')).toHaveText('Sep 28 - Sep 30');
  await expect(overlay).not.toContainText('2026-09');
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityAxis?.some(item =>
    item.text === 'How does recursion use the stack?' || item.text === 'Why does the parser fail?'))).toBe(false);
  await overlay.hover();
  await page.waitForTimeout(220);
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});

test('overlays the same exact Explore share in both chart views and previews counts and sessions', async ({ page }) => {
  await captureSharePoints(page);
  await captureChartText(page);
  await page.goto(URL);
  const legend = page.locator('.curiosity-share-legend');
  await expect(legend).toHaveText('Explore share66.7%');
  await expect(legend).toHaveAttribute('title', /all inquiry turns.*all inquiry \+ Build turns.*Unclassified turns are excluded/);
  await expect(page.locator('.curiosity-legend')).toContainText('Build4');
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityPoints?.length)).toBe(1);
  const points = await page.evaluate(() => (window as MockWindow).curiosityPoints!);
  const canvas = page.locator('#curiosityBalance');
  await canvas.hover({ position: points[0] });
  const overlay = page.getByRole('tooltip');
  await expect(overlay.getByRole('heading')).toHaveText('Explore share');
  await expect(overlay).toContainText('66.7% Explore / 33.3% Build; 8 Explore + 4 Build turns');
  await expect(overlay).toContainText('How does recursion use the stack?');
  await expect(overlay).toContainText('What does the Python reference say?');
  await expect(canvas).toHaveCSS('cursor', 'pointer');
  await overlay.hover();
  await page.waitForTimeout(220);
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await page.getByRole('button', { name: 'All turns', exact: true }).click();
  await expect(legend).toHaveText('Explore share66.7%');
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityPoints?.length)).toBe(1);
  const all = (await page.evaluate(() => (window as MockWindow).curiosityPoints!))[0];
  expect(all.y).toBeCloseTo(points[0].y, 1);
  await expect.poll(() => page.evaluate(() => {
    const labels = (window as MockWindow).curiosityAxis ?? [];
    return ['0%', '50%', '100%'].every(text => labels.some(item => item.text === text));
  })).toBe(true);
  await canvas.press('ArrowRight');
  await expect(overlay).toContainText('66.7% Explore / 33.3% Build');
});

test('connects recorded points across empty dates without adding values and exposes Build-only periods', async ({ page }) => {
  await captureSharePoints(page);
  await page.goto(URL);
  const data = await dataFor(page);
  await patchCuriosity(page, {
    counts: { direct: 2, web: 4, repository: 6, action: 22 },
    daily: [
      { date: '2026-09-27', counts: { direct: 1, web: 2, repository: 3, action: 0 } },
      { date: '2026-09-28', counts: { direct: 1, web: 2, repository: 3, action: 18 } },
      { date: '2026-09-29', counts: { direct: 0, web: 0, repository: 0, action: 0 } },
      { date: '2026-09-30', counts: { direct: 0, web: 0, repository: 0, action: 4 },
        sessions: { direct: [], web: [], repository: [], action: data.research.web.sessionSamples } },
    ],
  });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await expect(page.locator('.curiosity-share-legend')).toHaveText('Explore share35.3%');
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityPoints?.length)).toBe(3);
  const points = await page.evaluate(() => (window as MockWindow).curiosityPoints!);
  const sorted = points.toSorted((a, b) => a.x - b.x);
  expect(sorted[0].y).toBeLessThan(sorted[1].y);
  expect(sorted[1].y).toBeLessThan(sorted[2].y);
  expect((sorted[2].y - sorted[1].y) / (sorted[2].y - sorted[0].y)).toBeCloseTo(0.25, 4);
  expect((sorted[2].x - sorted[1].x) / (sorted[1].x - sorted[0].x)).toBeCloseTo(2, 4);
  expect(await page.evaluate(() => (window as MockWindow).curiosityCurveStarts)).toEqual([sorted[0].x]);
  const canvas = page.locator('#curiosityBalance');
  await canvas.hover({ position: sorted[2] });
  const overlay = page.getByRole('tooltip');
  await expect(overlay).toContainText('0% Explore / 100% Build; 0 Explore + 4 Build turns');
  await page.keyboard.press('Escape');
  await canvas.press('ArrowLeft');
  await expect(overlay).toContainText('2026-09-30 to 2026-09-30');
  await expect(overlay).toContainText('0% Explore / 100% Build');
  await expect(overlay).toContainText('How does recursion use the stack?');
  await canvas.press('ArrowLeft');
  await expect(overlay).toContainText('2026-09-28 to 2026-09-28');
  await expect(overlay).toContainText('25% Explore / 75% Build');
});

test('uses a hand cursor and keeps chart previews clear of the pointer without blinking', async ({ page }) => {
  await page.goto(URL);
  const canvas = page.locator('#curiosityBalance');
  await expect(canvas).toBeVisible();
  const bounds = (await canvas.boundingBox())!;
  const position = { x: bounds.width / 2, y: bounds.height - 45 };
  await canvas.hover({ position });
  const overlay = page.getByRole('tooltip');
  await expect(overlay).toBeVisible();
  await expect(canvas).toHaveCSS('cursor', 'pointer');
  const preview = (await overlay.boundingBox())!;
  expect(preview.x).toBeGreaterThan(bounds.x + position.x + 16);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const overlay = document.querySelector<HTMLElement>('#curiosity-hover')!;
    root.previewHides = 0;
    new MutationObserver(() => { if (overlay.hidden) root.previewHides!++; })
      .observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  });
  for (const offset of [2, -2, 4, -4, 0]) {
    await canvas.hover({ position: { x: position.x + offset, y: position.y } });
    await page.waitForTimeout(150);
    await expect(overlay).toBeVisible();
  }
  expect(await page.evaluate(() => (window as MockWindow).previewHides)).toBe(0);
  await page.getByRole('heading', { name: 'Curiosity', exact: true }).hover();
  await expect(overlay).toBeHidden();
  await expect(canvas).toHaveCSS('cursor', 'default');
  await expect(page.locator('.curiosity-legend > span').first()).toHaveCSS('cursor', 'pointer');
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`keeps long chart previews off their bar at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(URL);
    const data = await dataFor(page);
    const counts = { direct: 100, web: 0, repository: 0, action: 0 };
    await patchCuriosity(page, { counts, coverage: { ...data.coverage, classified: 100, human: 100 },
      daily: [{ date: '2026-09-30', counts, sessions: {
        direct: Array.from({ length: 8 }, (_, index) => ({ ...data.research.web.sessionSamples[0],
          sessionId: `long-${index}`, name: 'Explain the state transitions and cache invalidation in this project. '.repeat(2).slice(0, 80) })),
        web: [], repository: [], action: [],
      } }] });
    await page.getByRole('button', { name: 'All time', exact: true }).click();
    const canvas = page.locator('#curiosityBalance');
    const bounds = (await canvas.boundingBox())!;
    await canvas.hover({ position: { x: bounds.width / 2, y: bounds.height - 45 } });
    const overlay = page.getByRole('tooltip');
    await expect(overlay).toBeVisible();
    await page.waitForTimeout(300);
    await expect(overlay).toBeInViewport({ ratio: 1 });
    const rect = (await overlay.boundingBox())!;
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 45 };
    expect(point.x >= rect.x && point.x <= rect.x + rect.width
      && point.y >= rect.y && point.y <= rect.y + rect.height).toBe(false);
    const samples = await overlay.locator('li').count();
    expect(samples).toBeGreaterThan(0);
    expect(samples).toBeLessThanOrEqual(viewport.width === 390 ? 3 : 5);
    await overlay.hover();
    await page.waitForTimeout(220);
    await expect(overlay).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });
}

test('selects daily, weekly or monthly granularity from the range and actual all-time span', async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByRole('img', { name: 'Weekly Explore turns with Explore share on a 0 to 100 percent scale', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All turns', exact: true }).click();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await page.getByRole('button', { name: 'All turns', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Daily Explore and Build turns with Explore share on a 0 to 100 percent scale', exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Chart measure"] button')).toHaveText(['Explore', 'All turns']);
  await expect(page.getByRole('button', { name: 'Turn share', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Chart interval', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Daily|Weekly|View periods)$/ })).toHaveCount(0);
  for (const [range, interval] of [['Last 4 weeks', 'Weekly'], ['Last 3 months', 'Weekly'], ['Last 6 months', 'Monthly'], ['All time', 'Daily']]) {
    await page.getByRole('button', { name: range, exact: true }).click();
    await expect(page.getByRole('img', { name: `${interval} Explore turns with Explore share on a 0 to 100 percent scale`, exact: true })).toBeVisible();
  }
});

test('loads whole-week session names with a scoped RPC and leaves global totals unchanged', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => {
      if (method === 'getCuriosity') root.curiosityParams = params;
      return original(method, params);
    };
  });
  await page.locator('#curiosityBalance').press('Enter');
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityParams))
    .toMatchObject({ fromDate: '2026-09-28', toDate: '2026-09-30' });
  await expect(page.locator('.curiosity-session-list')).toContainText('What does the Python reference say?');
  await expect(page.locator(values)).toHaveText(['3', '8', '2']);
  await page.getByRole('button', { name: 'Back to chart', exact: true }).click();
  await expect(page.locator('#curiosityBalance')).toBeVisible();
});

test('ignores a late period response after a new selection', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => {
    (window as MockWindow).mockResponseDelay = (method, params) =>
      method === 'getCuriosity' && params.toDate === '2026-09-28' ? 500 : 5;
  });
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await page.locator('#curiosityBalance').press('ArrowRight');
  await expect(page.getByRole('tooltip')).toContainText('2026-09-28 to 2026-09-28');
  await page.locator('#curiosityBalance').press('Enter');
  await expect(page.locator('.curiosity-trend [role="status"]')).toBeVisible();
  await page.getByRole('button', { name: 'Back to chart', exact: true }).click();
  await page.locator('#curiosityBalance').press('ArrowRight');
  await expect(page.getByRole('tooltip')).toContainText('2026-09-30 to 2026-09-30');
  await page.locator('#curiosityBalance').press('Enter');
  await expect(page.locator('.curiosity-session-list')).toContainText('What does the Python reference say?');
  await page.waitForTimeout(650);
  await expect(page.locator('.curiosity-session-list')).not.toContainText('How does recursion use the stack?');
});

test('shows recoverable session and page errors', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator(values)).toHaveText(['3', '8', '2']);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => method === 'getCuriosity' && params.toDate
      ? { error: 'Period unavailable' } : original(method, params);
  });
  await page.locator('#curiosityBalance').press('Enter');
  await expect(page.locator('.curiosity-trend [role="alert"]')).toContainText('Period unavailable');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => method === 'getCuriosity' ? { error: 'History unavailable' } : original(method, params);
  });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await expect(page.locator('.error-boundary')).toContainText('History unavailable');
});

test('keeps overlapping language context filterable and pages rows without scroll', async ({ page }) => {
  await page.goto(URL);
  await page.locator('.curiosity-language-list').getByRole('button', { name: /Python/ }).click();
  await expect(page.locator(values)).toHaveText(['1', '2', '1']);
  await expect(page.locator('.curiosity-language-list')).toContainText('TypeScript');
  await page.locator('.curiosity-language-list').getByRole('button', { name: /TypeScript/ }).click();
  await expect(page.locator('.curiosity-language-list').getByRole('button', { name: /TypeScript/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(values)).toHaveText(['2', '7', '2']);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator(values)).toHaveText(['3', '8', '2']);
  const data = await dataFor(page);
  await patchCuriosity(page, { languages: Array.from({ length: 11 }, (_, index) => ({
    ...data.languages[0], language: `Language-${index}`,
  })) });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await expect(page.locator('.curiosity-language-list li')).toHaveCount(8);
  await expect(page.getByLabel('Languages pages')).toContainText('1-8 of 11');
  await page.getByRole('button', { name: 'Next languages', exact: true }).click();
  await expect(page.locator('.curiosity-language-list li')).toHaveCount(3);
  await expect(page.getByLabel('Languages pages')).toContainText('9-11 of 11');
  await expect(page.locator('.curiosity-language-list')).not.toContainText('Language-0');
});

for (const viewport of [{ width: 1440, height: 768 }, { width: 1280, height: 800 }]) {
  test(`fits eight language contexts without scrolling at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(URL);
    const data = await dataFor(page);
    await patchCuriosity(page, { languages: Array.from({ length: 16 }, (_, index) => ({
      ...data.languages[0], language: `Language-${index}`,
    })) });
    await page.getByRole('button', { name: 'All time', exact: true }).click();
    await expect(page.locator('.curiosity-language-list li')).toHaveCount(8);
    await expect.poll(() => page.locator('#content, .curiosity-languages, .curiosity-language-list').evaluateAll(elements =>
      elements.filter(element => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)
        .map(element => element.className || element.id))).toEqual([]);
    await expect(page.locator('.curiosity-language-list li').last()).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel('Languages pages')).toBeInViewport({ ratio: 1 });
  });
}

test('passes range, language, workspace and harness through shared RPC', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() => {
    const root = window as MockWindow;
    const original = root.getMockData;
    root.getMockData = (method, params) => {
      if (method === 'getCuriosity') {
        (root.curiosityCalls ??= []).push(params);
        if (!params.toDate) root.curiosityParams = params;
      }
      return original(method, params);
    };
  });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await page.locator('.curiosity-language-list').getByRole('button', { name: /TypeScript/ }).click();
  await page.locator('#harness-filter').selectOption('Local Agent');
  await page.locator('#ws-filter-input').fill('my-api');
  await page.locator('#ws-filter-list [data-value="ws-1"]').click();
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityParams))
    .toEqual({ harness: 'Local Agent', workspaceId: 'ws-1', language: 'TypeScript' });
  await expect(page.locator('.curiosity-summary-trends')).toHaveCount(3);
  const comparisonCalls = await page.evaluate(() => (window as MockWindow).curiosityCalls?.filter(params =>
    params.toDate && params.workspaceId === 'ws-1') ?? []);
  expect(comparisonCalls).toEqual(expect.arrayContaining([
    { harness: 'Local Agent', workspaceId: 'ws-1', language: 'TypeScript', fromDate: '2026-09-24', toDate: '2026-09-30' },
    { harness: 'Local Agent', workspaceId: 'ws-1', language: 'TypeScript', fromDate: '2026-09-17', toDate: '2026-09-23' },
    { harness: 'Local Agent', workspaceId: 'ws-1', language: 'TypeScript', fromDate: '2026-09-03', toDate: '2026-09-30' },
    { harness: 'Local Agent', workspaceId: 'ws-1', language: 'TypeScript', fromDate: '2026-08-06', toDate: '2026-09-02' },
  ]));
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityParams))
    .toMatchObject({ fromDate: '2026-09-24', harness: 'Local Agent', workspaceId: 'ws-1', language: 'TypeScript' });
});

test('keeps source use visible when activity cannot be classified', async ({ page }) => {
  await page.goto(URL);
  const data = await dataFor(page);
  await patchCuriosity(page, { counts: { direct: 0, web: 0, repository: 0, action: 0 },
    coverage: { ...data.coverage, human: 1, classified: 0, unclassified: 1, unscanned: 0 },
    sessionCounts: { human: 1, inquiry: 0, action: 0, mixed: 0 } });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No classified activity in this range' })).toBeVisible();
  await expect(page.locator('.curiosity-research')).toBeVisible();
  await expect(page.locator('.curiosity-balance')).toHaveCount(0);
});

for (const [counts, label] of [
  [{ direct: 10, web: 10, repository: 20, action: 60 }, 'Balanced'],
  [{ direct: 18, web: 1, repository: 1, action: 30 }, 'Needs review'],
  [{ direct: 20, web: 0, repository: 0, action: 30 }, 'Strongly skewed'],
] as const) {
  test(`opens Prompt Quality from ${label} activity without new tabs or a misleading local grade`, async ({ page }) => {
    await page.goto(URL);
    const total = counts.direct + counts.web + counts.repository + counts.action;
    await patchCuriosity(page, { counts, balance: curiosityBalance(counts, total, 7) });
    await page.getByRole('button', { name: 'All time', exact: true }).click();
    const link = page.getByRole('link', { name: 'Curiosity checks', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('title', /dashboard filters.*local date and language/);
    await expect(page.getByRole('link', { name: `Curiosity: ${label}`, exact: true })).toHaveCount(0);
    await expect(page.locator('.curiosity-guidance, [aria-label="Curiosity view"]')).toHaveCount(0);
    await expect(page.locator('#curiosityBalance')).toBeVisible();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ap-group-details').first()).toHaveAttribute('open', '');
    await expect(page.locator('.ap-group-details').first().locator('.ap-group-name')).toHaveText('Prompt Quality');
    await expect(page.locator('.ap-tab')).toHaveText([/Anti-Patterns/, /Rules/]);
  });
}

test('links to Prompt Quality without an extra check view when evidence is insufficient', async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByRole('link', { name: 'Curiosity checks', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Balance & checks', exact: true })).toHaveCount(0);
});

test('supports keyboard session previews for languages and activity labels', async ({ page }) => {
  await page.goto(URL);
  await page.locator('.curiosity-language-list').getByRole('button', { name: /Python/ }).focus();
  await expect(page.getByRole('tooltip').getByRole('heading')).toHaveText('Python');
  await expect(page.getByRole('tooltip')).toContainText('What does the Python reference say?');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await page.locator('.curiosity-legend > span').filter({ hasText: 'Program comprehension' }).focus();
  await expect(page.getByRole('tooltip').getByRole('heading')).toHaveText('Program comprehension');
  await expect(page.getByRole('tooltip').locator('li')).toHaveCount(2);
  await page.getByRole('button', { name: 'All turns', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toBeHidden();
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 760, height: 900 }, { width: 390, height: 844 }]) {
  test(`fits the dashboard without either scroll direction at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(URL);
    await expect(page.locator('.curiosity-summary')).toBeVisible();
    await expect.poll(() => page.locator('#content').evaluate(element =>
      ({ vertical: element.scrollHeight <= element.clientHeight + 1, horizontal: element.scrollWidth <= element.clientWidth + 1 })))
      .toEqual({ vertical: true, horizontal: true });
    for (const section of ['.curiosity-trend', '.curiosity-investigation', '.curiosity-languages']) {
      await expect(page.locator(section)).toBeInViewport({ ratio: 1 });
    }
    expect(await page.locator('#curiosityBalance').evaluate(canvas => (canvas as HTMLCanvasElement).height)).toBeGreaterThan(90);
  });
}

test('makes navigation available in a narrow viewport without consuming dashboard width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  await expect(page.locator('#sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Toggle navigation', exact: true });
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(page.locator('#sidebar a').first()).toBeFocused();
  await page.locator('#sidebar a').first().press('Shift+Tab');
  await expect(page.locator('#sidebar a, #sidebar button:not(:disabled), #sidebar input, #sidebar select').last()).toBeFocused();
  await page.locator('#sidebar a').first().press('Escape');
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(toggle).toBeFocused();
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`wraps long session names and keeps overlays and details within ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(URL);
    const data = await dataFor(page);
    const sessionName = 'Explain the state transitions and cache invalidation in this project. '.repeat(2).slice(0, 80);
    const workspace = 'workspace-with-a-long-recorded-name-'.repeat(2);
    await patchCuriosity(page, {
      research: { ...data.research, web: { ...data.research.web, sessionSamples: Array.from({ length: 8 }, (_, index) => ({
        ...data.research.web.sessionSamples[0], sessionId: `session-${index}`, name: sessionName, workspace,
      })) } },
    });
    await page.getByRole('button', { name: 'All time', exact: true }).click();
    const fits = () => expect.poll(() => page.locator(
      '#content, .curiosity-trend, .curiosity-hover',
    ).evaluateAll(elements => elements.filter(element => element.getClientRects().length
      && (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2))
      .map(element => element.className || element.id))).toEqual([]);
    const source = page.getByRole('region', { name: 'Recorded investigation sources' }).getByRole('button', { name: /Web sources/ });
    await source.hover();
    const overlay = page.getByRole('tooltip');
    expect(await overlay.locator('li').count()).toBeGreaterThan(0);
    expect(await overlay.locator('li').count()).toBeLessThanOrEqual(5);
    await expect(overlay.locator('.curiosity-hover-name').first()).toHaveText(sessionName);
    expect(await overlay.locator('.curiosity-hover-name').first().evaluate(element =>
      element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight))).toBeGreaterThan(1.5);
    await expect(overlay).toBeInViewport({ ratio: 1 });
    const bounds = await overlay.boundingBox();
    const anchor = (await source.boundingBox())!;
    expect(bounds!.x < anchor.x + anchor.width && bounds!.x + bounds!.width > anchor.x
      && bounds!.y < anchor.y + anchor.height && bounds!.y + bounds!.height > anchor.y).toBe(false);
    if (viewport.width === 1280) expect(bounds!.x).toBeGreaterThanOrEqual(anchor.x + anchor.width + 16);
    expect(bounds!.x).toBeGreaterThanOrEqual(12);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(bounds!.y).toBeGreaterThanOrEqual(12);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 12);
    await overlay.hover();
    await page.waitForTimeout(220);
    await expect(overlay).toBeVisible();
    await fits();
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await source.click();
    await expect(page.locator('.curiosity-session-list')).toContainText(sessionName);
    await fits();
    await page.getByRole('button', { name: 'Next sessions', exact: true }).click();
    await fits();
  });
}

test('escapes untrusted session names in hover and inspection', async ({ page }) => {
  await page.goto(URL);
  const data = await dataFor(page);
  const name = '<img src=x onerror="window.questionExecuted=true">';
  await patchCuriosity(page, { research: { ...data.research, web: { ...data.research.web,
    sessionSamples: [{ ...data.research.web.sessionSamples[0], name }] } } });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  const source = page.getByRole('region', { name: 'Recorded investigation sources' }).getByRole('button', { name: /Web sources/ });
  await source.hover();
  await expect(page.getByRole('tooltip')).toContainText(name);
  await source.click();
  await expect(page.locator('.curiosity-session-list')).toContainText(name);
  await expect(page.locator('#curiosity-results img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { questionExecuted?: boolean }).questionExecuted)).toBeUndefined();
});

test('uses the current theme text color for both chart axes', async ({ page }) => {
  await captureChartText(page);
  await page.goto(URL);
  await expect(page.locator('.curiosity-summary')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--vscode-foreground', '#202020');
    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
    (window as MockWindow).curiosityAxis = [];
  });
  await page.getByRole('button', { name: 'All time', exact: true }).click();
  await page.getByRole('button', { name: 'All turns', exact: true }).click();
  await expect(page.locator('.curiosity-range .active')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect.poll(() => page.evaluate(() => {
    const axis = (window as MockWindow).curiosityAxis ?? [];
    return ['Sep 28', 'Sep 30', '0'].map(text => axis.filter(item => item.text === text).at(-1)?.color);
  })).toEqual(['#202020', '#202020', '#202020']);
});

test('coalesces rapid chart-control changes into one renderer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await captureChartText(page);
  await page.goto(URL);
  await expect(page.locator('#curiosityBalance')).toBeVisible();
  await page.evaluate(() => {
    document.querySelectorAll<HTMLButtonElement>('[aria-label="Chart measure"] button')[1].click();
    document.querySelectorAll<HTMLButtonElement>('[aria-label="Chart measure"] button')[1].click();
    document.querySelectorAll<HTMLButtonElement>('[aria-label="Chart measure"] button')[0].click();
  });
  await expect(page.getByRole('img', { name: 'Weekly Explore turns with Explore share on a 0 to 100 percent scale', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as MockWindow).curiosityAxis?.some(item => item.text === 'Sep 28'))).toBe(true);
  expect(errors).toEqual([]);
});

test('opens a named session day on Timeline and leaves no stale Curiosity content', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('region', { name: 'Recorded investigation sources' }).getByRole('button', { name: /Web sources/ }).click();
  await page.locator('.curiosity-session-list a').first().click();
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.locator('#curiosity-results')).toHaveCount(0);
});
