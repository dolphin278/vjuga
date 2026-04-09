export default () => {
  const cause = new TypeError("root");
  cause.code = 42;
  throw new Error("boom", { cause });
};
