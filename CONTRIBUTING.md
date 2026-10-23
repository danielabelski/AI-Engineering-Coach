# Contributing to AI Engineer Coach

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## How to Contribute

1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: `npm install`
3. **Build**: `npm run build`
4. **Run tests**: `npm test`
5. **Lint**: `npm run lint`
6. If you've added code, add tests that cover your changes.
7. Ensure the test suite passes and linting is clean.
8. Submit a **pull request**.

## Reporting Issues

Please use [GitHub Issues](https://github.com/microsoft/ai-engineer-coach/issues) to report bugs or
request features. Before filing a new issue, please check if one already exists.

## End-to-End Testing

Use Node 22 (the CI version) or a newer supported Node release. Install the locked dependencies
with `npm ci`. The existing database integration tests also require the `sqlite3` command on
your `PATH`. There are three complementary test layers:

| Layer | Command | What it verifies |
| --- | --- | --- |
| Unit and fixture tests | `npm test` | Parsers, rules, calculations, and synthetic-data invariants |
| Browser webview tests | `npm run build` then `npm run test:e2e` | Dashboard interactions with mocked host responses |
| Packaged VS Code tests | `npm run test:vscode` | Installation, activation, workers, real webview messaging, navigation, reload, and empty data |

Before the first browser run, install its browser with `npx playwright install chromium`.
On a Linux machine without a display, install the desktop dependencies with
`npx playwright install-deps chromium`, then run `xvfb-run -a npm run test:vscode`.
Windows and macOS run the same npm command without the virtual display.

### Testing the shipped extension

`npm run test:vscode` compiles the test code, packages the extension through the normal packaging
script, and installs that VSIX into a disposable VS Code installation. It never installs into
your normal editor. To test an already-built artifact without rebuilding it, use:

```sh
npm run test:vscode -- --vsix ai-engineer-coach-0.1.0.vsix
```

Substitute the filename produced by `npm run package` when the package version changes.
The runner records the package's SHA-256 hash and checks that the artifact did not change.
CI and releases pass the exact package path this way; publishing happens only after the
browser and desktop suites pass, and the release uses that same VSIX.

By default, desktop tests use the minimum version in `package.json`'s `engines.vscode`.
Use `--vscode-version 1.125.0` to select an explicit compatible version, or
`--vscode-version latest` to check the current stable release. An incompatible pinned version
fails before launching. The [compatibility workflow](.github/workflows/vscode-compatibility.yml)
runs the minimum and latest versions on Linux, Windows, and macOS weekly and on manual dispatch.

The desktop runner uses [ExTester](https://github.com/redhat-developer/vscode-extension-tester).
Its actively tested editor-version window moves with new releases; older versions are
best-effort. Keep the minimum-version tests rather than silently increasing our public engine
requirement to accommodate the runner. Dependency updates use the existing Dependabot workflow.

### Synthetic data and isolation

[`tests/vscode/fixtures.ts`](tests/vscode/fixtures.ts) creates raw VS Code session JSON in the
platform's normal discovery layout, entirely inside a fresh temporary home. Two workspaces
initially contain two sessions and six requests. The reload test adds one synthetic session,
then verifies three sessions and nine requests, including a second reload without duplicates.
The empty-data scenario starts a separate process with a fresh home and no session sources.

The data structure and prompts are deterministic; timestamps are anchored to noon on the
previous day so date-based views do not age out. The unit suite checks the raw data through
the real parser. Desktop tests do not replace the parser, workers, VS Code API, or message bridge.
They also check that input log files remain byte-for-byte unchanged except for the test's
explicit addition. Personal home, AppData, Copilot data, temporary directories, extension
directories, and VS Code profiles are isolated; no sign-in or live model call is required.

Only editor/driver download archives are cached under `.vscode-test/cache`. Each invocation
creates fresh profiles, fixtures, and application caches and removes them after the run.
Diagnostics remain under `test-results/vscode`, including runtime and driver logs, failure
screenshots, and a package-hash summary. Browser traces, screenshots, and the HTML report
are stored separately under `test-results/browser` and `test-results/browser-report`.
GitHub Actions uploads these diagnostics even when a test fails.

### Maintaining regression coverage

Add the regression test in the same PR as the feature or fix. Prefer the smallest layer that
can reproduce the behavior: parser/calculation changes belong in Vitest, dashboard interaction
changes in Playwright, and packaging or host/webview boundary changes in the desktop suite.
Do not duplicate every browser scenario in VS Code.

Add lowercase, hyphenated `*.spec.ts` files directly under
[`tests/vscode/suite`](tests/vscode/suite). The runner discovers new source suites automatically;
each file gets a separate process, profile, and baseline synthetic data. `empty.spec.ts` is the
no-data exception. Reuse the [`Dashboard`](tests/vscode/dashboard.ts) helper and small synthetic
fixtures. Keep selectors in the helper, wait for observable readiness instead of fixed sleeps,
and assert exact results.
The desktop suite is sequential, has no automatic test retries, and rejects focused, skipped, or
empty test runs. Reload replaces the webview's inner frame, so the dashboard helper waits for a
different document and reacquires detached frames within a single deadline. It does not repeat
the reload command or suppress unexpected driver failures.
Its TypeScript and fixture tests are included in `npm run check`.

Use the shared [E2E action](.github/actions/e2e/action.yml) for pipeline changes so PR, release,
and compatibility runs do not acquire different setup procedures. Investigate failures using
the saved screenshots and logs; do not bypass the release gate or disable an operating-system
security feature globally to get a green run.

## Security

If you discover a security vulnerability, please follow the instructions in [SECURITY.md](SECURITY.md).
**Do not** report security vulnerabilities through public GitHub issues.

## Creating Rules and Metrics

Detection rules and metrics are the primary extensibility surface of AI Engineer Coach. Each one is
a self-contained markdown file with YAML frontmatter and a small DSL — no code changes required to
ship a new one. Built-in rules live in [`src/core/rules/`](src/core/rules/) and metrics in
[`src/core/metrics/`](src/core/metrics/).

See [docs/AUTHORING_RULES.md](docs/AUTHORING_RULES.md) for the full authoring guide: file format,
annotated rule and metric examples, the local testing workflow, and links to the DSL reference.
