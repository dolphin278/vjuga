// V8 %-builtins — only active under: node --allow-natives-syntax
// Using eval() to access %-builtins because TypeScript forbids the % prefix in identifiers.

export function optimizeFunctionOnNextCall(fn: Function): void {
  void fn; // referenced inside eval string below
  try {
    // oxlint-disable-next-line no-eval
    eval("%OptimizeFunctionOnNextCall(fn)");
  } catch {
    /* noop */
  }
}

export function getOptimizationStatus(fn: Function): number {
  void fn; // referenced inside eval string below
  try {
    // oxlint-disable-next-line no-eval
    return eval("%GetOptimizationStatus(fn)") as number;
  } catch {
    return -1;
  }
}

// Status bit flags (V8 ~12.x / Node.js 24)
export const NEVER_OPTIMIZED = 2; // bailed out permanently
export const IS_OPTIMIZED = 16; // TurboFan/Turboshaft
export const IS_MAGLEV = 32; // Maglev mid-tier JIT

export function reportOptimizationStatus(fn: Function, label: string): void {
  const s = getOptimizationStatus(fn);
  if (s === -1) {
    console.log(`[v8] ${label}: --allow-natives-syntax not active`);
    return;
  }
  const opt = (s & IS_OPTIMIZED) !== 0;
  const mag = (s & IS_MAGLEV) !== 0;
  const never = (s & NEVER_OPTIMIZED) !== 0;
  console.log(`[v8] ${label}: status=${s} optimized=${opt} maglev=${mag} neverOptimized=${never}`);
}
