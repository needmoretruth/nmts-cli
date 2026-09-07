// A drive the tool can really talk to: the sealed file list, the item rows, and the expiry answer.
//
// ⛔ IT ENFORCES THE COMPARE-AND-SWAP, like the harness the trash tests use. A fake that accepts
//    every write cannot fail for a defect in the retry path, and the retry path is where a sweep
//    decides all over again whether the entries it announced are still due.
//
// ⛔ AND IT PAGES `/v1/objects`, because "the server still holds this row" is read from that
//    listing and a reader that stops at the first page would call every later row erased. A test
//    that cannot put an id on page two cannot fail for that.
//
// ⚠ NOTHING HERE ANSWERS A ROUTE THE SERVER DOES NOT HAVE. The addresses below are the ones the
//   real API registers; a fake that answered anything would prove the tool agrees with the test.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";

import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { openFileList, sealFileList } from "./helpers.ts";
import { chunkFake, type ChunkFake } from "./fake-chunks.ts";

/** Shaped like a real key so nothing refuses it before the request is made. */
export { KEY } from "./fake-rows.ts";
import { KEY } from "./fake-rows.ts";

export type { ExpiringRow, LossRow, RecheckResult, SentShareRow } from "./fake-rows.ts";
import type { ExpiringRow, LossRow, RecheckResult, SentShareRow } from "./fake-rows.ts";
export { collect, entry, folder, withSandbox } from "./fake-sandbox.ts";
import { sealed } from "./fake-sandbox.ts";
// ⛔ The site's own `/api/*` addresses answer here too, from a file of their own: they are a
//    different server surface with different headers, and `check:size` measures this one.
import { serveDocuments } from "./fake-docs.ts";
// ⛔ The ACCOUNT's own doors (the key mint, the device list) answer from a file of their own too.
import { resetAccount, serveAccount } from "./fake-account.ts";
// ⛔ And the two PERMANENT doors, from a file of their own for the same reason.
import { resetErase, serveErase } from "./fake-erase.ts";

export interface FakeDrive {
  readonly base: string;
  /** Item ids the server still holds a row for, in `GET /v1/objects` order. */
  objects: string[];
  /** How many ids one page of that listing carries. Small numbers force a second page. */
  objectsPageSize: number;
  /** What `GET /v1/items/expiring` answers, and whether it says it was cut short. */
  expiring: ExpiringRow[];
  truncated: boolean;
  /** Answer `items` with this instead, whatever it is — untyped so a test can send the shapes the
   *  type forbids (an epoch as a string), which a quietly skipping reader could not fail for. */
  expiringRaw: unknown;
  /** What `GET /v1/items/{id}/extend-preview` answers — untyped for the reason `expiringRaw` is.
   *  Null is "the server lists nothing to extend", which is a real answer. */
  extendPreview: unknown;
  /** Every extension the tool reported, in the order it reported them. */
  extendRecorded: { epochs: unknown; tx_digest: unknown }[];
  /**
   * Make recording an extension fail.
   *
   * ⛔ THE ONE FAILURE THIS HARNESS HAS TO BE ABLE TO PRODUCE. By the time that call is made the
   *    storage is already bought, so what the tool says here decides whether somebody pays twice.
   */
  extendRecordFails: boolean;
  /**
   * The rows `GET /v1/storage-loss` answers with, newest first.
   *
   * ⛔ HELD HERE RATHER THAN ANSWERED FROM A CONSTANT, because the two writes act on this list: a
   *    re-check that finds the object takes its row off, and a dismiss takes one off, and a fake
   *    whose list never changed could not fail for a tool that reported either as having happened
   *    when it had not.
   */
  losses: LossRow[];
  /** What the next re-check answers. `found` also takes the row out of the list above. */
  recheckResult: RecheckResult;
  /**
   * Every share this account has sent, across all files.
   *
   * ⛔ THE ROUTE FILTERS BY `item_id` AND SO DOES THIS. A fake that answered the whole list
   *    whatever was asked could not fail for a tool that forgot to name the file, and the answer
   *    would look right for the one-file tests that are most of them.
   */
  sentShares: SentShareRow[];
  /** What `GET /v1/items/{id}/parts` answers for one item, in the server's own spelling. Untyped
   *  like `expiringRaw`: a download that skipped a part it could not parse would look like a shorter
   *  file, and a harness that could not send one could not fail for that. */
  parts: Map<string, unknown>;
  /** Every request the tool made, in order. */
  calls: string[];
  /** Every sealed list the tool successfully wrote. */
  written: string[];
  /** The chunk half of this server: what it holds, and what each index write named. */
  readonly chunks: ChunkFake;
  /** Put a list on the server. Version 1 unless a later one is asked for. */
  serve(code: string, entries: ManifestEntry[], seq?: number): Promise<void>;
  /** Put a CHUNKED list on the server as the version the current one REPLACED. */
  servePreviousChunked(code: string, groups: readonly ManifestEntry[][], seq?: number): Promise<void>;
  /**
   * Put a list on the server as the version the current one REPLACED.
   *
   * ⛔ RETAINED SEPARATELY, exactly as the server retains it: `GET /v1/manifest/previous` answers
   *    from its own row and is absent for an account that has only ever written once. A write
   *    through this harness moves the version it replaced here too, so a test can reach the same
   *    state by either road.
   */
  servePrevious(code: string, entries: ManifestEntry[], seq?: number): Promise<void>;
  /** Let another device win the next write, exactly once, with this list. */
  otherDeviceWrites(code: string, entries: ManifestEntry[]): Promise<void>;
  /** The entries inside the last list the tool wrote. */
  lastWritten(code: string): Promise<ManifestEntry[]>;
  /** Forget everything between tests. */
  reset(): void;
  close(): void;
}

