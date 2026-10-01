// Result is not structured-cloneable: postMessage throws on the worker side.
export default (x) => (x === "ok" ? "ok" : () => 1);
