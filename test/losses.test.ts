// `nmts losses` against a real local server: the daily check's findings, a re-check, and a dismiss.
//
// ⛔ THE LINES ARE ASSERTED WHOLE, not matched for a word. This output is a notice the law is
//    behind — what it says about a date, about there being no file name, and about what NMTS
//    cannot do — and a test that only looked for "missing" would pass over a sentence that had
//    lost the part somebody is owed.
//
// ⛔ AND THE ONE THAT MATTERS MOST IS THE REFUSAL. Putting a line down is a person saying they
//    have read it, so a mode that lets an agent decide must not reach it. A regression there is
//    silent: the line goes, the drive looks clean, and nobody was ever told.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { setMode } from "../src/autonomy.ts";
import { NmtsError } from "../src/errors.ts";
import { losses } from "../src/commands/losses.ts";
import { collect, startFakeDrive, withSandbox, type LossRow } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

/** One row of the server's answer, with the flags a test does not care about turned off. */
function row(over: Partial<LossRow> & Pick<LossRow, "blob_object_id">): LossRow {
  return { first_seen: "2026-08-30T04:05:06Z", required_notice: false, restricted: false, ...over };
}

const FOOTER = [
  `The date is when a check first could not find it, not when the storage went. There is no file ` +
    `name: the server cannot pair the object with a file, and NMTS cannot see inside files.`,
  "`nmts losses --recheck <id>` asks the chain again now. `nmts losses --dismiss <id>` takes a " +
    "line off once you have read it; the incident stays in a record that names nobody.",
];

test("nothing missing says so — and does not say nothing is gone", async () => {
  await withSandbox(drive, "losses-empty", async () => {
    const out = collect();
    assert.equal(await losses(opts(out)), 0);
    assert.deepEqual(out.lines, [
      "The daily check has found nothing missing for this account.",
      "It samples the storage NMTS bought with your credits once a day and asks the chain whether " +
        "it is still there.",
    ]);

    const json = collect();
    assert.equal(await losses({ ...opts(json), json: true }), 0);
    assert.deepEqual(JSON.parse(json.lines.join("")), { losses: [] });
  });
});

test("one missing object: what was measured, the day it was missed, and no file name", async () => {
  await withSandbox(drive, "losses-one", async () => {
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    const out = collect();
    assert.equal(await losses(opts(out)), 0);
    assert.deepEqual(out.lines, [
      "The chain no longer knows one storage object your credits paid for. That is what the check " +
        "measured; it did not try the download. The file may no longer come back, and NMTS cannot " +
        "restore it.",
      "",
      "0xaaa  first missed 2026-08-30",
      "",
      ...FOOTER,
    ]);
  });
});

test("⛔ a line shown despite an objection, and one frozen at the person's request, say so", async () => {
  await withSandbox(drive, "losses-flags", async () => {
    drive.losses = [
      row({ blob_object_id: "0xaaa", required_notice: true }),
      row({ blob_object_id: "0xbbb", first_seen: "2026-07-01T23:59:59Z", restricted: true }),
    ];
    const out = collect();
    assert.equal(await losses(opts(out)), 0);
    assert.deepEqual(out.lines, [
      "The chain no longer knows 2 storage objects your credits paid for. That is what the check " +
        "measured; it did not try the download. Those files may no longer come back, and NMTS " +
        "cannot restore them.",
      "",
      "0xaaa  first missed 2026-08-30 · shown because the law requires it",
      "0xbbb  first missed 2026-07-01 · kept but not used while you contest it",
      "",
      ...FOOTER,
    ]);
  });
});

test("--json hands over the server's own answer, unchanged", async () => {
  await withSandbox(drive, "losses-json", async () => {
    const rows = [row({ blob_object_id: "0xaaa", required_notice: true })];
    drive.losses = rows;
    const out = collect();
    assert.equal(await losses({ ...opts(out), json: true }), 0);
    assert.deepEqual(JSON.parse(out.lines.join("")), { losses: rows });
  });
});