export async function startFakeDrive(): Promise<FakeDrive> {
  let served: { seq: number; ct: string } | null = null;
  let previous: { seq: number; ct: string } | null = null;
  let steal: string | null = null;
  const chunks = chunkFake();
  const state = {
    objects: [] as string[],
    objectsPageSize: 100,
    expiring: [] as ExpiringRow[],
    truncated: false,
    expiringRaw: undefined as unknown,
    extendPreview: null as unknown,
    extendRecorded: [] as { epochs: unknown; tx_digest: unknown }[],
    extendRecordFails: false,
    losses: [] as LossRow[],
    recheckResult: "still_missing" as RecheckResult,
    sentShares: [] as SentShareRow[],
    parts: new Map<string, unknown>(),
    calls: [] as string[],
    written: [] as string[],
  };

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    state.calls.push(`${method} ${url}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (serveDocuments(method, url, res)) return;
    if (serveAccount(method, url, req, res)) return;

    if (serveErase(method, url, req, res)) return;

    // ⛔ BEFORE THE ONES BELOW, because those match on a prefix and these addresses begin with it.
    if (chunks.route(method, url, req, res)) return;
    // ⛔ BEFORE THE ONE BELOW, because that one matches on a prefix and this address begins with
    //    it. A fake that answered the current list here would make a rollback look like a no-op.
    if (method === "GET" && url === "/v1/manifest/previous") {
      if (previous === null) return json(200, { state: "absent" });
      return json(200, {
        state: "present",
        seq: previous.seq,
        ct: previous.ct,
        updated_at: "2026-08-22T00:00:00Z",
      });
    }
    if (method === "GET" && url.startsWith("/v1/manifest")) {
      if (served === null) return json(200, { state: "absent" });
      return json(200, { state: "present", seq: served.seq, ct: served.ct, updated_at: "2026-08-23T00:00:00Z" });
    }
    if (method === "PUT" && url.startsWith("/v1/manifest")) {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        const body: unknown = JSON.parse(raw);
        const baseSeq: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "base_seq") : null;
        const ct: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "ct") : null;
        if (typeof ct !== "string") return json(400, { error: { code: "BAD", message: "no ct" } });
        const refused = chunks.noteIndexWrite(body);
        if (refused !== null) return json(422, refused);
        if (steal !== null) {
          const winner = steal;
          steal = null;
          served = { seq: (served?.seq ?? 0) + 1, ct: winner };
          return json(409, { error: { code: "VERSION_CONFLICT", message: "the list moved" } });
        }
        if ((typeof baseSeq === "number" ? baseSeq : 0) !== (served?.seq ?? 0)) {
          return json(409, { error: { code: "VERSION_CONFLICT", message: "the list moved" } });
        }
        state.written.push(ct);
        const seq = (served?.seq ?? 0) + 1;
        // The version this write replaced is retained, which is what makes a rollback possible.
        if (served !== null) previous = served;
        served = { seq, ct };
        json(200, { seq });
      });
      return;
    }
    if (method === "GET" && url.startsWith("/v1/items/expiring")) {
      const items: unknown = state.expiringRaw === undefined ? state.expiring : state.expiringRaw;
      return json(200, { items, truncated: state.truncated });
    }
    // `?for=download` rides along on the real request; the route is the path.
    if (method === "GET" && /^\/v1\/items\/[^/]+\/parts(\?.*)?$/.test(url)) {
      const id = decodeURIComponent(url.split("?")[0]?.split("/")[3] ?? "");
      const answer = state.parts.get(id);
      if (answer === undefined) return json(404, { error: { code: "NOT_FOUND", message: "no such item" } });
      return json(200, answer);
    }
    if (method === "GET" && /^\/v1\/items\/[^/]+\/extend-preview$/.test(url)) {
      const id = decodeURIComponent(url.split("/")[3] ?? "");
      // Null means "nothing on this file can be extended" — the shape the real server sends for a
      // file whose parts are all on treasury-paid storage.
      return json(200, state.extendPreview ?? { item_id: id, targets: [], treasury_parts: 1, untracked_parts: 0 });
    }
    if (method === "POST" && /^\/v1\/items\/[^/]+\/extended$/.test(url)) {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        const body: unknown = raw === "" ? {} : JSON.parse(raw);
        const at = (name: string): unknown =>
          typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
        if (state.extendRecordFails) {
          return json(500, { error: { code: "INTERNAL", message: "the note of it was not written" } });
        }
        state.extendRecorded.push({ epochs: at("epochs"), tx_digest: at("tx_digest") });
        json(200, { parts_moved: 1, quilts_moved: 0, replay: false });
      });
      return;
    }
    if (method === "GET" && url.startsWith("/v1/objects")) {
      // Cursor paging exactly as the API does it: `after` names the last id of the page before.
      const after = new URL(url, "http://x").searchParams.get("after");
      const from = after === null ? 0 : state.objects.indexOf(after) + 1;
      const page = state.objects.slice(from, from + state.objectsPageSize);
      const more = from + state.objectsPageSize < state.objects.length;
      return json(200, {
        objects: page.map((id) => ({ id, size: 1, visibility: 0 })),
        next_cursor: more ? (page.at(-1) ?? null) : null,
      });
    }
    if (method === "GET" && url.startsWith("/v1/shares/sent")) {
      const item = new URL(url, "http://x").searchParams.get("item_id");
      return json(200, { shares: state.sentShares.filter((r) => r.item_id === item) });
    }
    if (method === "GET" && url === "/v1/storage-loss") {
      return json(200, { losses: state.losses });
    }
    if (method === "POST" && url === "/v1/storage-loss/recheck") {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        const body: unknown = raw === "" ? {} : JSON.parse(raw);
        const id: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "blob_object_id") : null;
        // ⛔ 404 UNLESS THIS ACCOUNT ALREADY HOLDS THE LOSS, exactly as the route does it: without
        //    that the real one would be a free chain oracle, and a fake that answered anything
        //    could not fail for a tool that asked about an id it was never shown.
        if (typeof id !== "string" || !state.losses.some((l) => l.blob_object_id === id)) {
          return json(404, { error: { code: "NOT_FOUND", message: "no such loss" } });
        }
        if (state.recheckResult === "found") {
          state.losses = state.losses.filter((l) => l.blob_object_id !== id);
        }
        json(200, { result: state.recheckResult });
      });
      return;
    }
    if (method === "DELETE" && url.startsWith("/v1/storage-loss/")) {
      const id = decodeURIComponent(url.slice("/v1/storage-loss/".length));
      const before = state.losses.length;
      state.losses = state.losses.filter((l) => l.blob_object_id !== id);
      if (state.losses.length === before) {
        return json(404, { error: { code: "NOT_FOUND", message: "no such loss" } });
      }
      // 204, with no body — the shape the real route answers, and the one a reader that assumes
      // JSON on every success falls over.
      res.writeHead(204);
      res.end();
      return;
    }
    return json(404, { error: { code: "NOT_FOUND", message: "no such route" } });
  });

  // ⛔ NO IDLE CLOSE (2026-09-07). Node closes a kept-alive socket after 5 s of silence; under a loaded
  //    full run the gap between two tests in one file can pass that, and the next POST then meets the
  //    close mid-flight and comes back as `fetch failed` ("Could not reach …"). Seen twice in the
  //    check chain, never in the file alone. A test server has no reason to time anything out.
  server.keepAliveTimeout = 0;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
  const base = `http://127.0.0.1:${address.port}`;

  return {
    base,
    get objects() { return state.objects; },
    set objects(v: string[]) { state.objects = v; },
    get objectsPageSize() { return state.objectsPageSize; },
    set objectsPageSize(v: number) { state.objectsPageSize = v; },
    get expiring() { return state.expiring; },
    set expiring(v: ExpiringRow[]) { state.expiring = v; },
    get truncated() { return state.truncated; },
    set truncated(v: boolean) { state.truncated = v; },
    get expiringRaw(): unknown { return state.expiringRaw; },
    set expiringRaw(v: unknown) { state.expiringRaw = v; },
    get extendPreview(): unknown { return state.extendPreview; },
    set extendPreview(v: unknown) { state.extendPreview = v; },
    get extendRecorded() { return state.extendRecorded; },
    get extendRecordFails() { return state.extendRecordFails; },
    set extendRecordFails(v: boolean) { state.extendRecordFails = v; },
    get losses() { return state.losses; },
    set losses(v: LossRow[]) { state.losses = v; },
    get recheckResult() { return state.recheckResult; },
    set recheckResult(v: RecheckResult) { state.recheckResult = v; },
    get sentShares() { return state.sentShares; },
    set sentShares(v: SentShareRow[]) { state.sentShares = v; },
    get parts() { return state.parts; },
    get calls() { return state.calls; },
    get written() { return state.written; },
    chunks,
    async servePreviousChunked(code: string, groups: readonly ManifestEntry[][], seq = 1): Promise<void> {
      previous = await chunks.publish(code, groups, seq);
    },
    async serve(code: string, entries: ManifestEntry[], seq = 1): Promise<void> {
      served = { seq, ct: await sealed(code, entries, seq) };
    },
    async servePrevious(code: string, entries: ManifestEntry[], seq = 1): Promise<void> {
      previous = { seq, ct: await sealed(code, entries, seq) };
    },
    async otherDeviceWrites(code: string, entries: ManifestEntry[]): Promise<void> {
      const held = served;
      assert.ok(held !== null, "nothing is being served, so nothing can be raced");
      // ⚠ It names the version it was built on, exactly as a real device's would: the fork check
      //   refuses a list that does not, and a fixture that skipped it would test a shape the tool
      //   will never meet.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(held.ct));
      const prev = Buffer.from(digest).toString("base64url");
      steal = await sealFileList(code, await encodeManifest(entries, held.seq + 1, prev));
    },
    async lastWritten(code: string): Promise<ManifestEntry[]> {
      const ct = state.written.at(-1);
      assert.ok(ct !== undefined, "the tool wrote no file list at all");
      return openFileList(code, ct, chunks.store);
    },
    reset(): void {
      chunks.reset();
      resetErase();
      resetAccount();
      served = null;
      previous = null;
      steal = null;
      state.objects = [];
      state.objectsPageSize = 100;
      state.expiring = [];
      state.truncated = false;
      state.expiringRaw = undefined;
      state.extendPreview = null;
      state.extendRecorded = [];
      state.extendRecordFails = false;
      state.losses = [];
      state.recheckResult = "still_missing";
      state.sentShares = [];
      state.parts = new Map();
      state.calls = [];
      state.written = [];
    },
    close(): void {
      server.close();
    },
  };
}

