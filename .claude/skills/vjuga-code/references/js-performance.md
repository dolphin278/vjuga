# Target runtimes

- Node.js LTS
- Bun.sh
- Modern evergreen browsers (Chrome, Firefox, Safari, Edge)

# Perfomance orientation

Code should be optimized with performance according to recent developments in
most popular JavaScript engines.

## Monomorphic code patterns should be preferred over polymorphic ones

In the order of importance:

1. Avoid polymorphism - use monomorphic code patterns whenever possible.
2. Avoid megamorphic code patterns - if polymorphism is necessary, try to limit
   the number of different shapes to a minimum.
3. Avoid polymorphic code patterns in hot code paths - if polymorphism is
   necessary, try to avoid it in hot code paths.

## Pay attention to if code is optimized by JavaScript engines

Chrome DevTools, Node --perf and other profiling tools can be used to check if
code is optimized by JavaScript engines.

Benchmarks should be designed in a way that they will resemble real-world usage
to detect possible polymorphic code patterns.

## Same shape objects is not enough

Even if objects have the same shape, they can still be polymorphic if they are
created in different places in the code. To avoid this, factory functions should
be used consistently to create objects of the same prototype.

## Avoid long prototype chains

Walking up the prototype chain is expensive, so it's important to avoid them.

## Avoid using classes

Classes can introduce polymorphism and megamorphism, so it's generally better to
use factory functions and plain objects instead.

Classes can be used when they are required by external APIs or to subclass Error
class.

Prefer free-floating functions and plain objects over classes.

## Avoid dynamic dispatch

In general, try to avoid object.method calls and dynamic dispatch, as they can
lead to polymorphism. Instead, use free-floating functions that take objects as
arguments. This can help ensure that the code remains monomorphic and optimized
by JavaScript engines.

Instead of `obj1.obj2.obj3.method(...args)`, do:

```ts
   const fn = obj1.obj2.obj3.method;

   // ...

   fn(...args) // if function is free-floating, or

   // if function is a method on the object, but we call it with .call() or .bind()
```

Such replaces require profiling to prove that they do not make performance worse.


## Be mindful about capturing variables in closures

Having large values in closures can lead to memory leaks and performance issues.
Oftentimes we can define function at the top level and use `.call()` or
`.bind()`.

## Avoid creating closures in hot code paths

Creating closures in hot code paths can lead to performance issues, as it can
lead to increased memory usage and garbage collection overhead. If a closure is
necessary, try to create it outside of the hot code path and reuse it whenever
possible.

## Prefer loops over functional methods like `map`, `filter`, `reduce`

Their lambdas sometimes are not inlined, and they can lead to increased memory
usage due to creating intermediate arrays and closures. In hot code paths, it's
often better to use traditional loops for better performance. However, this is
not a hard rule and should be evaluated on a case-by-case basis, as modern
JavaScript engines have been improving their optimizations for functional
methods. Always profile and benchmark to determine the best approach for your
specific use case.

## Strings should not be used as enums

JavaScript engines tend to internalize strings, but this is not guaranteed and
if string values are created, it might not work at all.

Therefore, it's better to use symbols or numbers as enums.

It is okey to use strings for values on the border of the system, e.g. for JSON
serialization or for values that are used in external APIs, but they should not
be used internally in the library - we encode them as symbols or numbers and
convert them to strings on the border of the system.

## Avoid using objects as maps

Using objects as maps can lead to polymorphism and megamorphism, especially if
the keys are not known in advance. It's better to use Map or WeakMap as a
baseline for maps, and only use plain objects when the keys are known and fixed,
or if profiling shows that using plain objects is faster in a specific case.

## Any trade-offs should be documented and revised regularly

If a trade-off is made for performance reasons, it should be documented in the
codebase and revised regularly to ensure that it is still valid and does not
introduce any performance. JS engines are constantly evolving, and what might be
a good trade-off today might not be in the future. Regularly revisiting these
trade-offs can help ensure that the library remains performant over time.

## Further Reading

[js-performance-links.md](js-performance-links.md) is a curated list of
resources for learning about JavaScript engine internals and performance
patterns.
