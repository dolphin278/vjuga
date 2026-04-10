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
  corresponding fuzz test (`src/tests/<Module>.fuzz.test.ts` or coverage in
  a shared fuzz file like `aggressive-fuzz.test.ts`). Fuzz tests use the
  built-in PBT library (`Arbitrary`, `Property`, `StatefulTest`,
  `CoverageGuided`). Stateful modules must have a model-based stateful test
  (`ST.assertStateful`) with an oracle model; pure-function modules must have
  property-based tests (`Prop.assert`). Use `{ numRuns: 500 }` for property
  tests and `{ numRuns: 200, maxCommands: 50 }` for stateful tests at
  minimum. The `npm run test:fuzz` script runs all fuzz tests and is part of
  the `prepare` gate.
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
