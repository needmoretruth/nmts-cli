// `nmts sweep` — the one thing this tool does that cannot be taken back.
//
// ⛔ EVERY ASSERTION READS THE SEALED LIST THE TOOL ACTUALLY SENT, or the requests it actually
//    made. What the command printed is the least trustworthy thing here: a sweep that drops the
//    wrong entries prints a cheerful count and exits 0 either way.
//
// ⛔ AND THE WORST OUTCOME IS TESTED DIRECTLY, not inferred. A folder dropped while a file under it
//    is kept leaves that file with no trashed ancestor — after which the drive lists it as LIVE and
//    the server refuses its bytes. So one test finishes by running `ls` over the list the sweep
//    wrote and asking what it says about that file.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { ls } from "../src/commands/ls.ts";
import { sweep } from "../src/commands/sweep.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, entry, folder, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 23);
/** Past the thirty days by a clear margin. */
const LONG_AGO = NOW - 40 * DAY;
/** Well inside them: still restorable, and none of this tool's business yet. */
const RECENTLY = NOW - 5 * DAY;

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
  now: NOW,
});

const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

/** One field of something parsed off the wire, without claiming to know its shape. */
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

/** The ids left in the list the tool wrote. */
async function idsAfter(code: string): Promise<string[]> {
  return (await drive.lastWritten(code)).map((e) => e.id).sort();
}

// ── it stops ──────────────────────────────────────────────────────────────────────────────────

test("⛔ nothing is dropped without --yes: the run reports, names what would go, and exits 5", async () => {
  await withSandbox(drive, "sweep-asks", async (code) => {
    await drive.serve(code, [
      entry({ id: "old", name: "old.txt", deletedAt: LONG_AGO }),
      entry({ id: "fresh", name: "fresh.txt", deletedAt: RECENTLY }),
    ]);
    drive.objects = ["fresh"];

    const out = collect();
    assert.equal(await sweep(opts(out)), 5, "an act that cannot be undone went ahead unasked");
    assert.equal(drive.written.length, 0, "it wrote a file list without being told to");
    const text = out.lines.join("\n");
    assert.match(text, /old\.txt/, "it would not say which entries it means to drop");
    assert.ok(!text.includes("fresh.txt"), "it named an entry still inside its thirty days");
    assert.match(text, /cannot be undone/);
    assert.match(text, /sweep --yes/, "it did not say what answering would look like");
  });
});

test("⛔ nothing in this tool ever asks the server to erase a row", async () => {
  // The endpoint that destroys a row for good refuses an API key on purpose: reversible is
  // reachable, permanent is not. A sweep that called it would be doing the server's half from a
  // machine clock nobody has checked.
  await withSandbox(drive, "sweep-never-erases", async (code) => {
    await drive.serve(code, [entry({ id: "old", name: "old.txt", deletedAt: LONG_AGO })]);
    drive.objects = [];

    const out = collect();
    assert.equal(await sweep({ ...opts(out), yes: true }), 0);
    for (const call of drive.calls) {
      assert.ok(!/erase/.test(call), `it called ${call}`);
      assert.ok(!/DELETE \/v1\/items/.test(call), `it called ${call}`);
    }
  });
});

// ── the thirty days ───────────────────────────────────────────────────────────────────────────

test("⛔ the thirty days runs from the folder that was thrown away, not from each file's own mark", async () => {
  // Trashing a folder marks the folder and nothing under it. Reading each entry's own `deletedAt`
  // would sweep the folder and leave every file inside it in the list, still holding its key.
  await withSandbox(drive, "sweep-inherited", async (code) => {
    await drive.serve(code, [
      folder({ id: "F", name: "photos", deletedAt: LONG_AGO }),
      entry({ id: "a", name: "a.jpg", parentId: "F" }),
      entry({ id: "b", name: "b.jpg", parentId: "F" }),
      entry({ id: "live", name: "keep.txt" }),
    ]);
    drive.objects = ["live"];

    const out = collect();
    assert.equal(await sweep({ ...opts(out), yes: true }), 0);
    assert.deepEqual(
      await idsAfter(code),
      ["live"],
      "the files inside the swept folder kept their entries, and with them their keys",
    );
  });
});

test("⛔ an instant in the future is a wrong clock, not an expiry", async () => {
  await withSandbox(drive, "sweep-future", async (code) => {
    await drive.serve(code, [entry({ id: "ahead", name: "ahead.txt", deletedAt: NOW + 40 * DAY })]);
    drive.objects = [];

    const out = collect();
    assert.equal(await sweep({ ...opts(out), yes: true }), 0);
    assert.equal(drive.written.length, 0, "it destroyed a key thirty days early on a mis-set clock");
    assert.match(out.lines.join("\n"), /Nothing in the trash has passed/);
  });
});

// ── the server goes first ─────────────────────────────────────────────────────────────────────

test("⛔ a row the server still holds keeps its entry — and the folder above it stays too", async () => {
  // This is the whole ordering rule. `a`'s row is still on the server, so its key is still there
  // and its entry must stay. `photos` is expired and could go — but dropping it would leave `a`
  // with nothing above it marking it as trash, which reads as a LIVE file whose bytes the server
  // will not serve. `b` and `alone` are already erased on the server side and may go.
  await withSandbox(drive, "sweep-waits", async (code) => {
    await drive.serve(code, [
      folder({ id: "F", name: "photos", deletedAt: LONG_AGO }),
      entry({ id: "a", name: "a.jpg", parentId: "F" }),
      entry({ id: "b", name: "b.jpg", parentId: "F" }),
      entry({ id: "alone", name: "alone.txt", deletedAt: LONG_AGO }),
    ]);
    drive.objects = ["a"];

    const out = collect();
    assert.equal(await sweep({ ...opts(out), yes: true }), 0);
    assert.deepEqual(await idsAfter(code), ["F", "a"], "it dropped an entry whose key the server still has");

    // ⛔ AND THE SURVIVOR IS STILL IN THE TRASH. If the folder had gone, this row would read as a
    //    live file — the one state this tool exists to avoid, and the reason the branch is kept whole.
    const listed = collect();
    assert.equal(await ls({ ...opts(listed), json: true, all: true }), 0);
    const parsed: unknown = JSON.parse(listed.lines.join(""));
    const entries: unknown = field(parsed, "entries");
    assert.ok(Array.isArray(entries));
    const survivor = entries.find((e: unknown) => field(e, "id") === "a");
    assert.equal(field(survivor, "trashed"), true, "the file left behind now reads as live");

    assert.match(out.lines.join("\n"), /server still holds their rows/, "it did not say why one was left");
  });
});

