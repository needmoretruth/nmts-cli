// The listing order, on its own — no server, no crypto, no account.
//
// ⛔ THESE ARE THE RULE ITSELF, NOT A SAMPLE OF IT. The order this tool prints has to be the order
//    the browser drive draws for the same account, and the only thing holding two transcriptions
//    together is a set of cases that fail when they part. So every clause of the rule gets a case
//    that can only pass one way: numeric name order, the tie-break, descending being the EXACT
//    reverse (which a sign-flipped comparator would not be), folders above files in both
//    directions, and the pinned rows lifted afterwards.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { NmtsError } from "../src/errors.ts";
import { orderRows, parseSortKey, SORT_KEYS, type OrderableRow } from "../src/list-view-order.ts";

/** One row with only the fields ordering reads. Files unless told otherwise. */
function row(over: Partial<OrderableRow> & Pick<OrderableRow, "name">): OrderableRow {
  return { size: 10, createdAt: 1_700_000_000_000, kind: 1, ...over };
}

const names = (rows: readonly OrderableRow[]): string[] => rows.map((r) => r.name);

test("names sort the way a person numbers files: 2 before 10", () => {
  const rows = [row({ name: "photo 10" }), row({ name: "photo 2" }), row({ name: "photo 1" })];
  assert.deepEqual(names(orderRows(rows, "name", "asc")), ["photo 1", "photo 2", "photo 10"]);
});

test("size sorts by size and date sorts by the instant the entry was created", () => {
  const rows = [
    row({ name: "big", size: 900, createdAt: 10 }),
    row({ name: "small", size: 1, createdAt: 30 }),
    row({ name: "middle", size: 50, createdAt: 20 }),
  ];
  assert.deepEqual(names(orderRows(rows, "size", "asc")), ["small", "middle", "big"]);
  assert.deepEqual(names(orderRows(rows, "date", "asc")), ["big", "middle", "small"]);
});

test("a tie on size or date falls back to the name, so the order never wobbles", () => {
  const rows = [row({ name: "c" }), row({ name: "a" }), row({ name: "b" })];
  assert.deepEqual(names(orderRows(rows, "size", "asc")), ["a", "b", "c"]);
  assert.deepEqual(names(orderRows(rows, "date", "asc")), ["a", "b", "c"]);
});

test("⛔ descending is the EXACT reverse of ascending — the tie-break turns round with it", () => {
  // ⛔ EVERYTHING HERE TIES ON SIZE, so the order is decided entirely by the name tie-break — and
  //    that is what makes this case discriminating. The obvious wrong implementation negates the
  //    PRIMARY key and leaves the tie-break running upwards, which hands back a · b · c for both
  //    directions. Reversing the finished list gives c · b · a, which is what the browser does.
  //    (Negating the WHOLE comparator, tie-break included, happens to agree with reversing except
  //    on rows that are equal in every field, so it is not what this case is aimed at.)
  const rows = [row({ name: "a" }), row({ name: "b" }), row({ name: "c" })];
  assert.deepEqual(names(orderRows(rows, "size", "asc")), ["a", "b", "c"]);
  assert.deepEqual(names(orderRows(rows, "size", "desc")), ["c", "b", "a"]);
  assert.deepEqual(names(orderRows(rows, "date", "desc")), ["c", "b", "a"]);
});

test("⛔ folders are their own group above the files, under every key and both directions", () => {
  const rows = [
    row({ name: "zebra.txt", size: 5 }),
    row({ name: "beta", kind: 0, size: 0 }),
    row({ name: "alpha.txt", size: 900 }),
    row({ name: "alps", kind: 0, size: 0 }),
  ];
  for (const key of SORT_KEYS) {
    const asc = names(orderRows(rows, key, "asc"));
    const desc = names(orderRows(rows, key, "desc"));
    assert.deepEqual(asc.slice(0, 2).sort(), ["alps", "beta"], `${key}/asc put a file above a folder`);
    assert.deepEqual(desc.slice(0, 2).sort(), ["alps", "beta"], `${key}/desc put a file above a folder`);
  }
  // And inside the groups the order is the sort's: by size the big file leads the small one, and
  // the folders — which hold no size of their own — fall back to their names.
  assert.deepEqual(names(orderRows(rows, "size", "desc")), ["beta", "alps", "alpha.txt", "zebra.txt"]);
});

test("folders have no size of their own, so sorting them by size sorts them by name", () => {
  const folders = [row({ name: "zeta", kind: 0, size: 0 }), row({ name: "alpha", kind: 0, size: 0 })];
  assert.deepEqual(names(orderRows(folders, "size", "asc")), ["alpha", "zeta"]);
});

test("a pinned row is lifted to the top of its group, keeping the order the sort gave it", () => {
  const rows = [
    row({ name: "a.txt", size: 1 }),
    row({ name: "z.txt", size: 900, pinned: true }),
    row({ name: "m.txt", size: 50 }),
    row({ name: "p.txt", size: 40, pinned: true }),
  ];
  assert.deepEqual(names(orderRows(rows, "size", "asc")), ["p.txt", "z.txt", "a.txt", "m.txt"]);
  assert.deepEqual(names(orderRows(rows, "size", "desc")), ["z.txt", "p.txt", "m.txt", "a.txt"]);
});

test("the rows handed in are left alone — the caller's array keeps its own order", () => {
  const rows = [row({ name: "c" }), row({ name: "a" }), row({ name: "b" })];
  orderRows(rows, "name", "asc");
  assert.deepEqual(names(rows), ["c", "a", "b"]);
});

test("⛔ a key this cannot sort by is a wrong command line: exit 2, and it names the three", () => {
  for (const key of SORT_KEYS) assert.equal(parseSortKey(key), key);
  let failure: unknown = null;
  try {
    parseSortKey("largest");
  } catch (error: unknown) {
    failure = error;
  }
  assert.ok(failure instanceof NmtsError, "a key nobody can sort by was accepted");
  assert.equal(failure.exitCode, 2);
  for (const key of SORT_KEYS) {
    assert.match(`${failure.message} ${failure.nextStep ?? ""}`, new RegExp(key));
  }
});
