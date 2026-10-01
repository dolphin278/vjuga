import * as Immutable from "../Immutable.js";

const x: Immutable.Immutable<{ o: 1; arr: [] }> = { o: 1, arr: [] };

// @ts-expect-error
x.o = 3;

// @ts-expect-error
x.arr.push(3);

// @ts-expect-error
x.arr.pop();

const y = { o: 1 };
y.o = 2;

const z = Immutable.make({ o: 1 });

// @ts-expect-error
z.o = 2;

// G1-1: functions, Date and ReadonlyMap/ReadonlySet remain usable.
const cfg = Immutable.make({ onDone: (x: number) => x + 1, m: new Map<string, number>() });
const n: number = cfg.onDone(1);
cfg.m.get("a");
// @ts-expect-error Map is mapped to ReadonlyMap
cfg.m.set("a", 1);

const d = Immutable.make(new Date());
const time: number = d.getTime();

const rm: ReadonlyMap<string, number> = new Map();
const irm = Immutable.make(rm);
const got: number | undefined = irm.get("a");

const rs: ReadonlySet<string> = new Set();
const irs = Immutable.make(rs);
const has: boolean = irs.has("a");
// @ts-expect-error ReadonlySet has no add
irs.add("b");

void [n, time, got, has];
