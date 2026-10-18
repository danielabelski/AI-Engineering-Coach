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

Use **Node.js 22 LTS, version 22.18.0 or newer**, and npm for development, tests, and
packaging. Node 24.x and Node 26+ are also supported; Node 20, 23, and 25
are not supported by Vitest 5. CI uses Node 22. This development requirement does not
change the extension's VS Code `^1.125.0` compatibility.

The Node 22.18 minimum comes from cspell 10; Vitest 5 and ESLint also require modern Node.

1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: `npm ci`
3. **Build**: `npm run build`
4. **Run tests**: `npm test`
5. **Lint**: `npm run lint`
6. If you've added code, add tests that cover your changes.
7. Run the full gate: `npm run check`.
8. Submit a **pull request**.

Keep `vitest` and `@vitest/coverage-v8` on the same exact version when updating dependencies.
Run `npm run test:coverage` for coverage-provider updates and `npm run test:e2e` for
Playwright or webview changes. Benchmarks use the Vitest 5 test-context `bench` fixture;
run them once with `npm run bench -- --run`.

Database integration tests require the `sqlite3` command-line tool on `PATH`.
After updating Playwright, run `npx playwright install chromium` before the end-to-end tests.

## Reporting Issues

Please use [GitHub Issues](https://github.com/microsoft/ai-engineer-coach/issues) to report bugs or
request features. Before filing a new issue, please check if one already exists.

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
