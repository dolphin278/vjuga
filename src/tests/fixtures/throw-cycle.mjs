export default () => {
  const err = new Error("loop");
  err.cause = err;
  throw err;
};
