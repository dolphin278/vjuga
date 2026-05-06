# CONTRIBUTING-AGENTS.md

Shared contributor guide for coding agents working in this repository. This is
the authoritative source for repo-specific engineering policy, regardless of
whether the agent is Claude, Codex, or another tool.

## Project

vjuga is a zero-dependency, ESM-only TypeScript/JavaScript utility library.
It provides functional programming primitives, async patterns, data structures,
and resource management utilities.

## Start Here

- Use [AGENTS.md](./AGENTS.md) for repo orientation and module selection.
- Use [llms.txt](./llms.txt) for the full public module index.
- Treat `.claude/` as Claude-specific tool configuration only, not project
  policy.

## Optional Skill

If your agent supports skills, `dolphin278-craft` is the preferred supplemental
skill for this repo. It is optional acceleration only. All load-bearing repo
requirements are defined in this document and must be followed even when the
skill is unavailable.

Claude Code install command:

```sh
npx skills add dolphin278/prj-4187-skills --skill dolphin278-craft -y
```

## Repo Requirements

- **100% code coverage is required** for branches, statements, functions, and
  lines. The `npm run coverage` script enforces this. Every new module must
  ship with tests covering all code paths. Use `/* c8 ignore next */` only for
  platform-specific branches that cannot be exercised in Node.js tests, and
  leave a comment explaining why.
- **Fuzz tests are mandatory.** Every `src/*.ts` module must have a
  corresponding fuzz test in `src/tests/fuzz/` or coverage in a shared fuzz
  file such as `src/tests/fuzz/aggressive-fuzz.test.ts`. Schema module fuzz
  tests live in `src/tests/fuzz/schema/`.
- **Profile and benchmark performance-sensitive changes.** This library is
  performance-oriented; avoid merging hot-path changes without verification.
- **Module-level docstrings are required.** Every `src/*.ts` module must start
  with a JSDoc block before imports or code.
- **Keep AI-facing docs in sync** when public modules change. Update
  [llms.txt](./llms.txt) and the relevant tables in [AGENTS.md](./AGENTS.md) in
  the same change as any public module addition or removal.

## Testing

- Unit tests live in `src/tests/`, named after the source module.
- Fuzz tests use the built-in PBT library: `Arbitrary`, `Property`,
  `StatefulTest`, and `CoverageGuided`.
- Stateful modules must have a model-based stateful test with an oracle model.
- Pure-function modules must have property-based tests.
- Property tests should use `{ numRuns: 1_000_000 }`.
- Stateful tests should use
  `{ numRuns: 1_000_000, maxCommands: 50, timeoutMs: 300_000 }`.
- `npm run test:fuzz` is part of the `prepare` gate.
- Fuzz tests are intentionally excluded from `npm test`.

## Module Docstrings

Each public module docstring should include these sections when applicable:

1. Title line: `ModuleName — one-sentence description.`
2. When to use: practical guidance on when the module is the right tool.
3. Internal design: field-by-field layout for stateful modules.
4. Design tradeoffs: rationale for non-obvious implementation choices.
5. Prior art: external inspiration or source, when applicable.
6. Usage example: short fenced TypeScript example for directly-consumed APIs.

Keep module docstrings under 40 lines. Per-function JSDoc remains separate.

## Verification Commands

- `npm run lint`
- `npm run coverage`
- `npm run test:fuzz`
- `npm run lint:docs`
- `npm run prepare`
