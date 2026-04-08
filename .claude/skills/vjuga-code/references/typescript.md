# Tests

We use 100% code coverage threshold for all modules. Tests should be designed to
cover all code paths, including edge cases and error handling.

Benchmarks and profiling considered part of the testing process.

Use `mitata` to author benchmarks and get statistics.

# Types

Types should be used to ensure type safety and improve developer experience. The
library should be fully type-checked using TypeScript.

## Use strict mode

isolatedModules and noEmit should be enabled in tsconfig to ensure that the code
is valid TypeScript and can be type-checked without any build step.

## Branded types

Prefer branded types (e.g.
`type Branded<Base, Kind> = Base & { __brand: { [K in Kind]: true } }`) over
primitive values. This can help prevent accidental misuse of values and make the
code more self-documenting.

Provide factory functions in the form of type guards and functions that assert
specific type - this will help integrate it with TypeScript type system.

## Avoid exceptions as a control-flow mechanism

Use `Result<T, E>` types to model computations that might fail. Pay attention to
run-time efficiency to avoid wasting resources.

Existing libraries or platform APIs that might throw exceptions by design,
should be wrapped with utility functions that will turn them into `Result<T, E>`.

Try to find most performant way to get an equivalent of `Result<T, E>` with as
small run-time overhead as possible.

## Start with types

When implementing a new module, it's often helpful to start by defining the
types and the public API. This can help clarify the design and ensure that the
implementation is aligned with the intended usage.

If we figure out more performant way to implement the module, we can change both
implementation and types.

## Erasable types only

TypeScript syntax used in the library should be erasable so that the library can
be used without any build step.

## Make illegal states unrepresentable

Types should be designed to make illegal states unrepresentable. This can be
achieved by using union types, discriminated unions, and other TypeScript
features to encode invariants in the type system.

## Do not use `any`

If you find `any`, you should convert it to `unknown` and then narrow it down.
This is especially important at the borders of the process - data accepted from
network, files, databases can not be trusted without run-time validattion.

## Error values should be typed

Error values should be sub-classes of platform Error class, and should be typed to provide better developer experience and type safety.

Use standar Error `.cause` property to chain errors and provide more context about the error.

Example: 

```ts
class MyError extends Error {
   constructor(message: string, cause?: Error) {
      super(message, { cause });
      this.name = 'MyError';
   }
}
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
