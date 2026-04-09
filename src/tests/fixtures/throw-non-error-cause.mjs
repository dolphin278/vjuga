export default () => {
  throw new Error("oops", { cause: "string cause" });
};
