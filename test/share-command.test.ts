// The share commands against a server that answers the real addresses.
//
// ⛔ THE ONE PROPERTY WORTH A WHOLE HARNESS: a received file is trimmed to the length the SENDER
//    sealed, not to the length the server reports. The server's number is bytes-on-the-network,
//    and it is larger — by the sealing overhead, and again by however much the sender rounded the
//    stored size up to hide the true one. Taking it would write padding into the end of the file,
//    and the hash check would then refuse a download that was otherwise perfect. So the stored
//    stream below is deliberately sealed from MORE bytes than the file has.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NETWORK_ENV_VAR } from "../src/network.ts";
import { SERVER_ENV_VAR } from "../src/server.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { AAD, loadCrypto } from "../src/crypto.ts";
import { sealPart } from "../src/seal.ts";
import { sealShare, shareKeysOf } from "../src/share.ts";
import { KEY } from "./fake-drive.ts";
import { generateCode, grantConsents } from "./helpers.ts";

const REAL = new TextEncoder().encode("the actual contents of the shared file");
const PADDED_TO = 128; // sealed from more than the file holds — what padding looks like on the wire
const SHARE_ID = "sh-1";
const ITEM_ID = "01hq2x9s7k4m8n0p2q4r6t8v0w";

async function* one(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/** Serves the api routes AND the aggregator blob read, so one origin is enough for a test. */
function serve(state: { received: unknown; parts: unknown; sealed: Uint8Array; calls: string[] }) {
  return new Promise<{ base: string; close(): void }>((done) => {
    const server: Server = createServer((req, res) => {
      const path = req.url ?? "";
      state.calls.push(`${req.method} ${path}`);
      const send = (body: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (path.startsWith("/v1/shares/received")) return send(state.received);
      if (path.includes("/parts")) return send(state.parts);
      if (path.startsWith("/v1/blobs/")) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(Buffer.from(state.sealed));
      }
      if (req.method === "DELETE") {
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(404);
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      done({ base: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function sandbox(name: string, body: (recipientCode: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { ...process.env };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env", "share");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  process.env[API_KEY_ENV_VAR] = KEY;
  process.env[NETWORK_ENV_VAR] = "testnet";
  try {
    await body(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of [
      "NMTS_CONFIG_DIR",
      CODE_ENV_VAR,
      API_KEY_ENV_VAR,
      NETWORK_ENV_VAR,
      SERVER_ENV_VAR,
      AGGREGATOR_ENV_VAR,
    ]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
}

/** A share of one real file, as sender and server would produce it. */
async function shareFrom(recipientCode: string) {
  const crypt = await loadCrypto();
  const sender = shareKeysOf(crypt, await generateCode());
  const recipient = shareKeysOf(crypt, recipientCode);
  const dek = crypt.generate_dek();
  const digest = new Uint8Array(createHash("sha256").update(REAL).digest());

  // ⛔ Sealed from a PADDED buffer: the stored stream declares 128 bytes and the file has fewer.
  const padded = new Uint8Array(PADDED_TO);
  padded.set(REAL, 0);
  const sealed = await sealPart(crypt, dek, one(padded), { index: 0, total: 1, plaintextLen: PADDED_TO });

  const payload = sealShare(crypt, {
    keys: sender,
    recipientIdentity: recipient.identity,
    recipientAddress: recipient.address,
    dek,
    itemId: ITEM_ID,
    name: "shared.txt",
    size: REAL.length,
    digest,
  });
  const row = {
    id: SHARE_ID,
    item_id: ITEM_ID,
    // ⚠ What the server reports: the SEALED total, bigger than the file twice over.
    size: sealed.length,
    sender_public_key: Buffer.from(sender.identity).toString("base64url"),
    created_at: "2026-08-24T00:00:00Z",
    ...payload,
  };
  const parts = {
    share_id: SHARE_ID,
    item_id: ITEM_ID,
    size: sealed.length,
    parts: [{ part_index: 0, storage_kind: 0, network: 0, blob_id: "blob-1", sealed_len: sealed.length }],
  };
  sender.wipe();
  recipient.wipe();
  dek.fill(0);
  return { row, parts, sealed, senderDisplay: sender.display };
}

test("⛔ a received file is trimmed to the length the SENDER sealed, not the server's", async () => {
  await sandbox("share-receive", async (code) => {
    const made = await shareFrom(code);
    const state = { received: { shares: [made.row], total: 1 }, parts: made.parts, sealed: made.sealed, calls: [] as string[] };
    const server = await serve(state);
    process.env[SERVER_ENV_VAR] = server.base;
    process.env[AGGREGATOR_ENV_VAR] = server.base;
    try {
      const { receive } = await import("../src/commands/receive.ts");
      const lines: string[] = [];
      const out = join(testConfigDir("share-receive"), "got.txt");
      assert.equal(await receive(SHARE_ID, { out, write: (l) => lines.push(l) }), 0);
      const written = new Uint8Array(readFileSync(out));
      assert.deepEqual(
        Array.from(written),
        Array.from(REAL),
        "the padding the sender added to hide the size was written into the file",
      );
      assert.ok(lines.join("\n").includes(made.senderDisplay), "the sender is named");
    } finally {
      server.close();
    }
  });
});

test("a share whose sender identity is missing is listed, with a reason and no sender", async () => {
  await sandbox("share-list", async (code) => {
    const made = await shareFrom(code);
    const { sender_public_key: _dropped, ...anonymous } = made.row;
    const state = {
      received: { shares: [made.row, { ...anonymous, id: "sh-2" }], total: 2 },
      parts: made.parts,
      sealed: made.sealed,
      calls: [] as string[],
    };
    const server = await serve(state);
    process.env[SERVER_ENV_VAR] = server.base;
    try {
      const { shares } = await import("../src/commands/share.ts");
      const lines: string[] = [];
      assert.equal(await shares({ write: (l) => lines.push(l) }), 0);
      const text = lines.join("\n");
      assert.match(text, /shared\.txt/, "the one that opened shows its name");
      assert.match(text, /sh-2 {2}\(will not open/, "the one that did not is still listed");
      assert.equal(
        text.split(made.senderDisplay).length - 1,
        1,
        "the sender is named exactly once — never for a row that did not open",
      );
    } finally {
      server.close();
    }
  });
});

test("withdrawing a share asks the server to delete it", async () => {
  await sandbox("share-unshare", async (code) => {
    const made = await shareFrom(code);
    const state = { received: { shares: [], total: 0 }, parts: made.parts, sealed: made.sealed, calls: [] as string[] };
    const server = await serve(state);
    process.env[SERVER_ENV_VAR] = server.base;
    try {
      const { unshare } = await import("../src/commands/share.ts");
      const lines: string[] = [];
      assert.equal(await unshare(SHARE_ID, { write: (l) => lines.push(l) }), 0);
      assert.ok(state.calls.includes(`DELETE /v1/shares/${SHARE_ID}`), state.calls.join(" · "));
      // ⛔ The wording may never suggest a copy can be recalled. Read the way a person reads it —
      //    across the line wrapping — because that is where the sentence actually is.
      const said = lines.join(" ").replace(/\s+/g, " ");
      assert.match(said, /any copy they already took is still theirs/);
      assert.doesNotMatch(said, /recall|undo the download|get it back/i);
    } finally {
      server.close();
    }
  });
});
