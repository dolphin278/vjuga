// Counts its own evaluations so tests can detect duplicate module instances.
globalThis.__refCountedEvals = (globalThis.__refCountedEvals ?? 0) + 1;
let state = 0;
export function inc() {
  return ++state;
}
export function get() {
  return state;
}
export default function current() {
  return state;
}