test("a re-check the chain answers with the object says the line came off", async () => {
  await withSandbox(drive, "losses-recheck-found", async () => {
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    drive.recheckResult = "found";
    const out = collect();
    assert.equal(await losses({ ...opts(out), recheck: "0xaaa" }), 0);
    assert.deepEqual(out.lines, ["The chain knows 0xaaa again. Its line came off."]);

    const json = collect();
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    await losses({ ...opts(json), recheck: "0xaaa", json: true });
    assert.deepEqual(JSON.parse(json.lines.join("")), { blob_object_id: "0xaaa", result: "found" });
  });
});

test("a re-check the chain answers without it says the line stays", async () => {
  await withSandbox(drive, "losses-recheck-missing", async () => {
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    drive.recheckResult = "still_missing";
    const out = collect();
    assert.equal(await losses({ ...opts(out), recheck: "0xaaa" }), 0);
    assert.deepEqual(out.lines, ["The chain still does not know 0xaaa. The line stays."]);
  });
});

test("⛔ a chain that did not answer is neither verdict — nothing changed", async () => {
  await withSandbox(drive, "losses-recheck-unread", async () => {
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    drive.recheckResult = "unread";
    const out = collect();
    assert.equal(await losses({ ...opts(out), recheck: "0xaaa" }), 0);
    assert.deepEqual(out.lines, ["The chain could not be read just now. Nothing changed."]);
  });
});

test("dismissing takes the line off and says what stays behind", async () => {
  await withSandbox(drive, "losses-dismiss", async () => {
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    const out = collect();
    assert.equal(await losses({ ...opts(out), dismiss: "0xaaa" }), 0);
    assert.deepEqual(out.lines, [
      "Took the line for 0xaaa off. The incident stays in a record that names nobody; if the same " +
        "storage is found and lost again, it is shown again.",
    ]);
    assert.deepEqual(drive.losses, [], "the row is still on the server");

    const json = collect();
    drive.losses = [row({ blob_object_id: "0xbbb" })];
    await losses({ ...opts(json), dismiss: "0xbbb", json: true });
    assert.deepEqual(JSON.parse(json.lines.join("")), { blob_object_id: "0xbbb", dismissed: true });
  });
});

test("⛔ a mode that lets an agent decide cannot put a line down", async () => {
  await withSandbox(drive, "losses-dismiss-mode", async () => {
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    setMode("auto", "9.9.9", new Date("2026-09-03T00:00:00Z"));
    try {
      await assert.rejects(
        () => losses({ ...opts(collect()), dismiss: "0xaaa" }),
        (error: unknown) => {
          assert.ok(error instanceof NmtsError);
          assert.equal(error.message, "A loss line comes off after a person has read it.");
          assert.equal(
            error.nextStep,
            "Run `nmts losses --dismiss 0xaaa` yourself, outside mode auto and without " +
              "--skip-permissions.",
          );
          assert.equal(error.exitCode, 5);
          return true;
        },
      );
      assert.equal(drive.losses.length, 1, "the line came off under a mode");
    } finally {
      setMode("off", "9.9.9", new Date("2026-09-03T00:00:00Z"));
    }
  });
});

test("an id this account holds no line for is refused, by both acts, in one text", async () => {
  await withSandbox(drive, "losses-unknown", async () => {
    drive.losses = [row({ blob_object_id: "0xaaa" })];
    for (const act of [{ recheck: "0xzzz" }, { dismiss: "0xzzz" }]) {
      await assert.rejects(
        () => losses({ ...opts(collect()), ...act }),
        (error: unknown) => {
          assert.ok(error instanceof NmtsError);
          assert.equal(error.message, "NMTS holds no loss line for 0xzzz on this account.");
          assert.equal(error.nextStep, "Run `nmts losses` to see the lines that exist.");
          assert.equal(error.exitCode, 4);
          return true;
        },
      );
    }
  });
});
