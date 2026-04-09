# Tests

We use 100% code coverage threshold for all modules. Tests should be designed to
cover all code paths, including edge cases and error handling.

Benchmarks and profiling considered part of the testing process.

Use `mitata` to author benchmarks and get statistics.

Coverage rules:
- Test every code branch: each conditional, each early return, every fallible
  path, capacity boundaries (N=0, N=1, at-capacity, over-capacity).
- Use `/* c8 ignore next */` **only** for platform-specific code that cannot
  be exercised in the current runtime (e.g., a Bun-only path when running
  under Node.js, or vice versa). Always add a same-line comment stating why.
- Test `Result`-returning functions by checking `result[0]` (the discriminant)
  and `result[1]` (the payload) directly — this also tests the monomorphic
  return shape.
- For concurrent code using `SharedArrayBuffer`, test both single-threaded
  behavior (deterministic) and, where possible, concurrent access patterns
  using multiple Workers.

Structure:
- Tests live adjacent to source in `src/tests/` and share the module's naming.
- Use the project's configured test runner and assertion library.
- Group related operation families with `describe`; use flat `test()` for
  small focused modules.
- No external test framework dependencies.

# Types

Types should be used to ensure type safety and improve developer experience. The
library should be fully type-checked using TypeScript.

## Use strict mode

- `strict: true` with `isolatedModules: true` and `verbatimModuleSyntax: true`.
- `noEmit` should be enabled.
- All imports use the compiled filename extension (`.js` for TypeScript files
  that compile to `.js`). `verbatimModuleSyntax` enforces this; any import
  that uses `.ts` will fail at runtime.

## Branded types

Prefer branded types (e.g.
`type Branded<Base, Kind> = Base & { __brand: { [K in Kind]: true } }`) over
primitive values. This can help prevent accidental misuse of values and make the
code more self-documenting.

Provide factory functions in the form of type guards and functions that assert
specific type - this will help integrate it with TypeScript type system.

```ts
type EmailAddress = Branded<string, 'EmailAddress'>;
type UUID = Branded<string, 'UUID'>;
```

## Result<T, E> as a readonly tuple

The `Result<T, E>` type is defined as:
```ts
type Ok<T>  = readonly [true, T];
type Err<E> = readonly [false, E];
type Result<T, E> = Ok<T> | Err<E>;
```

Integer-index access (`result[0]`, `result[1]`) is faster than named-property
access. The boolean discriminant at index 0 is a Smi literal that JIT compilers
constant-fold at specialized call sites. The shape is always `[boolean, value]`
regardless of `T` or `E`, keeping every call site monomorphic.

Never represent failure as a thrown exception for recoverable conditions. Return
`Result.err(...)` instead. Use `Result.fromThrowable` and `Result.fromPromise`
to wrap APIs that throw.

```ts
import * as Result from '../Result.js';

function divide(a: number, b: number): Result.Result<number, string> {
  if (b === 0) return Result.err('division by zero');
  return Result.ok(a / b);
}

// At the call site — discriminant check stays monomorphic
const r = divide(10, x);
if (r[0]) {
  console.log(r[1]); // number
} else {
  console.error(r[1]); // string
}
```

Existing libraries or platform APIs that might throw exceptions by design,
should be wrapped with utility functions that will turn them into `Result<T, E>`.

### Extracting inner types from Result

```ts
type UnwrapOk<R> = R extends Ok<infer T> ? T : never;
type UnwrapErr<R> = R extends Err<infer E> ? E : never;
```

## Start with types

When implementing a new module, it's often helpful to start by defining the
types and the public API. This can help clarify the design and ensure that the
implementation is aligned with the intended usage.

If we figure out more performant way to implement the module, we can change both
implementation and types.

## Erasable types only

TypeScript syntax used in the library should be erasable so that the library can
be used without any build step. No decorators, no `const enum`, no
runtime-affecting type constructs.

## Make illegal states unrepresentable

Types should be designed to make illegal states unrepresentable. This can be
achieved by using union types, discriminated unions, and other TypeScript
features to encode invariants in the type system.

## Do not use `any`

If you find `any`, you should convert it to `unknown` and then narrow it down.
This is especially important at the borders of the process - data accepted from
network, files, databases can not be trusted without run-time validation.

No non-null assertions (`!`) unless the invariant cannot be expressed as a
type — if used, a comment must state why it holds.

## Error values should be typed

Error values should be sub-classes of platform Error class, and should be typed
to provide better developer experience and type safety. Error hierarchies stay
flat — no more than one level of subclassing.

Use standard Error `.cause` property to chain errors and provide more context
about the error.

```ts
export class MyError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = 'MyError';
  }
}
```

## Advanced TypeScript patterns

### Conditional types for overloaded returns

When a function's return type depends on a type parameter:

```ts
type LookupResult<T, Fallback> =
  Fallback extends undefined ? T | undefined : T;

function get<T, F = undefined>(
  cache: Cache<T>, key: string, fallback?: F
): LookupResult<T, F> { ... }
```

### Variance annotations

Use `in`/`out` annotations on generic parameters to make variance explicit:

```ts
interface Reader<out T> { read(): T }    // covariant
interface Writer<in T> { write(v: T): void }  // contravariant
```

# Comments

Comments should be used to explain the "why" behind code, for any trade-offs
made for performance reasons. Comments should be clear and concise, and should
not state the obvious. They should provide context for future maintainers and
explain the reasoning behind design decisions.

It's okay to include large comments explaining logic behind module design, but
they should be kept up to date and revised regularly to ensure that they remain
accurate and relevant.

# Modules

Prefer larger modules, named after main concept or problem area. Modules are
just JS objects, so you can use similar approach to OCaml functors, where we
have functions that return module (this is done during startup and code ends
up being performant).

# Linting and formatting

Use oxlint and oxfmt for linting and formatting.
