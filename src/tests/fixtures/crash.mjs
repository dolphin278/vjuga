export default (x) => {
  if (x === "crash") process.exit(1);
  return x;
};
