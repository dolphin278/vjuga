# vjuga

❄️ My personal toolkit for typescript / javascript projects.

Library exposes only ESM modules. Current version is authored as JavaScript
modules with JSDoc annotations and is fully typechecked with TypeScript.

## Guidelines

- **No run-time dependencies** - library should be as small as possible and not
  depend on any other libraries.
- Type-checked JavaScript - library should be written in JavaScript and be fully
  type-checked. We use JSdoc annotations for type-checking by TypeScript.
- **ESM only** - library should be published as ESM modules only.
- No classes - library should be written in functional / procedural style. Only
  allowed cases for classes are when they required by external APIs or to
  subclass Error class.
