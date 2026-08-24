// `nmts expiring` — the command that tells somebody storage is about to run out.
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. This surface fails by going QUIET: an unread clock, a row it
//    could not name, a period nobody ever recorded — each of those has a shape that looks exactly
//    like "your account is fine". So most of what is asserted below is what the command says when
//    it does not know something, plus the one number it sends the server.
//
// ⛔ THE CLOCK IS SUPPLIED, NOT REACHED FOR. A test that read a real storage network could not run
//    offline, could not put the chain mid-epoch-change, and would report a different number every
//    fortnight. The command takes the reader as a seam for exactly that reason.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { expiring } from "../src/commands/expiring.ts";
import { NmtsError } from "../src/errors.ts";
import { epochClock, type EpochClock } from "../src/expiry.ts";
import { collect, entry, folder, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 23);

/** A clock, refusing to be built out of numbers the product itself would reject. */
function clockOf(current: number, epochDays: number, startedMs: number | null): EpochClock {
  const clock = epochClock(current, epochDays * DAY, startedMs);
  assert.ok(clock !== null, "the fixture built a clock the product would have refused");
  return clock;
}

/** Mainnet's shape: a fortnight to the epoch, and no anchor — which is the usual state. */
const MAINNET = clockOf(1200, 14, null);

const opts = (out: { write: (line: string) => void }, clock: EpochClock | null) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
  now: NOW,
  readClock: async (): Promise<EpochClock | null> => clock,
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

/** The rows of the machine-readable answer, in the order it printed them. */
function filesIn(lines: readonly string[]): readonly unknown[] {
  const parsed: unknown = JSON.parse(lines.join(""));
  const files: unknown = field(parsed, "files");
  assert.ok(Array.isArray(files), "the machine-readable answer had no list of files in it");
  return files;
}

/** The one `before_epoch` the tool asked about, read off the request it actually made. */
function cutoffAsked(): number {
  const call = drive.calls.find((c) => c.startsWith("GET /v1/items/expiring"));
  assert.ok(call !== undefined, "it never asked the server which files run out");
  const asked = new URL(call.slice("GET ".length), "http://x").searchParams.get("before_epoch");
  assert.ok(asked !== null, "it asked without naming an epoch, which the server refuses outright");
  return Number(asked);
}

// ── the cutoff ────────────────────────────────────────────────────────────────────────────────

test("⛔ the warning window is measured in days AND epochs, so neither network loses it", async () => {
  // On a fourteen-day epoch, fourteen days is ONE epoch: counted in days alone the whole warning
  // is one epoch wide and somebody who runs this monthly never sees it. On a one-day epoch, three
  // epochs is three days: counted in epochs alone the warning shrinks from a fortnight to three
  // days. Taking whichever is wider never narrows either network's warning.
  await withSandbox(drive, "expiring-cutoff-mainnet", async (code) => {
    await drive.serve(code, []);
    assert.equal(await expiring(opts(collect(), MAINNET)), 0);
    assert.equal(cutoffAsked(), 1203, "a fourteen-day epoch should reach three epochs ahead");
  });

  await withSandbox(drive, "expiring-cutoff-testnet", async (code) => {
    await drive.serve(code, []);
    assert.equal(await expiring(opts(collect(), clockOf(50, 1, null))), 0);
    assert.equal(cutoffAsked(), 64, "a one-day epoch should reach fourteen epochs ahead");
  });
});

// ── naming what the server cannot name ────────────────────────────────────────────────────────

test("⛔ ids become paths from the sealed list, and a row with no entry is printed anyway", async () => {
  await withSandbox(drive, "expiring-names", async (code) => {
    await drive.serve(code, [
      folder({ id: "F", name: "photos" }),
      entry({ id: "a", name: "a.jpg", parentId: "F", size: 4_000_000 }),
    ]);
    drive.expiring = [
      { item_id: "a", expiry_epoch: 1201 },
      // Committed and paid for, and the list write never landed. The server knows it; the list does not.
      { item_id: "orphan-row", expiry_epoch: 1202 },
    ];

    const out = collect();
    assert.equal(await expiring(opts(out, MAINNET)), 0);
    const text = out.lines.join("\n");
    assert.match(text, /photos\/a\.jpg/, "it printed an id where the sealed list had a name");
    assert.match(text, /not in the file list.*orphan-row/, "a file the list cannot name was dropped from the warning");
    assert.match(text, /4\.0 MB/, "it did not say how much is about to be lost");
  });
});

// ── the two ways of not knowing ───────────────────────────────────────────────────────────────

test("⛔ an unreadable clock refuses; it does not report an account with nothing expiring", async () => {
  await withSandbox(drive, "expiring-no-clock", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.jpg" })]);
    drive.expiring = [{ item_id: "a", expiry_epoch: 1201 }];

    const failure = await refusal(expiring(opts(collect(), null)));
    assert.equal(failure.exitCode, 1);
    assert.match(failure.message, /epoch clock could not be read/);
    assert.ok(
      !drive.calls.some((c) => c.startsWith("GET /v1/items/expiring")),
      "it asked the server about a window it had no way to compute",
    );
  });
});

