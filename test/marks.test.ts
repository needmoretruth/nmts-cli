// The three marks — star, pin and label — set and cleared from the command line.
//
// ⛔ EVERY ASSERTION READS THE SEALED LIST THE TOOL ACTUALLY SENT, opened with the engine. What
//    the command printed is the one thing that cannot stand in for it: a mark that was announced
//    and not written looks identical on the terminal.
//
// ⛔ AND "OFF" IS ASSERTED AS ABSENCE, not as `false`. The format spells a mark that is off by
//    leaving the field out, so a tool that wrote `favorite: false` would round-trip through the
//    codec as off while adding a member to every entry anybody ever un-starred.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { label, pin, star, unlabel, unpin, unstar } from "../src/commands/marks.ts";
import { NmtsError } from "../src/errors.ts";
import { marksOf, markSuffix } from "../src/mark-render.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { collect, entry, folder, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});
const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};
const two = (): ManifestEntry[] => [entry({ id: "a", name: "a.txt" }), entry({ id: "b", name: "b.txt" })];

// ── the star ──────────────────────────────────────────────────────────────────────────────────

test("star marks every file named, in one write", async () => {
  await withSandbox(drive, "mark-star", async (code) => {
    await drive.serve(code, two());
    const out = collect();
    assert.equal(await star(["a.txt", "b.txt"], opts(out)), 0);

    assert.equal(drive.written.length, 1, `it wrote the list ${drive.written.length} times`);
    const after_ = await drive.lastWritten(code);
    assert.equal(after_.find((e) => e.id === "a")?.favorite, true);
    assert.equal(after_.find((e) => e.id === "b")?.favorite, true);
    assert.match(out.lines.join("\n"), /Starred "a\.txt", "b\.txt"/);
  });
});

test("⛔ unstar takes the field away entirely rather than writing that it is off", async () => {
  await withSandbox(drive, "mark-unstar", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", favorite: true })]);
    assert.equal(await unstar(["a.txt"], opts(collect())), 0);
    const only = (await drive.lastWritten(code))[0];
    assert.ok(only !== undefined);
    assert.equal(Object.hasOwn(only, "favorite"), false, "off was written as a value, not as absence");
  });
});

test("starring what is already starred writes nothing at all", async () => {
  await withSandbox(drive, "mark-star-again", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", favorite: true })]);
    const out = collect();
    assert.equal(await star(["a.txt"], opts(out)), 0);
    // A no-op costs every other device a download of the whole list for nothing.
    assert.equal(drive.written.length, 0, "it rewrote the list for a mark that was already on");
    assert.match(out.lines.join("\n"), /already starred/);
  });
});

// ── the pin ───────────────────────────────────────────────────────────────────────────────────

test("pin and unpin move only the pin, leaving the other marks where they were", async () => {
  await withSandbox(drive, "mark-pin", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", favorite: true })]);
    assert.equal(await pin(["a.txt"], opts(collect())), 0);
    const pinned = (await drive.lastWritten(code)).find((e) => e.id === "a");
    assert.equal(pinned?.pinned, true);
    // ⛔ Discriminating: a version that replaced the marks rather than adding one would also make
    //    the line above pass.
    assert.equal(pinned?.favorite, true, "pinning cleared the star");

    assert.equal(await unpin(["a.txt"], opts(collect())), 0);
    const back = (await drive.lastWritten(code)).find((e) => e.id === "a");
    assert.ok(back !== undefined);
    assert.equal(Object.hasOwn(back, "pinned"), false);
    assert.equal(back.favorite, true, "unpinning cleared the star");
  });
});

// ── labels ────────────────────────────────────────────────────────────────────────────────────

test("label puts one label on several files, and unlabel drops the field when the last one goes", async () => {
  await withSandbox(drive, "mark-label", async (code) => {
    await drive.serve(code, two());
    assert.equal(await label("work", ["a.txt", "b.txt"], opts(collect())), 0);
    assert.equal(drive.written.length, 1);
    const on = await drive.lastWritten(code);
    assert.deepEqual(on.find((e) => e.id === "a")?.labels, ["work"]);
    assert.deepEqual(on.find((e) => e.id === "b")?.labels, ["work"]);

    // A second label joins the first rather than replacing it.
    assert.equal(await label("home", ["a.txt"], opts(collect())), 0);
    assert.deepEqual((await drive.lastWritten(code)).find((e) => e.id === "a")?.labels, ["work", "home"]);

    assert.equal(await unlabel("work", ["a.txt", "b.txt"], opts(collect())), 0);
    const off = await drive.lastWritten(code);
    assert.deepEqual(off.find((e) => e.id === "a")?.labels, ["home"]);
    const b = off.find((e) => e.id === "b");
    assert.ok(b !== undefined);
    assert.equal(Object.hasOwn(b, "labels"), false, "an empty label list was written instead of none");
  });
});

