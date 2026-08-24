// A server the recovery commands can really talk to: the sealed file list, the storage dump, and
// the record of a list having been written.
//
// ⛔ IT ENFORCES THE ACCOUNT PROOF, exactly as the real one does. The three routes here are
//    `NeedsAccountProof`: an API key alone is refused with ACCOUNT_PROOF_REQUIRED, and a proof that
//    does not match the account is refused the same way. A fake that answered a bare key could not
//    fail for the defect that matters most — a client that never sends the header at all.
//
// ⛔ THE EXPECTED PROOF IS DERIVED HERE, FROM THE ENGINE, at the offsets the format document names
//    — not by calling the code under test. A fixture that asked the tool what the answer was would
//    prove the tool agrees with itself.
//
// ⛔ AND IT PAGES THE DUMP, because "the whole account was read" is the property the whole artefact
//    rests on. A test that cannot put a file on page two cannot fail for a reader that stops at
//    the first one.
//
// ⚠ NOTHING HERE ANSWERS A ROUTE THE SERVER DOES NOT HAVE. The addresses below are the ones the
//   real API registers; a fake that answered anything would only prove the tool agrees with itself.

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { engineDir } from "../src/crypto.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { sealedLenFor } from "../src/seal.ts";
import { generateCode, grantConsents, sealFileList } from "./helpers.ts";
import { KEY } from "./fake-drive.ts";

/** The header the proof travels in. Spelled as the server spells it. */
export const PROOF_HEADER = "x-nmts-account-proof";

let engine: Record<string, unknown> | null = null;

async function loadEngine(): Promise<Record<string, unknown>> {
  if (engine !== null) return engine;
  const dir = engineDir();
  const glue: unknown = await import(pathToFileURL(join(dir, "nmts_crypto_wasm.js")).href);
  if (typeof glue !== "object" || glue === null) throw new Error("engine did not load");
  const init: unknown = Reflect.get(glue, "default");
  if (typeof init !== "function") throw new Error("engine has no initialiser");
  await init({ module_or_path: await readFile(join(dir, "nmts_crypto_wasm_bg.wasm")) });
  engine = glue as Record<string, unknown>;
  return engine;
}

function fn(host: Record<string, unknown>, name: string): (...args: never[]) => unknown {
  const member = host[name];
  if (typeof member !== "function") throw new Error(`engine has no ${name}`);
  return member as (...args: never[]) => unknown;
}

/**
 * The proof a login sends, derived independently of the tool.
 *
 * ⛔ THE OFFSETS ARE WRITTEN OUT — bytes [16,48) of the derivation, which is `authSecret` in
 *    CRYPTO-FORMAT-NCF3.md §1. Reading them from the tool's own table would make this fixture
 *    agree with whatever the tool believes rather than with the format.
 */
export async function authSecretOf(code: string): Promise<string> {
  const glue = await loadEngine();
  const parse = fn(glue, "account_code_parse") as (input: string) => Uint8Array;
  const derive = fn(glue, "kdf_derive") as (bytes: Uint8Array) => Uint8Array;
  const derived = derive(parse(code));
  const secret = Buffer.from(derived.subarray(16, 48)).toString("base64url");
  derived.fill(0);
  return secret;
}

/** Open a sealed recovery list the way the standalone program does. */
export async function openRecoveryList(code: string, sealed: string): Promise<unknown> {
  const glue = await loadEngine();
  const parse = fn(glue, "account_code_parse") as (input: string) => Uint8Array;
  const derive = fn(glue, "kdf_derive") as (bytes: Uint8Array) => Uint8Array;
  const open = fn(glue, "envelope_open") as (k: Uint8Array, aad: Uint8Array, env: Uint8Array) => Uint8Array;
  const derived = derive(parse(code));
  // ⛔ The data key is bytes [48,80) and the separator is the format's, written out for the same
  //    reason the offsets above are.
  const key = derived.slice(48, 80);
  derived.fill(0);
  const body = open(key, new TextEncoder().encode("nmts/v3/recovery-map"), Buffer.from(sealed, "base64url"));
  key.fill(0);
  return JSON.parse(Buffer.from(body).toString("utf8"));
}

