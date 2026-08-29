// What adding a file does when its name is already in use — the whole rule, with no server in it.
//
// ⛔ WHAT IS PINNED HERE is not that overwriting works. It is the three cases where this tool must
//    NOT overwrite even when the machine is set to: a folder holding the name, a file already in
//    the trash holding it, and a file in a different folder that only looks like a collision.
//
// ⛔ AND THAT AN OVERWRITE TRASHES RATHER THAN DESTROYS. `POST /v1/items/erase` is closed to an API
//    key on purpose, so a plan that claimed to erase would be a plan this package cannot carry out.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { planAddition } from "../src/manifest-write.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";

const AT = 1_800_000_000_000;

const file = (id: string, name: string, parentId: string | null = null): ManifestEntry => ({
  id,
  parentId,
  kind: 1,
  name,
  size: 10,
  createdAt: AT,
  updatedAt: AT,
  dekWrapped: "d",
});
const folder = (id: string, name: string, parentId: string | null = null): ManifestEntry => ({
  ...file(id, name, parentId),
  kind: 0,
  size: 0,
});
const incoming = file("new", "report.pdf");

test("a free name is just added", () => {
  const plan = planAddition([], incoming, "overwrite", AT);
  assert.equal(plan.name, "report.pdf");
  assert.equal(plan.replaced, undefined);
  assert.deepEqual(plan.intents, [{ op: "add", entry: incoming }]);
});

test("set to rename, a taken name is numbered and nothing is touched", () => {
  const plan = planAddition([file("old", "report.pdf")], incoming, "rename", AT);
  assert.equal(plan.name, "report (2).pdf");
  assert.equal(plan.replaced, undefined);
  assert.equal(plan.intents.length, 1);
});

test("set to overwrite, the old file goes to the trash and the new one keeps the name", () => {
  const plan = planAddition([file("old", "report.pdf")], incoming, "overwrite", AT);
  assert.equal(plan.name, "report.pdf");
  assert.deepEqual(plan.replaced, { id: "old", name: "report.pdf" });
  assert.deepEqual(plan.intents, [
    { op: "trash", ids: ["old"], at: AT },
    { op: "add", entry: incoming },
  ]);
});

test("⛔ the trash, never an erase — this package cannot destroy a stored row", () => {
  const plan = planAddition([file("old", "report.pdf")], incoming, "overwrite", AT);
  assert.equal(plan.intents.some((i) => i.op === "purge"), false, "planned a permanent destruction");
});

test("⛔ a FOLDER holding the name is never replaced", () => {
  // Replacing it would delete the folder and everything under it in order to store one file.
  const plan = planAddition([folder("dir", "report.pdf")], incoming, "overwrite", AT);
  assert.equal(plan.replaced, undefined);
  assert.equal(plan.name, "report (2).pdf");
});

test("⛔ a file ALREADY in the trash is not displaced", () => {
  const trashed = { ...file("old", "report.pdf"), deletedAt: AT };
  const plan = planAddition([trashed], incoming, "overwrite", AT);
  assert.equal(plan.replaced, undefined, "destroyed something already on its way out");
  // It still holds its name, so restoring it must not land on top of the new file.
  assert.equal(plan.name, "report (2).pdf");
});

test("the same name in a different folder is not a collision", () => {
  const plan = planAddition([file("elsewhere", "report.pdf", "dir")], incoming, "overwrite", AT);
  assert.equal(plan.replaced, undefined);
  assert.equal(plan.name, "report.pdf");
});

test("names are compared the way the drive folds them", () => {
  // The same characters written two ways are one name; the drive normalises, so this must too.
  const decomposed = { ...incoming, name: "cafe\u0301.txt" };
  const plan = planAddition([file("old", "caf\u00e9.txt")], decomposed, "overwrite", AT);
  assert.deepEqual(plan.replaced, { id: "old", name: "caf\u00e9.txt" });
});

test("⛔ an id already in the list is not added a second time", () => {
  const plan = planAddition([{ ...incoming, name: "report (2).pdf" }], incoming, "overwrite", AT);
  assert.deepEqual(plan.intents, []);
  assert.equal(plan.alreadyThere, "report (2).pdf");
  assert.equal(plan.name, "report (2).pdf");
});
