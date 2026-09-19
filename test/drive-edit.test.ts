// The list edits without a terminal: what each refusal ANSWERS, now that two packages read it.
//
// ⛔ THE CODE IS THE PART A PROGRAM READS. The commands print the sentence and a person acts on it;
//    the SDK hands the same failure to somebody else's program, which branches on `error.code` and
//    can read no English at all. So every refusal this module makes is held to its code here, once
//    each — a refusal that arrives with the wrong word is a program taking the wrong branch while
//    the terminal still looks right.
//
// ⛔ AND EVERY ONE OF THEM PROVES THE LIST WAS NOT WRITTEN. A refusal that has already saved
//    something is worse than no refusal: the caller is told nothing happened and it did.
//
// ⚠ The commands' own tests (`organise.test.ts`, `inherited-trash.test.ts`, `batch.test.ts`) stay
//   where they are and keep judging the printed output and the server calls. This file is about the
//   answers those tests cannot see.

import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";

import { identityOf } from "../src/account.ts";
import {
  DriveEditError,
  makeFolder,
  moveEntries,
  renameEntry,
  trashPaths,
  type DriveEditCode,
} from "../src/drive-edit.ts";
import type { ListEditInput } from "../src/manifest-write.ts";
import { entry, folder, KEY, startFakeDrive, withSandbox, type FakeDrive } from "./fake-drive.ts";

let drive: FakeDrive;
before(async () => {
  drive = await startFakeDrive();
});
after(() => drive.close());

/** What every function here takes: where to talk, what opens the list, and whose list it is. */
async function inputFor(code: string): Promise<ListEditInput> {
  return { server: drive.base, apiKey: KEY, code, accountId: (await identityOf(code)).accountId };
}

/** The refusal, held to its code and to having written nothing. */
async function refusal(code: DriveEditCode, body: Promise<unknown>): Promise<DriveEditError> {
  const error: unknown = await body.then(() => null, (e: unknown) => e);
  assert.ok(error instanceof DriveEditError, `the refusal was ${String(error)}, which carries no code`);
  assert.equal(error.code, code);
  assert.equal(drive.written.length, 0, "it wrote a file list for a refusal");
  return error;
}

test("⛔ a path nothing is at refuses with NOT_FOUND", async () => {
  await withSandbox(drive, "edit-not-found", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "notes.txt" })]);
    const error = await refusal("NOT_FOUND", renameEntry(await inputFor(code), "gone.txt", "other.txt"));
    // ⚠ The sentence is the path module's own, carried through rather than replaced: it says which
    //   of the three ways a path fails this was, and nothing here could say it better.
    assert.match(error.message, /Nothing in this account is at "gone\.txt"/);
    assert.equal(error.exitCode, 4);
  });
});

test("⛔ moving onto a name that folder already holds refuses with NAME_TAKEN", async () => {
  await withSandbox(drive, "edit-name-taken", async (code) => {
    await drive.serve(code, [
      folder({ id: "f1", name: "archive" }),
      entry({ id: "a", name: "notes.txt" }),
      entry({ id: "b", name: "notes.txt", parentId: "f1" }),
    ]);
    await refusal("NAME_TAKEN", moveEntries(await inputFor(code), ["notes.txt"], "archive"));
  });
});

test("⛔ a new name that is really a path refuses with BAD_NAME, before the list is even read", async () => {
  await withSandbox(drive, "edit-bad-name", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "notes.txt" })]);
    const error = await refusal("BAD_NAME", renameEntry(await inputFor(code), "notes.txt", "archive/notes.txt"));
    assert.equal(error.exitCode, 2);
    // ⛔ Discriminating: a version that checked the name AFTER reading the list would also refuse,
    //    and would have told the server which account is being edited to do it.
    assert.deepEqual(drive.calls, [], "it asked the server about a name it was never going to use");
  });
});

test("⛔ a folder asked into its own subtree refuses with INTO_ITSELF", async () => {
  await withSandbox(drive, "edit-into-itself", async (code) => {
    await drive.serve(code, [folder({ id: "f1", name: "photos" }), folder({ id: "f2", name: "2026", parentId: "f1" })]);
    await refusal("INTO_ITSELF", moveEntries(await inputFor(code), ["photos"], "photos/2026"));
  });
});

test("⛔ `strict` turns restore's skip into NOT_IN_TRASH, and without it the same path is named and left", async () => {
  await withSandbox(drive, "edit-not-in-trash", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "notes.txt" })]);
    const input = await inputFor(code);
    await refusal("NOT_IN_TRASH", trashPaths(input, "restore", ["notes.txt"], { strict: true }));
    // ⛔ THE OTHER HALF OF THE SAME FACT. A person is told and keeps the rest of their run; the
    //    difference between the two callers is this flag and nothing else.
    const outcome = await trashPaths(input, "restore", ["notes.txt"]);
    assert.deepEqual(outcome.paths, []);
    assert.deepEqual(outcome.skipped, ["notes.txt"]);
    assert.equal(outcome.changed, false);
  });
});

test("⛔ a restore that another device's name would land on refuses with NAME_TAKEN", async () => {
  await withSandbox(drive, "edit-restore-collides", async (code) => {
    const trashed = entry({ id: "a", name: "notes.txt", deletedAt: 5 });
    await drive.serve(code, [trashed]);
    // ⛔ THE ONLY WAY THIS STATE EXISTS, and the reason the check sits inside the attempt: while
    //    the list is being read, one path cannot name both a trashed entry and a live one — it
    //    would be ambiguous and refused. Another device taking the name between the read and the
    //    write is what leaves two entries at one path, which no lookup can get out of afterwards.
    await drive.otherDeviceWrites(code, [trashed, entry({ id: "b", name: "notes.txt" })]);
    await refusal("NAME_TAKEN", trashPaths(await inputFor(code), "restore", ["notes.txt"], { strict: true }));
    // ⛔ THE ROW WENT LIVE BEFORE THE LIST REFUSED, so the refusal has to put it back: the last
    //    thing the server heard about this file must be the trash again, or the row is live under
    //    a list that says trashed.
    const aboutTheRow = drive.calls.filter((c) => /\/v1\/items\/a(\/restore)?$/.test(c));
    assert.deepEqual(aboutTheRow, ["POST /v1/items/a/restore", "DELETE /v1/items/a"]);
  });
});

test("the outcomes name where each thing came from and where it landed", async () => {
  await withSandbox(drive, "edit-outcomes", async (code) => {
    await drive.serve(code, [folder({ id: "f1", name: "archive" }), entry({ id: "a", name: "notes.txt" })]);
    const input = await inputFor(code);

    const made = await makeFolder(input, "/photos/2026/");
    assert.equal(made.path, "photos/2026", "the path was not folded to the drive's own spelling");
    assert.deepEqual(made.made, ["photos", "photos/2026"]);
    assert.ok(made.parentId !== null);

    // ⛔ `from` AND `path` ARE READ BY NOBODY ELSE. The command prints names, so a move that
    //    answered the wrong paths would pass every test the commands have.
    const moved = await moveEntries(input, ["notes.txt"], "archive");
    assert.deepEqual(
      moved.moved.map((m) => [m.from, m.path]),
      [["notes.txt", "archive/notes.txt"]],
    );
    assert.equal(moved.changed, true);

    const gone = await trashPaths(input, "rm", ["archive/notes.txt"]);
    assert.deepEqual(gone.paths, ["archive/notes.txt"]);
    assert.deepEqual(gone.ids, ["a"]);
    assert.equal(gone.files, 1, "the file's own server row was not counted");
  });
});
