# JavaScript Engine Internals & Performance — Resource List

Curated links for getting up to speed on low-level JS engine performance
patterns, optimization strategies, and internals. Prioritizes actively
maintained or foundationally relevant sources.

---

## 1. Official Engine Blogs (Actively Updated)

### V8 (Chrome, Node.js, Deno)

- **V8 Blog**: https://v8.dev/blog
  - Key recent posts:
  - Leaving the Sea of Nodes (Turboshaft architecture):
    https://v8.dev/blog/leaving-the-sea-of-nodes
  - Maglev — V8's mid-tier optimizing JIT: https://v8.dev/blog/maglev
  - V8 2023 year-in-review (Maglev + Turboshaft overview):
    https://v8.dev/blog/holiday-season-2023
- **V8 Documentation**: https://v8.dev/docs

### SpiderMonkey (Firefox)

- **SpiderMonkey Blog**: https://spidermonkey.dev/blog/
  - Regularly publishes newsletters covering IC improvements, register
    allocation, GC optimizations, Wasm advances
  - Homepage with links to source docs, SMDOC, architecture overviews:
    https://spidermonkey.dev/

### JavaScriptCore (Safari, WebKit)

- **WebKit Blog**: https://webkit.org/blog/
  - Key recent post — JetStream 3 deep dive into JSC improvements:
    https://webkit.org/blog/17899/introducing-the-jetstream-3-benchmark-suite/
- **JSC Architecture Documentation**:
  https://docs.webkit.org/Deep%20Dive/JSC/JavaScriptCore.html
  - Covers LLInt → Baseline → DFG → FTL pipeline, type inference, inline caching

---

## 2. Foundational Articles (Engine-Agnostic Concepts)

These explain concepts that remain valid across engine versions — shapes, inline
caches, speculative optimization, value representations.

- **Shapes and Inline Caches** (Bynens & Meurer, 2018):
  https://mathiasbynens.be/notes/shapes-ics
- **Optimizing Prototypes** (Bynens & Meurer, 2018):
  https://mathiasbynens.be/notes/prototypes
- **The Story of a V8 Performance Cliff in React** (value representations, Smi
  vs HeapNumber): https://v8.dev/blog/react-cliff
- **Introduction to Speculative Optimization in V8** (Meurer, 2017):
  https://benediktmeurer.de/2017/12/13/an-introduction-to-speculative-optimization-in-V8

---

## 3. Key Individual Blogs

### Benedikt Meurer (former V8 team, TurboFan era)

- https://benediktmeurer.de/
- Publications list with design docs and talks:
  https://benediktmeurer.de/publications/
- Covers: TurboFan pipeline, speculative optimization, performance cliffs,
  DataView perf, Node.js performance

### Vyacheslav Egorov (mraleph, former V8 team)

- Blog: https://mrale.ph/
- V8 resources page (curated links): https://mrale.ph/v8/resources.html
- Key post: "Maybe you don't need Rust and WASM to speed up your JS":
  http://mrale.ph/blog/2018/02/03/maybe-you-dont-need-rust-to-speed-up-your-js.html
- Note: Content is 2012–2018 era but the mental models (hidden classes, ICs,
  deopt patterns, profiling methodology) remain foundational

### Mathias Bynens (V8 team)

- https://mathiasbynens.be/notes
- Co-authored the Shapes/ICs and Prototypes articles above

### Matthew Gaudet (SpiderMonkey team)

- https://www.mgaudet.ca/technical
- Recent post on Shape Teleportation optimization:
  https://www.mgaudet.ca/technical/2025/2/20/making-teleporting-smarter

### Seokho Song (V8 external contributor)

- https://blog.seokho.dev/
- Detailed devlogs on contributing to V8's Turbofan/Turboshaft/Maglev pipeline,
  Float16Array implementation
- Good for understanding V8's current (2024-2025) compiler architecture from a
  contributor's perspective

## Thlorenz

https://github.com/thlorenz/v8-perf

---

## 4. Source Code & Issue Trackers

- **V8 source** (Chromium): https://chromium.googlesource.com/v8/v8/+/main/
- **V8 GitHub mirror**: https://github.com/v8/v8
- **V8 source browser** (Chromium Code Search):
  https://source.chromium.org/chromium/chromium/src/+/main:v8/
- **V8 bug tracker**: https://bugs.chromium.org/p/v8/issues/list
- **WebKit/JSC source**: https://github.com/nicolo-ribaudo/jsc (JSC standalone),
  or browse at https://github.com/nicolo-ribaudo/WebKit
- **SpiderMonkey source**: part of mozilla-central, browsable at
  https://searchfox.org/mozilla-central/source/js/src

Commit messages on optimization-related CLs are often the most current and
detailed source of "why" behind performance changes.

---

## 5. Conference Talks (YouTube)

- **BlinkOn** (Chromium/V8 focused, held ~annually):
  - BlinkOn 20 (April 2025): https://www.chromium.org/events/blinkon-20/
  - Search YouTube for "BlinkOn V8" for past editions — V8 team regularly
    presents compiler and GC updates
- **V8 at BlinkOn 6** (compilation pipeline, benchmarking, GC):
  https://v8.dev/blog/blinkon-6
- **Vyacheslav Egorov's talk** "JavaScript Performance Through the Spyglass"
  (profiling methodology): https://mrale.ph/talks/goto2016/

---

## 6. Benchmark Suites (What Engines Optimize For)

Understanding what benchmarks exist tells you what patterns engines are
optimized for:

- **JetStream 3** (cross-browser, JS + Wasm):
  https://browserbench.org/JetStream/
- **Speedometer 3** (real-world web app responsiveness):
  https://browserbench.org/Speedometer3.0/
- **arewefastyet.com** (SpiderMonkey perf dashboard, moved to new infra):
  https://arewefastyet.com/

---

## 7. Practical V8 Profiling Reference

- **V8 flags for profiling**: use d8 shell with `--trace-opt`, `--trace-deopt`,
  `--print-bytecode`, `--print-opt-code`, `--trace-ic`
- **V8 docs on profiling**: https://v8.dev/docs/profile
- **Node.js --prof flag**: generates v8.log for tick processing

---

## Notes for Agent Context

- V8's current (2025) pipeline: **Ignition** (interpreter) → **Sparkplug**
  (baseline, no IR) → **Maglev** (mid-tier SSA/CFG JIT) →
  **TurboFan/Turboshaft** (top-tier optimizing JIT, migrating from Sea-of-Nodes
  to CFG)
- SpiderMonkey's current pipeline: **LLInt-like interpreter** → **Baseline** →
  **WarpBuilder/Ion** (optimizing JIT)
- JSC's current pipeline: **LLInt** → **Baseline JIT** → **DFG** (low-latency
  optimizing) → **FTL** (high-throughput optimizing)
- Core concepts that apply across all engines: hidden
  classes/shapes/maps/structures, inline caches
  (monomorphic/polymorphic/megamorphic), speculative optimization, on-stack
  replacement (OSR), deoptimization bailouts, type feedback vectors
- Most "JS performance tips" blog posts from 2012-2016 targeting Crankshaft-era
  V8 are outdated. The foundational concepts (shapes, ICs, monomorphism) still
  apply, but specific patterns (e.g. "don't use try-catch") are no longer
  relevant.
