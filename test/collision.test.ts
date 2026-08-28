// What happens to a name that is already in use, and who is allowed to say "overwrite".
//
// ⛔ What is pinned here is the rule the owner gave: an agent picks rename unless a mode is on.
//    Not that the file parses -- that the destructive answer needs something to have been turned
//    on deliberately, and that a person's own setting is not second-guessed.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ANSWER_NUMBER, COLLISION_MEANS, DEFAULT_COLLISION, decide, readAnswer } from "../src/collision.ts";
import { onCollision } from "../src/commands/on-collision.ts";

test("nothing chosen means rename — the direction that destroys nothing", () => {
  assert.equal(DEFAULT_COLLISION, "rename");
  assert.equal(decide(undefined, "rename", "off").choice, "rename");
});

test("a person's stored answer stands, whatever autonomy is set to", () => {
  // Setup asks while somebody is there. Overriding that later would ignore the one answer from a
  // person this tool actually has.
  assert.deepEqual(decide(undefined, "overwrite", "off"), { choice: "overwrite", by: "setting" });
  assert.deepEqual(decide(undefined, "overwrite", "auto"), { choice: "overwrite", by: "setting" });
});

test("⛔ an agent asking to overwrite with no mode on gets a rename, and it is said", () => {
  const decision = decide("overwrite", "rename", "off");
  assert.equal(decision.choice, "rename");
  assert.equal(decision.by, "agent-refused");
});

test("with a mode on, an agent may ask for an overwrite", () => {
  assert.deepEqual(decide("overwrite", "rename", "auto"), { choice: "overwrite", by: "asked-for" });
  assert.deepEqual(decide("overwrite", "rename", "skip-permissions"), {
    choice: "overwrite",
    by: "asked-for",
  });
});

test("⛔ a mode never turns a rename into an overwrite — the override is one way", () => {
  assert.equal(decide("rename", "overwrite", "skip-permissions").choice, "rename");
});

test("each choice says what it does in one line, and the destructive one says it cannot be undone", () => {
  for (const line of Object.values(COLLISION_MEANS)) {
    assert.ok(line.length > 0 && line.length < 120, `not one line: ${line}`);
  }
  assert.match(COLLISION_MEANS.overwrite, /cannot be brought back/);
});

test("⛔ only the exact number means overwrite — everything else is the safe answer", () => {
  // A closed pipe, a stray space, a habit of typing y: none of these mean "delete my files".
  assert.equal(readAnswer("2"), "overwrite");
  assert.equal(readAnswer(" 2 "), "overwrite");
  for (const typed of ["", "1", "y", "yes", "overwrite", "22", "2 2", "o"]) {
    assert.equal(readAnswer(typed), "rename", `"${typed}" was read as overwrite`);
  }
});

test("the numbers the question prints are the numbers it reads", () => {
  // Two places could drift: what setup prints and what it accepts. They come from one table.
  assert.equal(readAnswer(ANSWER_NUMBER.overwrite), "overwrite");
  assert.equal(readAnswer(ANSWER_NUMBER.rename), "rename");
});

test("`nmts on-collision` prints what is set and how to change it", () => {
  const lines: string[] = [];
  assert.equal(onCollision(undefined, { write: (l) => lines.push(l) }), 0);
  const said = lines.join("\n");
  assert.match(said, /rename/);
  assert.match(said, /overwrite/);
  assert.match(said, /on-collision <rename\|overwrite>/, "it did not say how to change it");
});

test("an answer it does not know is refused by name, not stored", () => {
  assert.throws(() => onCollision("maybe", { write: () => {} }), /no such answer/i);
});
