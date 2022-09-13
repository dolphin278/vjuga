import { Immutable, make } from "../Immutable.js";

const x: Immutable<{ o: 1; arr: [] }> = { o: 1, arr: [] };

// @ts-expect-error
x.o = 3;

// @ts-expect-error
x.arr.push(3);

// @ts-expect-error
x.arr.pop();

const y = { o: 1 };
y.o = 2;

const z = make({ o: 1 });

// @ts-expect-error
z.o = 2;
