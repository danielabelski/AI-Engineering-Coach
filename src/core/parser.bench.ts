import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, test, afterAll } from 'vitest';
import { reconstructFromJsonl } from './parser-vscode-files';
import { evaluateExpression, compileFilter } from './dsl/index';
import { executePipeline, parsePipeline } from './rule-pipeline';
import type { DetectionRule, Session, SessionRequest } from './types';
import type { DetectorContext } from './rule-pipeline';
import { Analyzer } from './analyzer';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateJsonlLines(count: number): string {
  const lines: string[] = [];
  lines.push(JSON.stringify({ kind: 0, v: { sessions: [] } }));
  for (let i = 0; i < count; i++) {
    lines.push(JSON.stringify({
      kind: 1,
      k: ['sessions', i],
      v: { id: `s${i}`, timestamp: Date.now() - i * 1000 },
    }));
  }
  return lines.join('\n');
}

function makeRequest(i: number): SessionRequest {
  return {
    requestId: `r${i}`,
    timestamp: Date.now() - i * 60000,
    messageText: `Please fix the bug in file${i}.ts`,
    responseText: `I'll help you fix the bug. Here's the updated code for file${i}.ts...`,
    isCanceled: false,
    agentName: 'copilot',
    agentMode: 'chat',
    modelId: 'gpt-4o',
    toolsUsed: i % 3 === 0 ? ['terminal'] : [],
    editedFiles: i % 2 === 0 ? [`src/file${i}.ts`] : [],
    referencedFiles: [`src/ref${i}.ts`],
    slashCommand: '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: 200,
    totalElapsed: 1500 + i * 10,
    messageLength: 30,
    responseLength: 150,
    userCode: [],
    aiCode: [{ language: 'typescript', loc: 10 + i }],
    toolConfirmations: [],
    promptTokens: 500,
    completionTokens: 200,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: i % 2 === 0 ? 'feature' : 'bug-fix',
  };
}

function makeSession(id: number, reqCount: number): Session {
  const requests = Array.from({ length: reqCount }, (_, i) => makeRequest(i));
  return {
    sessionId: `session-${id}`,
    workspaceId: `ws-${id % 5}`,
    workspaceName: `project-${id % 5}`,
    location: '/workspace/project',
    harness: 'vscode',
    creationDate: Date.now() - id * 3600000,
    lastMessageDate: Date.now() - id * 1800000,
    requestCount: reqCount,
    requests,
  };
}

function makeRule(matchExpr: string, checkExpr: string): DetectionRule {
  return {
    id: 'bench-rule',
    name: 'Benchmark Rule',
    group: 'prompt-quality',
    severity: 'medium',
    requiresIdeContext: false,
    scope: 'requests',
    description: 'A rule for benchmarking',
    descriptionTemplate: '{{count}} of {{total}} requests matched',
    suggestionTemplate: 'Consider improving prompts',
    exampleTemplate: '{{messageText}}',
    maxExamples: 3,
    conditions: [],
    thresholds: { min: 3 },
    patterns: {},
    fileTypes: {},
    tests: [],
    source: 'built-in',
    sourceFilePath: '',
    version: 1,
    tags: [],
    rawSource: `\`\`\`detect\nscan: requests\nmatch: ${matchExpr}\naggregate: count\ncheck: ${checkExpr}\n\`\`\``,
  };
}

// ─── JSONL Parser Benchmarks ────────────────────────────────────────────────

const benchTmpDir = mkdtempSync(join(tmpdir(), 'bench-'));
const smallFile = join(benchTmpDir, 'small.jsonl');
const medFile = join(benchTmpDir, 'medium.jsonl');
const largeFile = join(benchTmpDir, 'large.jsonl');
writeFileSync(smallFile, generateJsonlLines(100));
writeFileSync(medFile, generateJsonlLines(1000));
writeFileSync(largeFile, generateJsonlLines(10000));

describe('JSONL Parser', () => {
  afterAll(() => {
    rmSync(benchTmpDir, { recursive: true, force: true });
  });

  test('reconstructFromJsonl - 100 lines', async ({ bench }) => {
    await bench('reconstructFromJsonl', () => reconstructFromJsonl(smallFile)).run();
  });

  test('reconstructFromJsonl - 1000 lines', async ({ bench }) => {
    await bench('reconstructFromJsonl', () => reconstructFromJsonl(medFile)).run();
  });

  test('reconstructFromJsonl - 10000 lines', async ({ bench }) => {
    await bench('reconstructFromJsonl', () => reconstructFromJsonl(largeFile)).run();
  });
});

