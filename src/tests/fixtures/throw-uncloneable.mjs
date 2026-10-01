export default () => {
  const err = new Error("fn prop");
  err.fn = () => 1;
  err.ok = 7;
  throw err;
};