/** Seal one value under the account's data key, as the browser would have when a file was stored. */
export async function sealUnderDataKey(code: string, aad: string, plaintext: Uint8Array): Promise<string> {
  const glue = await loadEngine();
  const parse = fn(glue, "account_code_parse") as (input: string) => Uint8Array;
  const derive = fn(glue, "kdf_derive") as (bytes: Uint8Array) => Uint8Array;
  const seal = fn(glue, "envelope_seal") as (k: Uint8Array, aad: Uint8Array, pt: Uint8Array) => Uint8Array;
  const derived = derive(parse(code));
  const key = derived.slice(48, 80);
  derived.fill(0);
  const out = Buffer.from(seal(key, new TextEncoder().encode(aad), plaintext)).toString("base64url");
  key.fill(0);
  return out;
}

/** One stored part, in the server's own spelling. */
export interface SourcePartRow {
  part_index: number;
  storage_kind: number;
  network?: number;
  blob_id: string;
  patch_id?: string;
  sealed_len: number;
  expiry_epoch: number;
  sui_object_id?: string;
}

/** One stored file, in the server's own spelling. */
export interface SourceItemRow {
  id: string;
  size: number;
  dek_wrapped?: string;
  content_hash_ct?: string;
  created_at: string;
  updated_at: string;
  parts: SourcePartRow[];
}

/** A stored part whose stream declares exactly `plaintextLen` bytes. */
export function part(over: Partial<SourcePartRow> & { part_index: number; plaintextLen: number }): SourcePartRow {
  const row: SourcePartRow = {
    part_index: over.part_index,
    storage_kind: over.storage_kind ?? 0,
    blob_id: over.blob_id ?? `blob-${over.part_index}-${over.plaintextLen}`,
    sealed_len: over.sealed_len ?? sealedLenFor(over.plaintextLen),
    expiry_epoch: over.expiry_epoch ?? 100,
  };
  if (over.network !== undefined) row.network = over.network;
  if (over.patch_id !== undefined) row.patch_id = over.patch_id;
  if (over.sui_object_id !== undefined) row.sui_object_id = over.sui_object_id;
  return row;
}

export interface FakeRecovery {
  readonly base: string;
  /** Every stored file the dump hands back, in id order. */
  source: SourceItemRow[];
  /** How many files one page carries. Small numbers force a second page. */
  pageSize: number;
  /** Every request the tool made, in order. */
  calls: string[];
  /** The proof header each request carried, or null where it carried none. */
  proofs: (string | null)[];
  /** Every body `PUT /v1/account/recovery-map` accepted. */
  recorded: unknown[];
  /** The sequence the account has already recorded. A write must beat it. */
  recordedSeq: number;
  /** Put a file list on the server, and set the proof this account's code produces. */
  serve(code: string, entries: ManifestEntry[]): Promise<void>;
  reset(): void;
  close(): void;
}

