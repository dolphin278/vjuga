import * as assert from "node:assert/strict";
import { test } from "node:test";
import { escape } from "../HTML.js";

test("escape", () => {
  assert.equal(escape(""), "");
  assert.equal(escape("foo"), "foo");
  assert.equal(escape("foo<bar"), "foo&lt;bar");
  assert.equal(escape("foo>bar"), "foo&gt;bar");
  assert.equal(escape("foo&bar"), "foo&amp;bar");
  assert.equal(escape('foo"bar'), "foo&quot;bar");
  assert.equal(escape("foo'bar"), "foo&#039;bar");
  assert.equal(
    escape("foo<bar>baz&qux\"quux'corge"),
    "foo&lt;bar&gt;baz&amp;qux&quot;quux&#039;corge"
  );
});