test("⛔ a period nobody recorded is not the most urgent thing in the account", async () => {
  // `expiry_epoch` is 0 when whatever uploaded the file could not read the epoch clock. Zero sorts
  // below every real deadline, so a listing ranked on the number alone puts "we do not know" at the
  // top of a list headed "about to be lost", and calls it already over into the bargain.
  await withSandbox(drive, "expiring-unrecorded", async (code) => {
    await drive.serve(code, [
      entry({ id: "unknown", name: "old.bin" }),
      entry({ id: "soon", name: "soon.jpg" }),
    ]);
    drive.expiring = [
      { item_id: "unknown", expiry_epoch: 0 },
      { item_id: "soon", expiry_epoch: 1201 },
    ];

    const out = collect();
    assert.equal(await expiring({ ...opts(out, MAINNET), json: true }), 0);
    assert.deepEqual(
      filesIn(out.lines).map((f) => [field(f, "id"), field(f, "stage")]),
      [
        ["soon", "urgent"],
        ["unknown", "unrecorded"],
      ],
      "an unrecorded period was ranked as a deadline",
    );

    const prose = collect();
    assert.equal(await expiring(opts(prose, MAINNET)), 0);
    assert.match(
      prose.lines.join("\n"),
      /no storage period[\s\S]*recorded/,
      "it did not say out loud what it does not know",
    );
  });
});

// ── the day count ─────────────────────────────────────────────────────────────────────────────

test("⛔ without an anchor the day count is a FLOOR, and says so", async () => {
  // The network usually will not say how far into the current epoch it is. Counting (end - current)
  // whole epochs assumes it has not started, which on a fourteen-day epoch overstates the runway by
  // up to a fortnight — a file with 14 days left told it has 28. Warning early is allowed; warning
  // late is the failure this whole surface exists to prevent.
  await withSandbox(drive, "expiring-floor", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.jpg" })]);
    drive.expiring = [{ item_id: "a", expiry_epoch: 1202 }];

    const out = collect();
    assert.equal(await expiring({ ...opts(out, MAINNET), json: true }), 0);
    const only = filesIn(out.lines)[0];
    assert.equal(field(only, "daysLeft"), 14, "it counted the epoch we are already somewhere inside");
    assert.equal(field(only, "daysLeftExact"), false);

    const prose = collect();
    await expiring(opts(prose, MAINNET));
    assert.match(prose.lines.join("\n"), /14 days or more left/, "a floor was printed as a measurement");
  });
});

test("⛔ with an anchor the same file gets a measurement, not a floor", async () => {
  await withSandbox(drive, "expiring-exact", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.jpg" })]);
    drive.expiring = [{ item_id: "a", expiry_epoch: 1202 }];
    // The network said epoch 1200 began four days ago, so 1202 is 24 days out — neither 14 nor 28.
    const anchored = clockOf(1200, 14, NOW - 4 * DAY);

    const out = collect();
    assert.equal(await expiring({ ...opts(out, anchored), json: true }), 0);
    const only = filesIn(out.lines)[0];
    assert.equal(field(only, "daysLeft"), 24);
    assert.equal(field(only, "daysLeftExact"), true);

    const prose = collect();
    await expiring(opts(prose, anchored));
    assert.match(prose.lines.join("\n"), /24 days left/);
    assert.doesNotMatch(prose.lines.join("\n"), /or more/, "a measurement was hedged as if it were a floor");
  });
});

// ── the stages ────────────────────────────────────────────────────────────────────────────────

test("⛔ a term that has already ended is not called a warning", async () => {
  // The EPOCH comparison decides this, never the day count: a lease ending AT the current epoch has
  // no epoch left to be read in, while an unanchored clock still puts days beside it.
  await withSandbox(drive, "expiring-lapsed", async (code) => {
    await drive.serve(code, [
      entry({ id: "gone", name: "gone.jpg" }),
      entry({ id: "urgent", name: "urgent.jpg" }),
      entry({ id: "later", name: "later.jpg" }),
    ]);
    drive.expiring = [
      { item_id: "gone", expiry_epoch: 1200 },
      { item_id: "urgent", expiry_epoch: 1201 },
      { item_id: "later", expiry_epoch: 1202 },
    ];

    const out = collect();
    assert.equal(await expiring({ ...opts(out, MAINNET), json: true }), 0);
    assert.deepEqual(
      filesIn(out.lines).map((f) => field(f, "stage")),
      ["lapsed", "urgent", "soon"],
      "the stages did not follow the epoch comparison",
    );

    const prose = collect();
    await expiring(opts(prose, MAINNET));
    const text = prose.lines.join("\n");
    assert.match(text, /gone\.jpg.*TERM ENDED/, "a file whose term ran out was drawn as merely soon");
    assert.match(text, /urgent\.jpg.*EXTEND NOW/);
  });
});

test("⛔ the server saying it stopped early is passed on, not swallowed", async () => {
  await withSandbox(drive, "expiring-truncated", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.jpg" })]);
    drive.expiring = [{ item_id: "a", expiry_epoch: 1201 }];
    drive.truncated = true;

    const out = collect();
    assert.equal(await expiring(opts(out, MAINNET)), 0);
    assert.match(out.lines.join("\n"), /stopped at its limit/, "a cut-off list was reported as the whole list");
  });
});

test("⛔ an answer this version cannot read is a refusal, not a shorter list", async () => {
  await withSandbox(drive, "expiring-unreadable", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.jpg" })]);
    // A wire change: the epoch arrives as a string. Skipping the row would quietly shorten the one
    // list in this product whose whole job is to be long enough.
    drive.expiringRaw = [{ item_id: "a", expiry_epoch: "1201" }];

    const failure = await refusal(expiring(opts(collect(), MAINNET)));
    assert.match(failure.message, /cannot read/);
  });
});
