// `nmts rebuild` — building a file list back out of the rows the server still holds.
//
// ⛔ EVERY ASSERTION READS THE SEALED LIST THE TOOL ACTUALLY SENT, or the requests it actually
//    made. What the command printed is the least trustworthy thing here: a rebuild that leaves
//    files out prints a cheerful count and exits 0 either way.
//
// ⛔ AND THE TWO WORST OUTCOMES ARE TESTED DIRECTLY. A rebuild that lands on top of an existing
//    list replaces somebody's real names with placeholders, permanently. A rebuild built from a
//    listing that stopped early seals a list missing the files it never reached, after which every
//    device agrees those files do not exist while the account goes on paying for them.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { rebuild } from "../src/commands/rebuild.ts";
import { NmtsError } from "../src/errors.ts";
import { createFirstList } from "../src/manifest-create.ts";
import { entry } from "./fake-drive.ts";
import { lines, row, startFakeItems, withAccount } from "./fake-items.ts";
import { identityOf } from "../src/account.ts";

const fake = await startFakeItems();
after(() => fake.close());

const opts = (out: { write: (line: string) => void }, over: Record<string, unknown> = {}) => ({
  server: fake.base,
  network: "testnet",
  write: out.write,
  ...over,
});

const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

/** Which addresses the tool asked for. */
const puts = (): string[] => fake.calls.filter((c) => c.startsWith("PUT "));

// ── it never lands on top of a list ───────────────────────────────────────────────────────────

test("⛔ an account that HAS a file list is refused before anything is read or written", async () => {
  await withAccount(fake, "rebuild-has-list", async (code) => {
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" })]);
    fake.items = [row({ id: "a" })];

    const out = lines();
    const error = await refusal(rebuild(opts(out, { yes: true })));
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /already has a file list/);
    assert.equal(fake.written.length, 0, "it wrote over a list that already existed");
    // ⛔ Not one PUT. The server's own refusal would also have stopped this, but a tool that has to
    //    be saved by the server is a tool that would overwrite a list the day the server forgets to.
    assert.deepEqual(puts(), [], "it tried to write anyway and was only stopped by the server");
  });
});

test("⛔ and the server refuses too, for a list that appears while a rebuild is running", async () => {
  // The client's own check happens before the account is listed; this is the other half — the
  // write itself declares "I believe there is no list", which the server accepts only while that
  // is true. Called directly, because the race it covers cannot be timed from outside.
  await withAccount(fake, "rebuild-race", async (code) => {
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" })]);
    const before = fake.servedCt();
    const identity = await identityOf(code);

    const error = await refusal(
      createFirstList(
        { server: fake.base, apiKey: process.env["NMTS_API_KEY"] ?? "", code, accountId: identity.accountId },
        [entry({ id: "a", name: "recovered-aaaa" })],
      ),
    );
    assert.equal(error.exitCode, 4);
    assert.equal(fake.written.length, 0, "the server accepted a rebuild over an existing list");
    assert.equal(fake.servedCt(), before, "the list on the server changed");
  });
});

// ── it never shortens the account ─────────────────────────────────────────────────────────────

test("⛔ a listing longer than one rebuild will read stops it, rather than sealing a short list", async () => {
  await withAccount(fake, "rebuild-truncated", async () => {
    fake.items = [row({ id: "a" }), row({ id: "b" })];
    fake.pageSize = 1;
    // The listing always offers another page: the shape of an account too large to read in one go.
    fake.neverEnds = true;

    const out = lines();
    const error = await refusal(rebuild(opts(out, { yes: true })));
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /more stored files than one rebuild will read/);
    assert.equal(fake.written.length, 0, "it sealed a list built from a listing that stopped early");
  });
});

test("⛔ a listing that repeats its page marker stops it too", async () => {
  await withAccount(fake, "rebuild-stuck-cursor", async () => {
    fake.items = [row({ id: "a" }), row({ id: "b" })];
    fake.pageSize = 1;
    fake.repeatCursor = true;

    const out = lines();
    const error = await refusal(rebuild(opts(out, { yes: true })));
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /repeated a page marker/);
    assert.equal(fake.written.length, 0);
  });
});

// ── what it recovers ──────────────────────────────────────────────────────────────────────────

test("the account comes back with its keys, hashes, dates, sizes and its trash — over two pages", async () => {
  await withAccount(fake, "rebuild-writes", async (code) => {
    fake.items = [
      row({ id: "aaaaaaaa-1111-2222-3333-444444444444", size: 4096 }),
      row({ id: "bbbbbbbb-1111-2222-3333-444444444444" }),
    ];
    fake.trashed = [
      row({ id: "cccccccc-1111-2222-3333-444444444444", deleted_at: "2026-08-20T09:00:00Z" }),
    ];
    // One row a page, so a reader that stops at the first page cannot pass this.
    fake.pageSize = 1;

    const out = lines();
    assert.equal(await rebuild(opts(out, { yes: true })), 0, out.out.join("\n"));

    const written = await fake.lastWritten(code);
    assert.equal(written.length, 3, "a file the server still holds was left out of the list");

    const live = written.find((e) => e.id === "aaaaaaaa-1111-2222-3333-444444444444");
    assert.ok(live, "the first live file is missing");
    assert.equal(live.dekWrapped, "wrapped-key-for-aaaaaaaa-1111-2222-3333-444444444444");
    assert.equal(live.contentHashCt, "sealed-hash-for-aaaaaaaa-1111-2222-3333-444444444444");
    assert.equal(live.size, 4096);
    assert.equal(live.createdAt, Date.parse("2026-08-01T10:00:00Z"));
    assert.equal(live.updatedAt, Date.parse("2026-08-02T11:00:00Z"));
    assert.equal(live.parentId, null, "the server has no folder to put it in");
    assert.equal(live.kind, 1);
    assert.equal(live.deletedAt, undefined, "a live file came back marked as trash");
    assert.equal(live.name, "recovered-aaaaaaaa");

    const trashed = written.find((e) => e.id === "cccccccc-1111-2222-3333-444444444444");
    assert.ok(trashed, "⛔ the trash was dropped: those files are still stored and still restorable");
    assert.equal(trashed.deletedAt, Date.parse("2026-08-20T09:00:00Z"), "it lost when it was thrown away");
  });
});

