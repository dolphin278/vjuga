export default (x) => {
  if (x === "fn") throw { fn() {} };
  throw { code: 7, nested: { a: [1, 2] } };
};
