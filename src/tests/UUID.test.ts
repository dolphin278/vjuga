import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as UUID from "../UUID.js";
import { ValidationError } from "../schema/ValidationError.js";

// --- uuid (throwing constructor) ---

test("uuid() accepts valid v4 UUID (lowercase)", () => {
  const id = UUID.uuid("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(id, "550e8400-e29b-41d4-a716-446655440000");
});

test("uuid() accepts valid v4 UUID (uppercase) and lowercases it", () => {
  const id = UUID.uuid("550E8400-E29B-41D4-A716-446655440000");
  assert.equal(id, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(id, UUID.uuid("550e8400-e29b-41d4-a716-446655440000"));
});

test("uuid() accepts Nil and Max UUIDs (any case)", () => {
  assert.equal(UUID.uuid("00000000-0000-0000-0000-000000000000"), UUID.NIL);
  assert.equal(UUID.uuid("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"), UUID.MAX);
  assert.equal(UUID.version(UUID.NIL), 0);
  assert.equal(UUID.version(UUID.MAX), 15);
  assert.throws(() => UUID.uuid("00000000-0000-0000-0000-000000000001"), RangeError);
});

test("validator() lowercases and accepts Nil/Max", () => {
  const v = UUID.validator();
  const r = v("550E8400-E29B-41D4-A716-446655440000");
  assert.deepEqual(r, [true, "550e8400-e29b-41d4-a716-446655440000"]);
  assert.equal(v(UUID.NIL)[0], true);
  assert.equal(v(UUID.MAX)[0], true);
});

test("v7() uses fresh random bytes across pool refills and stays valid", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const id = UUID.v7();
    assert.equal(UUID.uuid(id), id);
    assert.equal(UUID.version(id), 7);
    seen.add(id);
  }
  assert.equal(seen.size, 1000);
});

test("uuid() accepts valid v7 UUID", () => {
  const id = UUID.uuid("01903f5a-6a3c-7b12-8f00-123456789abc");
  assert.equal(id, "01903f5a-6a3c-7b12-8f00-123456789abc");
});

test("uuid() rejects empty string", () => {
  assert.throws(() => UUID.uuid(""), RangeError);
});

test("uuid() rejects string with wrong length", () => {
  assert.throws(() => UUID.uuid("550e8400-e29b-41d4-a716"), RangeError);
});

test("uuid() rejects string with wrong variant bits", () => {
  // variant nibble is '0' instead of 8/9/a/b
  assert.throws(() => UUID.uuid("550e8400-e29b-41d4-0716-446655440000"), RangeError);
});

test("uuid() rejects non-hex characters", () => {
  assert.throws(() => UUID.uuid("550e8400-e29b-41d4-a716-44665544000g"), RangeError);
});

test("uuid() rejects string without dashes", () => {
  assert.throws(() => UUID.uuid("550e8400e29b41d4a716446655440000"), RangeError);
});

// --- v4 ---

test("v4() returns a valid UUID", () => {
  const id = UUID.v4();
  // Should not throw when validated
  UUID.uuid(id);
});

test("v4() returns version 4", () => {
  const id = UUID.v4();
  assert.equal(UUID.version(id), 4);
});

test("v4() returns unique values", () => {
  const a = UUID.v4();
  const b = UUID.v4();
  assert.notEqual(a, b);
});

// --- v7 ---

test("v7() returns a valid UUID", () => {
  const id = UUID.v7();
  // Should not throw when validated
  UUID.uuid(id);
});

test("v7() returns version 7", () => {
  const id = UUID.v7();
  assert.equal(UUID.version(id), 7);
});

test("v7() returns unique values", () => {
  const a = UUID.v7();
  const b = UUID.v7();
  assert.notEqual(a, b);
});

test("v7() embeds current timestamp (approximately)", () => {
  const before = Date.now();
  const id = UUID.v7();
  const after = Date.now();
  // Extract 48-bit timestamp from first 12 hex chars (bytes 0-5)
  const hex = id.replace(/-/g, "").substring(0, 12);
  const embedded = parseInt(hex, 16);
  assert.ok(embedded >= before, `embedded ${embedded} >= before ${before}`);
  assert.ok(embedded <= after, `embedded ${embedded} <= after ${after}`);
});

// --- version ---

test("version() extracts version 4 from v4 UUID", () => {
  assert.equal(UUID.version(UUID.uuid("550e8400-e29b-41d4-a716-446655440000")), 4);
});

test("version() extracts version 7 from v7 UUID", () => {
  assert.equal(UUID.version(UUID.uuid("01903f5a-6a3c-7b12-8f00-123456789abc")), 7);
});

test("version() extracts version 1 from v1 UUID", () => {
  assert.equal(UUID.version(UUID.uuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8")), 1);
});

// --- validator ---

test("validator() returns Ok for valid UUID", () => {
  const v = UUID.validator();
  const r = v("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(r[0], true);
  assert.equal(r[1], "550e8400-e29b-41d4-a716-446655440000");
});

test("validator() returns Err for non-string", () => {
  const v = UUID.validator();
  const r = v(42);
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});

test("validator() returns Err for invalid UUID string", () => {
  const v = UUID.validator();
  const r = v("not-a-uuid");
  assert.equal(r[0], false);
  assert.ok(r[1] instanceof ValidationError);
});
