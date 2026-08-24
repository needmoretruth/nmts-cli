// The check that stands between a model's arguments and a tool that spends money.
//
// ⛔ THE CASE THIS FILE EXISTS FOR is the last one: a tool that declares `dry_run: boolean` being
//    called with the STRING "true". Before this check, that call ran the paid branch, because the
//    tool tested `args["dry_run"] === true` and a string is not `true`. The caller asked for a
//    price and was charged. Every other test here is scaffolding around that one.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { checkArgs, unsupported } from "../src/mcp-args.ts";

const SCHEMA = {
  type: "object",
  properties: {
    file: { type: "string", description: "a path" },
    dry_run: { type: "boolean", description: "price it and stop" },
    count: { type: "integer", description: "how many" },
    paths: { type: "array", items: { type: "string" }, description: "several" },
    sort: { type: "string", enum: ["name", "size"], description: "order" },
  },
  required: ["file"],
  additionalProperties: false,
};

test("a correct call has nothing to say about it", () => {
  assert.deepEqual(checkArgs(SCHEMA, { file: "a.txt", dry_run: true, count: 2, paths: ["x"] }), []);
  assert.deepEqual(checkArgs(SCHEMA, { file: "a.txt" }), []);
});

test("a missing required argument is named", () => {
  assert.deepEqual(checkArgs(SCHEMA, { dry_run: true }), ["`file` is required"]);
});

test("an argument the tool does not take is refused when the schema is closed", () => {
  const problems = checkArgs(SCHEMA, { file: "a.txt", to: "/etc" });
  assert.deepEqual(problems, ["`to` is not an argument this tool takes"]);
});

test("an open schema lets an unknown argument by", () => {
  const open = { type: "object", properties: { file: { type: "string" } } };
  assert.deepEqual(checkArgs(open, { file: "a.txt", extra: 1 }), []);
});

test("arguments that are not an object at all are refused, and the reply says what arrived", () => {
  assert.deepEqual(checkArgs(SCHEMA, "file=a.txt"), [
    "arguments must be an object, and this call sent string",
  ]);
  assert.deepEqual(checkArgs(SCHEMA, ["a.txt"]), [
    "arguments must be an object, and this call sent array",
  ]);
  assert.deepEqual(checkArgs(SCHEMA, null), ["arguments must be an object, and this call sent null"]);
});

test("a key explicitly set to undefined counts as not given, not as given-wrong", () => {
  // JSON cannot carry `undefined`, so a key holding it was built on this side and means "omitted".
  assert.deepEqual(checkArgs(SCHEMA, { file: "a.txt", dry_run: undefined }), []);
  assert.deepEqual(checkArgs(SCHEMA, { file: undefined }), ["`file` is required"]);
});

test("a whole number is an integer and a fractional one is not", () => {
  assert.deepEqual(checkArgs(SCHEMA, { file: "a.txt", count: 2 }), []);
  assert.deepEqual(checkArgs(SCHEMA, { file: "a.txt", count: 2.5 }), [
    "`count` must be integer, and this call sent number",
  ]);
});

test("an array is checked item by item, and the reply says which one", () => {
  assert.deepEqual(checkArgs(SCHEMA, { file: "a.txt", paths: ["a", 2] }), [
    "`paths` must hold string values, and item 2 is integer",
  ]);
});

test("a value outside a declared set is refused and the set is printed", () => {
  assert.deepEqual(checkArgs(SCHEMA, { file: "a.txt", sort: "colour" }), [
    "`sort` must be one of name, size — this call sent colour",
  ]);
});

test("⛔ a boolean sent as the string \"true\" is refused, not treated as false and not as true", () => {
  const problems = checkArgs(SCHEMA, { file: "a.txt", dry_run: "true" });
  assert.deepEqual(problems, ["`dry_run` must be boolean, and this call sent string"]);
});

test("what the checker cannot judge is listed rather than skipped", () => {
  assert.deepEqual(unsupported(SCHEMA), []);
  assert.deepEqual(unsupported({ type: "object", properties: { n: { type: "number", minimum: 1 } } }), [
    "n.minimum",
  ]);
  assert.deepEqual(unsupported({ type: "object", oneOf: [], properties: {} }), ["oneOf"]);
  assert.deepEqual(unsupported({ type: "object", properties: { n: { description: "no type" } } }), [
    "n.type",
  ]);
});
