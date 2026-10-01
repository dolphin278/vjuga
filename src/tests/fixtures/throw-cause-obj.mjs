export default () => {
  throw new Error("x", { cause: { message: "m" } });
};
