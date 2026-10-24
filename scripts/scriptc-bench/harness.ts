/**
 * harness — a timing loop that compiles under scriptc and runs unchanged under
 * Bun and Node, so the three run kinds measure the same code the same way.
 *
 * mitata does not run here: scriptc 0.4.4 builds it, but the binary throws
 * SC1090 ('undefined'-typed computed property key, mitata/src/lib.mjs:64) at
 * startup. So every kind uses this loop instead of mitata.
 *
 * Method, per bench: one checksum pass (fn(0..CHECK_CALLS-1) summed), then
 * batches of n calls with n doubled until a batch takes SAMPLE_MS and run until
 * WARMUP_MS has passed (JIT tier-up on Bun/Node), then SAMPLES batches of n
 * calls, each timed with performance.now(). scriptc lowers that to
 * clock_gettime(CLOCK_MONOTONIC). Reports ns/op median, min and max.
 *
 * Each fn takes the call index and returns a number: the index keeps the call
 * from being loop-invariant, and every result is summed into `sink`, which is
 * read after each bench, so neither a JIT nor LLVM can drop the work.
 *
 * Flags: `--check` prints `name<TAB>checksum` for every bench and times
 * nothing; `--only N` times bench N alone (run.ts gives each bench its own
 * process, so the JIT sees one fn at the timing call site, as mitata's
 * generated loops do). Output line: name, median, min, max, n, checksum.
 */

const CHECK_CALLS = 256;
const WARMUP_MS = 200;
const SAMPLE_MS = 2;
const SAMPLES = 25;

const argv = process.argv;
const CHECK = argv.includes("--check");
const onlyAt = argv.indexOf("--only");
const ONLY = onlyAt >= 0 ? Number(argv[onlyAt + 1]) : -1;

let index = 0;
let sink = 0;

// Claims the next bench index; true when this process should time it.
function selected(): boolean {
  const at = index;
  index++;
  return !CHECK && (ONLY < 0 || at === ONLY);
}

function report(name: string, samples: number[], n: number, checksum: number): void {
  samples.sort((a, b) => a - b);
  const median = samples[samples.length >> 1] as number;
  const min = samples[0] as number;
  const max = samples[samples.length - 1] as number;
  console.log(
    `${name}\t${median.toFixed(2)}\t${min.toFixed(2)}\t${max.toFixed(2)}\t${n}\t${checksum}`,
  );
  // Never true for summed integer results; keeps `sink` (and the work) live.
  if (sink === -0.123456789) console.log("sink");
}

/** Registers and, when selected, times a synchronous benchmark. */
export function bench(name: string, fn: (i: number) => number): void {
  let checksum = 0;
  if (CHECK) {
    for (let i = 0; i < CHECK_CALLS; i++) checksum += fn(i);
    console.log(`${name}\t${checksum}`);
  }
  if (!selected()) return;
  for (let i = 0; i < CHECK_CALLS; i++) checksum += fn(i);
  let iter = 0;
  let n = 1;
  const warmEnd = performance.now() + WARMUP_MS;
  for (;;) {
    let acc = 0;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) acc += fn(iter++);
    const dt = performance.now() - t0;
    sink += acc;
    if (dt < SAMPLE_MS) n *= 2;
    else if (performance.now() >= warmEnd) break;
  }
  const samples: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    let acc = 0;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) acc += fn(iter++);
    const dt = performance.now() - t0;
    sink += acc;
    samples.push((dt * 1e6) / n);
  }
  report(name, samples, n, checksum);
}

/** As `bench`, but awaits each call: measures one op plus its promise settling. */
export async function benchAsync(name: string, fn: (i: number) => Promise<number>): Promise<void> {
  let checksum = 0;
  if (CHECK) {
    for (let i = 0; i < CHECK_CALLS; i++) checksum += await fn(i);
    console.log(`${name}\t${checksum}`);
  }
  if (!selected()) return;
  for (let i = 0; i < CHECK_CALLS; i++) checksum += await fn(i);
  let iter = 0;
  let n = 1;
  const warmEnd = performance.now() + WARMUP_MS;
  for (;;) {
    let acc = 0;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) acc += await fn(iter++);
    const dt = performance.now() - t0;
    sink += acc;
    if (dt < SAMPLE_MS) n *= 2;
    else if (performance.now() >= warmEnd) break;
  }
  const samples: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    let acc = 0;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) acc += await fn(iter++);
    const dt = performance.now() - t0;
    sink += acc;
    samples.push((dt * 1e6) / n);
  }
  report(name, samples, n, checksum);
}
