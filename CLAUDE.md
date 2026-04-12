# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project

vjuga is a zero-dependency, ESM-only TypeScript/JavaScript utility library (v6).
It provides functional programming primitives, async patterns, data structures,
and resource management utilities.

## Skills

Install the `dolphin278-craft` skill before working on this repo:

```sh
npx skills add dolphin278/prj-4187-skills --skill dolphin278-craft -y
```

Then follow the `dolphin278-craft` skill. vjuga-specific additions on top of that skill:

- **100% code coverage is required** (branches, statements, functions, lines).
  The `npm run coverage` script enforces this with `--check-coverage`. Every new
  module must ship with tests that cover all code paths. Use `/* c8 ignore next */`
  only for platform-specific branches that cannot be exercised in Node.js tests
  (e.g. Bun-only paths), and add a comment explaining why.
- When making changes, ensure that they are profiled and benchmarked to avoid
  performance regressions.
- Tests live in `src/tests/`, named after the source module.
- **Fuzz tests are mandatory.** Every `src/*.ts` module must have a
  corresponding fuzz test (`src/tests/fuzz/<Module>.fuzz.test.ts` or coverage
  in a shared fuzz file like `src/tests/fuzz/aggressive-fuzz.test.ts`). Schema
  module fuzz tests live in `src/tests/fuzz/schema/`. Fuzz tests use the
  built-in PBT library (`Arbitrary`, `Property`, `StatefulTest`,
  `CoverageGuided`). Stateful modules must have a model-based stateful test
  (`ST.assertStateful`) with an oracle model; pure-function modules must have
  property-based tests (`Prop.assert`). Use `{ numRuns: 1_000_000 }` for
  property tests and `{ numRuns: 1_000_000, maxCommands: 50, timeoutMs: 300_000 }`
  for stateful tests. The `npm run test:fuzz` script runs all fuzz tests and is
  part of the `prepare` gate. Fuzz tests are **not** run by `npm test` — they
  live in `src/tests/fuzz/` which is intentionally excluded from the regular
  test glob.
- **Module-level docstrings are required.** Every `src/*.ts` module must begin
  with a JSDoc block (`/** ... */`) before any imports or code. Include the
  following sections (omit a section only when it does not apply):
  1. **Title line**: `ModuleName — one-sentence description.`
  2. **When to use**: practical guidance on when this module is the right tool
     and when it isn't — size thresholds, simpler alternatives, overhead vs
     payoff. Required when the answer is not self-evident.
  3. **Internal design**: field-by-field layout of internal data structures,
     using the `kField: Type — purpose` format (for stateful modules).
  4. **Design tradeoffs**: why this approach over alternatives, V8/perf
     rationale (when non-obvious choices exist).
  5. **Prior art**: name + link/package (when the design draws from an external
     source).
  6. **Usage example**: fenced TypeScript code block, 3–8 lines (for modules
     that export a public API consumers call directly).
  Keep module docstrings under 40 lines. Per-function JSDoc stays as-is; the
  module docstring covers cross-cutting concerns.
- **Keep AI-facing docs in sync when adding or removing modules.** The repo
  ships two files consumed by AI coding tools:
  - `llms.txt` — machine-readable module index. The `npm run lint:docs` script
    (part of the `prepare` gate) will fail if a module in `src/*.ts` or
    `src/schema/*.ts` is missing from `llms.txt`. When adding a new module,
    add an entry to the correct category section in `llms.txt` following the
    format of existing entries: a Markdown link to the source file and a
    one-line description covering the module's purpose and key exports.
  - `AGENTS.md` — use-case–driven quick reference. `lint:docs` does not check
    prose content, so manually add a row to the relevant "I need to…" table in
    `AGENTS.md` when adding a new module. When removing a module, delete its
    entries from both files.
  Both files must be updated in the same PR as the new module.
