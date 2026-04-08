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