// ─── DSL Benchmarks ─────────────────────────────────────────────────────────

describe('DSL Evaluation', () => {
  const simpleCtx = { requestCount: 10, messageLength: 50, totalElapsed: 2000 };
  const complexCtx = {
    messageText: 'Please fix the authentication bug in login.ts',
    editedFiles: ['src/auth.ts', 'src/login.ts'],
    toolsUsed: ['terminal', 'search'],
    responseLength: 500,
    isCanceled: false,
  };

  test('simple comparison: requestCount > 5', async ({ bench }) => {
    await bench('evaluateExpression', () => evaluateExpression('requestCount > 5', simpleCtx)).run();
  });

  test('arithmetic: totalElapsed / 1000', async ({ bench }) => {
    await bench('evaluateExpression', () => evaluateExpression('totalElapsed / 1000', simpleCtx)).run();
  });

  test('function call: length(editedFiles) > 0', async ({ bench }) => {
    await bench('evaluateExpression', () => evaluateExpression('length(editedFiles) > 0', complexCtx)).run();
  });

  test('contains + AND: contains(messageText, "fix") AND length(editedFiles) > 0', async ({ bench }) => {
    await bench('evaluateExpression', () =>
      evaluateExpression('contains(messageText, "fix") AND length(editedFiles) > 0', complexCtx)).run();
  });

  test('compileFilter with complex expression', async ({ bench }) => {
    await bench('compileFilter', () => {
      const fn = compileFilter('length(toolsUsed) > 1 AND responseLength > 100');
      return fn(complexCtx);
    }).run();
  });
});

// ─── Rule Pipeline Benchmarks ───────────────────────────────────────────────

describe('Rule Pipeline', () => {
  const sessions = Array.from({ length: 10 }, (_, i) => makeSession(i, 5));
  const reqs = sessions.flatMap(s => s.requests) as unknown as SessionRequest[];

  const simpleRule = makeRule('messageLength > 10', 'count > 3');
  const complexRule = makeRule(
    'contains(messageText, "fix") AND length(editedFiles) > 0',
    'ratio > 0.3',
  );

  test('simple match pipeline (50 requests)', async ({ bench }) => {
    await bench('executePipeline', () => {
      const pipeline = parsePipeline(simpleRule);
      const ctx: DetectorContext = { reqs, sessions, skipIdeDetectors: false };
      return executePipeline(pipeline, simpleRule, ctx);
    }).run();
  });

  test('complex match pipeline (50 requests)', async ({ bench }) => {
    await bench('executePipeline', () => {
      const pipeline = parsePipeline(complexRule);
      const ctx: DetectorContext = { reqs, sessions, skipIdeDetectors: false };
      return executePipeline(pipeline, complexRule, ctx);
    }).run();
  });

  const largeSessions = Array.from({ length: 50 }, (_, i) => makeSession(i, 10));
  const largeReqs = largeSessions.flatMap(s => s.requests) as unknown as SessionRequest[];

  test('pipeline with 500 requests', async ({ bench }) => {
    await bench('executePipeline', () => {
      const pipeline = parsePipeline(complexRule);
      const ctx: DetectorContext = { reqs: largeReqs, sessions: largeSessions, skipIdeDetectors: false };
      return executePipeline(pipeline, complexRule, ctx);
    }).run();
  });
});

// ─── Analyzer Throughput Benchmarks ─────────────────────────────────────────

describe('Analyzer Throughput', () => {
  const sessions10 = Array.from({ length: 10 }, (_, i) => makeSession(i, 5));
  const sessions100 = Array.from({ length: 100 }, (_, i) => makeSession(i, 3));
  const sessions500 = Array.from({ length: 500 }, (_, i) => makeSession(i, 2));

  test('Analyzer.getStats - 10 sessions', async ({ bench }) => {
    await bench('Analyzer.getStats', () => {
      const analyzer = new Analyzer(sessions10);
      return analyzer.getStats();
    }).run();
  });

  test('Analyzer.getStats - 100 sessions', async ({ bench }) => {
    await bench('Analyzer.getStats', () => {
      const analyzer = new Analyzer(sessions100);
      return analyzer.getStats();
    }).run();
  });

  test('Analyzer.getStats - 500 sessions', async ({ bench }) => {
    await bench('Analyzer.getStats', () => {
      const analyzer = new Analyzer(sessions500);
      return analyzer.getStats();
    }).run();
  });
});