export async function startFakeRecovery(): Promise<FakeRecovery> {
  let served: { seq: number; ct: string } | null = null;
  let expectedProof: string | null = null;
  const state = {
    source: [] as SourceItemRow[],
    pageSize: 100,
    calls: [] as string[],
    proofs: [] as (string | null)[],
    recorded: [] as unknown[],
    recordedSeq: 0,
  };

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    state.calls.push(`${method} ${url}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const refuseProof = (): void =>
      json(403, {
        error: { code: "ACCOUNT_PROOF_REQUIRED", message: "this route needs proof of the account code" },
      });

    if (method === "GET" && url.startsWith("/v1/manifest")) {
      if (served === null) return json(200, { state: "absent" });
      return json(200, { state: "present", seq: served.seq, ct: served.ct, updated_at: "2026-08-24T00:00:00Z" });
    }

    if (url.startsWith("/v1/account/recovery-")) {
      const header = req.headers[PROOF_HEADER];
      const offered = typeof header === "string" ? header : null;
      state.proofs.push(offered);
      // ⛔ ABSENT AND WRONG GET THE SAME ANSWER, as they do on the real server.
      if (offered === null || expectedProof === null || offered !== expectedProof) return refuseProof();
    }

    if (method === "GET" && url.startsWith("/v1/account/recovery-source")) {
      const after = new URL(url, "http://x").searchParams.get("after");
      const from = after === null ? 0 : state.source.findIndex((r) => r.id === after) + 1;
      const page = state.source.slice(from, from + state.pageSize);
      const more = from + state.pageSize < state.source.length;
      const body: { items: SourceItemRow[]; next_cursor?: string } = { items: page };
      if (more) {
        const last = page.at(-1);
        if (last !== undefined) body.next_cursor = last.id;
      }
      return json(200, body);
    }

    if (method === "PUT" && url.startsWith("/v1/account/recovery-map")) {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        const body: unknown = raw === "" ? {} : JSON.parse(raw);
        const at = (name: string): unknown =>
          typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
        if (at("kind") !== "local" && at("kind") !== "walrus") {
          return json(400, { error: { code: "VALIDATION", message: "kind" } });
        }
        // The real server refuses a blob id beside a locally kept list, and the sequence guard is
        // the reason a second run of the same command is not a silent no-op.
        if (at("kind") === "local" && at("blob_id") !== undefined) {
          return json(400, { error: { code: "VALIDATION", message: "blob_id: not allowed when kind is \"local\"" } });
        }
        const seq = at("seq");
        if (typeof seq !== "number" || seq < 1) {
          return json(400, { error: { code: "VALIDATION", message: "seq" } });
        }
        if (seq <= state.recordedSeq) {
          return json(409, { error: { code: "VERSION_CONFLICT", message: "a newer list is already recorded" } });
        }
        state.recordedSeq = seq;
        state.recorded.push(body);
        res.writeHead(204);
        res.end();
      });
      return;
    }

    return json(404, { error: { code: "NOT_FOUND", message: "no such route" } });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");

  return {
    base: `http://127.0.0.1:${address.port}`,
    get source() {
      return state.source;
    },
    set source(v: SourceItemRow[]) {
      state.source = v;
    },
    get pageSize() {
      return state.pageSize;
    },
    set pageSize(v: number) {
      state.pageSize = v;
    },
    get calls() {
      return state.calls;
    },
    get proofs() {
      return state.proofs;
    },
    get recorded() {
      return state.recorded;
    },
    get recordedSeq() {
      return state.recordedSeq;
    },
    set recordedSeq(v: number) {
      state.recordedSeq = v;
    },
    async serve(code: string, entries: ManifestEntry[]): Promise<void> {
      served = { seq: 1, ct: await sealFileList(code, await encodeManifest(entries, 1)) };
      expectedProof = await authSecretOf(code);
    },
    reset(): void {
      served = null;
      expectedProof = null;
      state.source = [];
      state.pageSize = 100;
      state.calls = [];
      state.proofs = [];
      state.recorded = [];
      state.recordedSeq = 0;
    },
    close(): void {
      server.close();
    },
  };
}

/** A config directory of this test's own, with the agreement reading the code from the environment needs. */
export async function withAccount(
  fake: FakeRecovery,
  name: string,
  body: (code: string) => Promise<void>,
): Promise<void> {
  const dir = testConfigDir(name);
  const before = {
    dir: process.env["NMTS_CONFIG_DIR"],
    code: process.env[CODE_ENV_VAR],
    key: process.env[API_KEY_ENV_VAR],
  };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  process.env[API_KEY_ENV_VAR] = KEY;
  fake.reset();
  try {
    await body(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
      [API_KEY_ENV_VAR, before.key],
    ] as const) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

/** Collect what a command printed, line by line. */
export function lines(): { out: string[]; write: (line: string) => void } {
  const out: string[] = [];
  return { out, write: (line) => out.push(line) };
}