test("the same label put on twice is not worn twice", async () => {
  await withSandbox(drive, "mark-label-twice", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt", labels: ["work"] })]);
    const out = collect();
    assert.equal(await label("work", ["a.txt"], opts(out)), 0);
    assert.equal(drive.written.length, 0, "it wrote a second copy of a label already worn");
    assert.match(out.lines.join("\n"), /already wearing "work"/);
  });
});

test("⛔ a label that is only spaces is refused — it would name nothing anybody could ever pick", async () => {
  await withSandbox(drive, "mark-label-blank", async (code) => {
    await drive.serve(code, two());
    const failure = await refusal(label("   ", ["a.txt"], opts(collect())));
    assert.equal(failure.exitCode, 2);
    assert.equal(drive.written.length, 0);
  });
});

// ── what a mark may be put on ─────────────────────────────────────────────────────────────────

test("⛔ a folder cannot be marked — nothing would ever show it", async () => {
  await withSandbox(drive, "mark-folder", async (code) => {
    await drive.serve(code, [folder({ id: "F", name: "photos" })]);
    // ⚠ Made one at a time: a promise that rejects before the loop reaches it is an unhandled
    //   rejection, and the runner fails the test for it rather than for what it was testing.
    for (const run of [
      () => star(["photos"], opts(collect())),
      () => pin(["photos"], opts(collect())),
      () => label("work", ["photos"], opts(collect())),
    ]) {
      const failure = await refusal(run());
      assert.equal(failure.exitCode, 4);
      assert.match(failure.message, /marks are for files/);
    }
    assert.equal(drive.written.length, 0);
  });
});

test("⛔ one path that names nothing refuses the whole run", async () => {
  await withSandbox(drive, "mark-refuse", async (code) => {
    await drive.serve(code, two());
    const failure = await refusal(star(["a.txt", "gone.txt"], opts(collect())));
    assert.equal(failure.exitCode, 4);
    assert.equal(drive.written.length, 0, "it marked part of a run it could not finish");
  });
});

// ── the compare-and-swap retry ────────────────────────────────────────────────────────────────

test("⛔ a mark that loses the race asks again which file the path names", async () => {
  await withSandbox(drive, "mark-race", async (code) => {
    await drive.serve(code, two());
    // While the tool is writing, another device renames the file out from under the path.
    await drive.otherDeviceWrites(code, [
      entry({ id: "a", name: "renamed.txt" }),
      entry({ id: "b", name: "b.txt" }),
    ]);

    const failure = await refusal(star(["a.txt"], opts(collect())));
    // ⛔ Deciding once, outside the attempt, would star the file at that id anyway — a mark on
    //    something the caller never named, put there by a path that no longer points at it.
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /Nothing in this account is at/);
    assert.equal(drive.written.length, 0);
  });
});

// ── how a mark is shown ───────────────────────────────────────────────────────────────────────

test("the marks of an entry are always all three, so absent and unsaid do not look the same", () => {
  assert.deepEqual(marksOf(entry({ id: "a", name: "a.txt" })), {
    favorite: false,
    pinned: false,
    labels: [],
  });
  assert.deepEqual(marksOf(entry({ id: "a", name: "a.txt", favorite: true, labels: ["work"] })), {
    favorite: true,
    pinned: false,
    labels: ["work"],
  });
});

test("a row with no marks gets no suffix at all", () => {
  assert.equal(markSuffix(marksOf(entry({ id: "a", name: "a.txt" }))), "");
});

test("the suffix names every mark, and quotes labels so one cannot read as two", () => {
  const drawn = markSuffix(
    marksOf(entry({ id: "a", name: "a.txt", favorite: true, pinned: true, labels: ["work, home"] })),
  );
  assert.equal(drawn, `  [starred, pinned, labels: "work, home"]`);
});
