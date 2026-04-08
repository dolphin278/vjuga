# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project

vjuga is a zero-dependency, ESM-only TypeScript/JavaScript utility library (v6).
It provides functional programming primitives, async patterns, data structures,
and resource management utilities.

## Guidelines for Claude

- Follow the performance guidelines (.claude/skills/vjuga-code/references/js-performance.md) and
  TypeScript conventions (.claude/skills/vjuga-code/references/typescript.md).
- When making changes, ensure that they are profiled and benchmarked to avoid
  performance regressions
- **100% code coverage is required** (branches, statements, functions, lines).
  The `npm run coverage` script enforces this with `--check-coverage`. Every new
  module must ship with tests that cover all code paths. Use `/* c8 ignore next */`
  only for platform-specific branches that cannot be exercised in Node.js tests
  (e.g. Bun-only paths), and add a comment explaining why.