test("⛔ the server's listing is read to the end, so a row on a later page is not called erased", async () => {
  await withSandbox(drive, "sweep-paging", async (code) => {
    await drive.serve(code, [
      entry({ id: "held", name: "held.txt", deletedAt: LONG_AGO }),
      entry({ id: "gone", name: "gone.txt", deletedAt: LONG_AGO }),
    ]);
    // `held` is on the SECOND page. A reader that stopped at the first would call it erased.
    drive.objects = ["someone-else", "held"];
    drive.objectsPageSize = 1;

    const out = collect();
    assert.equal(await sweep({ ...opts(out), yes: true }), 0);
    assert.deepEqual(await idsAfter(code), ["held"], "a row on a later page was treated as already erased");
  });
});

test("⛔ a listing this run could not finish stops the sweep rather than shortening it", async () => {
  // "Absent from the listing" is what makes an entry droppable, so a listing that ran out of
  // patience must not be read as an account with almost nothing in it.
  await withSandbox(drive, "sweep-too-big", async (code) => {
    await drive.serve(code, [entry({ id: "old", name: "old.txt", deletedAt: LONG_AGO })]);
    drive.objects = Array.from({ length: 201 }, (_, i) => `row-${i}`);
    drive.objectsPageSize = 1;

    const failure = await refusal(sweep({ ...opts(collect()), yes: true }));
    assert.equal(failure.exitCode, 4);
    assert.equal(drive.written.length, 0, "it swept on a listing it never finished reading");
  });
});

// ── the compare-and-swap ──────────────────────────────────────────────────────────────────────

test("⛔ an entry another device restores mid-write is not purged, even though it was announced", async () => {
  // A run may do less than it said it would and must never do more. Replaying a fixed list of ids
  // onto the version that won would drop a file somebody just took back out of the trash.
  await withSandbox(drive, "sweep-race", async (code) => {
    await drive.serve(code, [
      entry({ id: "p", name: "p.txt", deletedAt: LONG_AGO }),
      entry({ id: "q", name: "q.txt", deletedAt: LONG_AGO }),
    ]);
    drive.objects = [];
    await drive.otherDeviceWrites(code, [
      entry({ id: "p", name: "p.txt", deletedAt: LONG_AGO }),
      // Somebody restored it a moment ago, from a browser.
      entry({ id: "q", name: "q.txt" }),
    ]);

    const out = collect();
    assert.equal(await sweep({ ...opts(out), yes: true }), 0);
    const written = await drive.lastWritten(code);
    assert.deepEqual(written.map((e) => e.id), ["q"], "it purged an entry that had just been restored");
    assert.equal(written[0]?.deletedAt, undefined, "the restored entry came back with its trash mark");
    assert.match(out.lines.join("\n"), /Another device wrote the file list first/);
  });
});

// ── the machine-readable answer ───────────────────────────────────────────────────────────────

test("⛔ exactly one JSON object is printed, whichever path the run takes", async () => {
  // Two objects on one stream is worse than none: a caller reading the first is told `changed:
  // false` about a run that went on to change the list.
  await withSandbox(drive, "sweep-json-yes", async (code) => {
    await drive.serve(code, [entry({ id: "old", name: "old.txt", deletedAt: LONG_AGO })]);
    drive.objects = [];

    const out = collect();
    assert.equal(await sweep({ ...opts(out), json: true, yes: true }), 0);
    assert.equal(out.lines.length, 1, `it printed ${out.lines.length} lines of machine-readable output`);
    const parsed: unknown = JSON.parse(out.lines[0] ?? "");
    assert.equal(field(parsed, "dropped"), 1);
    assert.equal(field(parsed, "changed"), true);
  });

  await withSandbox(drive, "sweep-json-asks", async (code) => {
    await drive.serve(code, [entry({ id: "old", name: "old.txt", deletedAt: LONG_AGO })]);
    drive.objects = [];

    const out = collect();
    assert.equal(await sweep({ ...opts(out), json: true }), 5, "the refusal to act must carry the same code");
    assert.equal(out.lines.length, 1);
    const parsed: unknown = JSON.parse(out.lines[0] ?? "");
    assert.equal(field(parsed, "dropped"), 0);
    assert.equal(field(parsed, "readyToDrop"), 1);
    assert.equal(field(parsed, "changed"), false);
    assert.equal(drive.written.length, 0);
  });
});

test("⛔ an empty trash costs no round trip to the item listing", async () => {
  await withSandbox(drive, "sweep-nothing", async (code) => {
    await drive.serve(code, [entry({ id: "live", name: "keep.txt" })]);
    drive.objects = ["live"];

    const out = collect();
    assert.equal(await sweep(opts(out)), 0);
    assert.ok(!drive.calls.some((c) => c.startsWith("GET /v1/objects")), "it listed the account for nothing");
    assert.match(out.lines.join("\n"), /Nothing in the trash has passed its 30 days/);
  });
});
