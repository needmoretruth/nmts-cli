// `nmts shares --sent <path>` — the other direction of the share list, against a real local server.
//
// ⛔ THE PATH IS RESOLVED TO AN ITEM ID BEFORE THE SERVER IS ASKED, and the fake filters on that
//    id exactly as the route does. A test that let the harness answer whatever it held could not
//    fail for a tool that asked about the wrong file, and asking about the wrong file is the one
//    way this command can mislead somebody deciding whether to withdraw a share.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { NmtsError } from "../src/errors.ts";
import { sharesSent } from "../src/commands/share.ts";
import { collect, entry, folder, startFakeDrive, withSandbox, type SentShareRow } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
});

function row(over: Partial<SentShareRow> & Pick<SentShareRow, "id" | "item_id">): SentShareRow {
  return { recipient_address: "AAAAAAAAAAAAAAAAAAAAAA", created_at: "2026-08-30T04:05:06Z", ...over };
}

test("a file nobody has been given says so, in words that are not an error", async () => {
  await withSandbox(drive, "sent-none", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const out = collect();
    assert.equal(await sharesSent("a.txt", opts(out)), 0);
    assert.deepEqual(out.lines, ["a.txt has not been shared with anyone."]);
  });
});

test("each recipient is one line: the address, the day it started, and the id unshare takes", async () => {
  await withSandbox(drive, "sent-rows", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    drive.sentShares = [
      row({ id: "sh-1", item_id: "a", recipient_address: "aaaa" }),
      row({ id: "sh-2", item_id: "a", recipient_address: "bbbb", created_at: "2026-07-01T23:59:59Z" }),
    ];
    const out = collect();
    assert.equal(await sharesSent("a.txt", opts(out)), 0);
    assert.deepEqual(out.lines, [
      "a.txt is shared with:",
      "aaaa  since 2026-08-30  share sh-1",
      "bbbb  since 2026-07-01  share sh-2",
    ]);
  });
});

test("⛔ it asks about the file it was given, not about whatever the account has sent", async () => {
  await withSandbox(drive, "sent-other-file", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" }), entry({ id: "b", name: "b.txt" })]);
    drive.sentShares = [row({ id: "sh-1", item_id: "b" })];
    const out = collect();
    assert.equal(await sharesSent("a.txt", opts(out)), 0);
    assert.deepEqual(out.lines, ["a.txt has not been shared with anyone."]);
    assert.ok(
      drive.calls.includes("GET /v1/shares/sent?item_id=a"),
      `it asked: ${drive.calls.join(" · ")}`,
    );
  });
});

test("--json carries the path, the item id, and the server's own rows", async () => {
  await withSandbox(drive, "sent-json", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const rows = [row({ id: "sh-1", item_id: "a" })];
    drive.sentShares = rows;
    const out = collect();
    assert.equal(await sharesSent("a.txt", { ...opts(out), json: true }), 0);
    assert.deepEqual(JSON.parse(out.lines.join("")), { path: "a.txt", item_id: "a", shares: rows });
  });
});

test("a folder is refused: a share is of one file", async () => {
  await withSandbox(drive, "sent-folder", async (code) => {
    await drive.serve(code, [folder({ id: "f", name: "photos" })]);
    const failure = await sharesSent("photos", opts(collect())).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.message, `No file at "photos".`);
    assert.equal(failure.exitCode, 4);
  });
});
