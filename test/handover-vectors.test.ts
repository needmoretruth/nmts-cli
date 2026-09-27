// This tool's handover reader held to two files it did not write.
//
// 1. `fixtures/ncf3-handover.json` — the NCF-3 §5.6/§5.7 conformance fixture the format's reference
//    crate writes with fixed nonces: the genuine file opens to the fixture's name, size, sender and
//    pieces, and every refusal in it ends in the outcome it names.
// 2. `fixtures/handover-from-web.json` — a handover file the NMTS web app's own writer made, with the
//    two stored pieces it names (a quilt patch and a padded blob). Opened here with no API key, from a
//    local aggregator, it must write exactly the file the browser sealed.
//
// ⛔ THE CROSS-PROGRAM PROMISE IS THE POINT. A label, a field name or a byte order that differed
//    between the two programs would pass each one's own round trip; only a file crossing between
//    them fails.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { handover } from "../src/commands/handover.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { loadCrypto } from "../src/crypto.ts";
import { NmtsError } from "../src/errors.ts";
import { openHandoverText, readPublicCodeFileText } from "../src/handover.ts";
import { isRecord } from "../src/guards.ts";
import { shareKeysOf } from "../src/share.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { grantConsents } from "./helpers.ts";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const recordOf = (value: unknown): Record<string, unknown> => {
  assert.ok(isRecord(value), "an object was expected");
  return value;
};
const str = (doc: Record<string, unknown>, key: string): string => {
  const value = doc[key];
  assert.equal(typeof value, "string", `${key} is a string`);
  return String(value);
};

/** Which refusal sentence each outcome of NCF-3 §5.6 is, in this tool's words. */
const SAYS: Record<string, RegExp> = {
  format: /not a handover file/,
  "unknown-version": /newer version/,
  network: /other network/,
  "not-for-me": /does not open with your NMTS key/,
  damaged: /damaged/,
};

test("the conformance fixture: the genuine file opens, and every refusal ends in its outcome", async () => {
  const doc = recordOf(read("ncf3-handover.json"));
  const accounts = recordOf(doc["accounts"]);
  const crypt = await loadCrypto();
  const keysOf = (who: string) => shareKeysOf(crypt, str(accounts, who));
  const network = str(doc, "network");
  if (network !== "testnet") assert.fail("the fixture is made on testnet");
  const opened = recordOf(doc["opened"]);

  const recipient = keysOf("recipient");
  const got = openHandoverText(crypt, recipient, str(doc, "file_text"), network);
  assert.equal(got.name, str(opened, "name"));
  assert.equal(got.size, opened["size"]);
  assert.equal(got.sender, str(opened, "sender_code"));
  assert.deepEqual(got.parts, opened["parts"]);
  assert.equal(got.expiryEpoch, opened["earliest_exp"]);
  got.dek.fill(0);
  got.digest.fill(0);
  recipient.wipe();

  const cases = doc["refusals"];
  assert.ok(Array.isArray(cases) && cases.length >= 12, "the refusals are there");
  for (const c of cases) {
    const r = recordOf(c);
    const reader = str(r, "reader_network");
    if (reader !== "mainnet" && reader !== "testnet") assert.fail(`a network: ${reader}`);
    const keys = keysOf(str(r, "account"));
    const says = SAYS[str(r, "outcome")] ?? assert.fail(`no sentence for ${str(r, "outcome")}`);
    assert.throws(
      () => openHandoverText(crypt, keys, str(r, "file_text"), reader),
      (e: unknown) => e instanceof NmtsError && says.test(e.message),
      str(r, "label"),
    );
    keys.wipe();
  }

  const pcf = recordOf(doc["public_code_file"]);
  assert.equal(readPublicCodeFileText(crypt, str(pcf, "text")).display, str(pcf, "code"));
  const lying = doc["public_code_file_refusals"];
  assert.ok(Array.isArray(lying) && lying.length > 0);
  for (const c of lying) {
    assert.throws(
      () => readPublicCodeFileText(crypt, str(recordOf(c), "text")),
      (e: unknown) => e instanceof NmtsError && /does not belong/.test(e.message),
    );
  }
});

test("a handover file the web app made opens here, with no API key, to the bytes it sealed", async () => {
  const web = recordOf(read("handover-from-web.json"));
  const pieces = recordOf(web["pieces"]);
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    calls.push(`${req.method} ${url}`);
    const id = decodeURIComponent(url.match(/\/v1\/blobs\/(?:by-quilt-patch-id\/)?(.+)$/)?.[1] ?? "");
    const b64 = pieces[id];
    if (typeof b64 !== "string") {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such blob" } }));
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.from(b64, "base64"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => server.close());
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
  const base = `http://127.0.0.1:${address.port}`;

  const dir = testConfigDir("handover-from-web");
  const before = { ...process.env };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    process.env["NMTS_CONFIG_DIR"] = dir;
    grantConsents(dir, "plain-env");
    process.env[AGGREGATOR_ENV_VAR] = base;
    process.env[CODE_ENV_VAR] = str(web, "recipient");
    delete process.env[API_KEY_ENV_VAR];
    const file = join(dir, "from-web.nmtshandover");
    writeFileSync(file, str(web, "file_text"));
    const out = join(dir, "got.txt");
    const lines: string[] = [];
    assert.equal(await handover("open", file, { server: base, network: str(web, "network"), out, write: (l) => lines.push(l) }), 0);
    assert.equal(readFileSync(out, "utf8"), str(web, "body_utf8"));
    assert.ok(lines.join("\n").includes(str(web, "sender_code")), "the sender is named");
    assert.ok(calls.some((c) => c.includes("/v1/blobs/by-quilt-patch-id/web-patch-0")), "the quilt piece was fetched by its patch id");
    assert.deepEqual(calls.filter((c) => !c.startsWith("GET /v1/blobs/")), [], "the open reached something other than an aggregator");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR, AGGREGATOR_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
});
