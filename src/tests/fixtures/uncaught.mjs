// "boom": raises an uncaught exception inside the worker (after READY); anything else echoes.
export default (x) => {
  if (x !== "boom") return x;
  setTimeout(() => {
    throw new Error("uncaught in worker");
  }, 10);
  return new Promise(() => {});
};
