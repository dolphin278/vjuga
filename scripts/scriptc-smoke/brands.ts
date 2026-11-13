// Object-base and stacked brands: the nested record under the brand symbol.
import { brand, type Branded } from "../../src/FunctionUtils.js";
import { isoTimestamp, type ISOTimestamp } from "../../src/ISOTimestamp.js";
type Fragment = Branded<{ id: string }, "Fragment">;
const isFragment = (v: { id: string }): v is Fragment => v.id.length > 0;
const obj = { id: "x" };
const frags: Fragment[] = [];
if (isFragment(obj)) frags.push(obj);
frags.push(brand<{ id: string }, "Fragment">({ id: "y" }));
type Utc = Branded<ISOTimestamp, "Utc">;
const u: Utc = brand<ISOTimestamp, "Utc">(isoTimestamp("2024-01-01T00:00:00Z"));
const base: ISOTimestamp = u;
console.log(frags.map((f) => f.id).join(","), base);