test("two files whose ids begin alike do not end up sharing one name", async () => {
  // A placeholder is the first characters of an id, so two ids can produce one name — and a drive
  // addressed by path answers a name that matches twice with a refusal, not with a file.
  await withAccount(fake, "rebuild-name-clash", async (code) => {
    fake.items = [
      row({ id: "aaaaaaaa-1111-0000-0000-000000000001" }),
      row({ id: "aaaaaaaa-1111-0000-0000-000000000002" }),
    ];

    const out = lines();
    assert.equal(await rebuild(opts(out, { yes: true })), 0);
    const names = (await fake.lastWritten(code)).map((e) => e.name);
    assert.equal(new Set(names).size, 2, `two entries share one name: ${names.join(" · ")}`);
  });
});

// ── it is offered, not imposed ────────────────────────────────────────────────────────────────

test("⛔ nothing is written without --yes, and the run says what would be lost", async () => {
  await withAccount(fake, "rebuild-asks", async () => {
    fake.items = [row({ id: "aaaaaaaa-1111-2222-3333-444444444444" })];
    fake.trashed = [row({ id: "cccccccc-1111-2222-3333-444444444444", deleted_at: "2026-08-20T09:00:00Z" })];

    const out = lines();
    assert.equal(await rebuild(opts(out)), 5, "it rebuilt an account nobody agreed to rebuild");
    assert.equal(fake.written.length, 0);
    assert.deepEqual(puts(), []);
    const text = out.out.join("\n");
    assert.match(text, /names/, "it did not say that names are not recovered");
    assert.match(text, /flat/, "it did not say the rebuilt drive is flat");
    assert.match(text, /key/, "it did not say what a rebuild does recover");
    assert.match(text, /rebuild --yes/, "it did not say what agreeing looks like");
  });
});

test("an account the server holds nothing for is not rebuilt into an empty list", async () => {
  await withAccount(fake, "rebuild-nothing", async () => {
    const out = lines();
    assert.equal(await rebuild(opts(out, { yes: true })), 0);
    assert.equal(fake.written.length, 0, "it wrote an empty file list for an account with no files");
    assert.match(out.out.join("\n"), /nothing to rebuild/i);
  });
});

test("⛔ a list this machine has seen, and the server now denies, is not treated as a missing one", async () => {
  await withAccount(fake, "rebuild-vanished", async (code) => {
    // A read records what this machine saw. Then the list is gone from the server — which is also
    // exactly what a server emptying somebody's account would look like.
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" })]);
    const { ls } = await import("../src/commands/ls.ts");
    await ls(opts(lines()));
    fake.stopServing();
    fake.items = [row({ id: "aaaaaaaa-1111-2222-3333-444444444444" })];

    const out = lines();
    const error = await refusal(rebuild(opts(out, { yes: true })));
    assert.equal(error.exitCode, 4);
    assert.match(String(error.nextStep), /--force/, "it did not say how somebody who knows better goes on");
    assert.equal(fake.written.length, 0);

    const forced = lines();
    assert.equal(await rebuild(opts(forced, { yes: true, force: true })), 0, forced.out.join("\n"));
    assert.equal(fake.written.length, 1, "--force did not go ahead");
  });
});

// ── it says what it could not account for ─────────────────────────────────────────────────────

test("rows the server holds that no listing returned are counted, not passed over", async () => {
  await withAccount(fake, "rebuild-unaccounted", async () => {
    fake.items = [row({ id: "aaaaaaaa-1111-2222-3333-444444444444" })];
    // The trash view ends at the restore window, so a row thrown away before that is in no listing
    // this can read. It is still a row the account has, and staying quiet about it would be a
    // rebuild that quietly loses a file.
    fake.objects = ["aaaaaaaa-1111-2222-3333-444444444444", "dddddddd-1111-2222-3333-444444444444"];

    const out = lines();
    assert.equal(await rebuild(opts(out, { json: true })), 5);
    const answer: unknown = JSON.parse(out.out[0] ?? "");
    assert.equal(typeof answer === "object" && answer !== null ? Reflect.get(answer, "unaccounted") : null, 1);

    const said = lines();
    await rebuild(opts(said));
    assert.match(said.out.join("\n"), /1 row the server holds/, "it did not say a row was left out");
  });
});
