// A server that answers the two listings a rebuild reads, and enforces the write it ends with.
//
// ⛔ IT ENFORCES THE COMPARE-AND-SWAP. `base_seq: null` means "I believe this account has no file
//    list" and is accepted only while that is true, exactly as the real one does it. A fake that
//    accepted every write could not fail for the defect that matters most here — a rebuild landing
//    on top of a list somebody still had.
//
// ⛔ AND IT PAGES BOTH LISTINGS, because "the whole account was read" is the property a rebuild
//    rests on. A test that could not put a row on page two could not fail for a reader that stops
//    at the first one.
//
// ⚠ NOTHING HERE ANSWERS A ROUTE THE SERVER DOES NOT HAVE. The addresses below are the ones the
//   real API registers; a fake that answered anything would only prove the tool agrees with itself.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";

import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, openFileList, sealFileList } from "./helpers.ts";
import { KEY } from "./fake-drive.ts";

/** One row of `GET /v1/items`, in the server's own spelling. */
export interface ItemRow {
  id: string;
  size: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  dek_wrapped?: string | null;
  content_hash_ct?: string | null;
}

export interface FakeItems {
  readonly base: string;
  /** Rows the live listing hands back. */
  items: ItemRow[];
  /** Rows the trash listing hands back — the server's trash view, which ends at its own window. */
  trashed: ItemRow[];
  /**
   * Ids the reconciliation view reports. null means "whatever the two listings hold", which is the
   * ordinary case; a longer list is how a test says the server holds a row no listing returns.
   */
  objects: string[] | null;
  /** How many rows one page carries. Small numbers force a second page. */
  pageSize: number;
  /** Always answer with another page marker, however few rows are left. */
  neverEnds: boolean;
  /** Answer with the SAME page marker every time — a listing that cannot be read to the end. */
  repeatCursor: boolean;
  /** Every request the tool made, in order. */
  calls: string[];
  /** Every sealed list the tool successfully wrote. */
  written: string[];
  /** Put a list on the server at this version. */
  serve(code: string, entries: ManifestEntry[], seq?: number): Promise<void>;
  /** The sealed bytes the server is serving, or null when it is serving nothing. */
  servedCt(): string | null;
  /** Take the list away without clearing anything else — an account whose list went missing. */
  stopServing(): void;
  /** The entries inside the last list the tool wrote. */
  lastWritten(code: string): Promise<ManifestEntry[]>;
  reset(): void;
  close(): void;
}

export async function startFakeItems(): Promise<FakeItems> {
  let served: { seq: number; ct: string } | null = null;
  const state = {
    items: [] as ItemRow[],
    trashed: [] as ItemRow[],
    objects: null as string[] | null,
    pageSize: 100,
    neverEnds: false,
    repeatCursor: false,
    calls: [] as string[],
    written: [] as string[],
    /** Counts the pages handed out, so `neverEnds` offers a marker that never repeats. */
    pagesHandedOut: 0,
  };

  /** One page of a listing, keyed on the last id of the page before — the real cursor rule. */
  const page = <T extends { id: string }>(rows: readonly T[], after: string | null): { page: T[]; next: string | null } => {
    if (state.repeatCursor) return { page: rows.slice(0, 1), next: "stuck" };
    const from = after === null ? 0 : rows.findIndex((r) => r.id === after) + 1;
    const slice = rows.slice(from, from + state.pageSize);
    const more = from + state.pageSize < rows.length;
    if (state.neverEnds) {
      state.pagesHandedOut += 1;
      // A NEW marker every time: an account that genuinely goes on for ever, not a stuck listing.
      return { page: slice, next: `page-${state.pagesHandedOut}` };
    }
    return { page: slice, next: more ? (slice.at(-1)?.id ?? null) : null };
  };

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    state.calls.push(`${method} ${url}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const query = new URL(url, "http://x").searchParams;
    const after = query.get("after");

    if (method === "GET" && url.startsWith("/v1/manifest")) {
      if (served === null) return json(200, { state: "absent" });
      return json(200, { state: "present", seq: served.seq, ct: served.ct, updated_at: "2026-08-24T00:00:00Z" });
    }
    if (method === "PUT" && url.startsWith("/v1/manifest")) {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        const body: unknown = JSON.parse(raw);
        const baseSeq: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "base_seq") : null;
        const ct: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "ct") : null;
        if (typeof ct !== "string") return json(400, { error: { code: "BAD", message: "no ct" } });
        // `null` is only true while nothing is stored; a number has to name the current version.
        const expected: number | null = served === null ? null : served.seq;
        const claimed: number | null = typeof baseSeq === "number" ? baseSeq : null;
        if (claimed !== expected) {
          return json(409, { error: { code: "VERSION_CONFLICT", message: "the list moved" } });
        }
        state.written.push(ct);
        const seq = (served?.seq ?? 0) + 1;
        served = { seq, ct };
        json(200, { seq });
      });
      return;
    }
    if (method === "GET" && url.startsWith("/v1/items")) {
      const trash = query.get("deleted") === "true";
      const answer = page(trash ? state.trashed : state.items, after);
      return json(200, { items: answer.page, next_cursor: answer.next });
    }
    if (method === "GET" && url.startsWith("/v1/objects")) {
      const ids = state.objects ?? [...state.items, ...state.trashed].map((r) => r.id);
      const answer = page(ids.map((id) => ({ id })), after);
      return json(200, {
        objects: answer.page.map((row) => ({ id: row.id, size: 1, visibility: 0 })),
        next_cursor: answer.next,
      });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "no such route" } });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
  const base = `http://127.0.0.1:${address.port}`;

  return {
    base,
    get items() {
      return state.items;
    },
    set items(v: ItemRow[]) {
      state.items = v;
    },
    get trashed() {
      return state.trashed;
    },
    set trashed(v: ItemRow[]) {
      state.trashed = v;
    },
    get objects(): string[] | null {
      return state.objects;
    },
    set objects(v: string[] | null) {
      state.objects = v;
    },
    get pageSize() {
      return state.pageSize;
    },
    set pageSize(v: number) {
      state.pageSize = v;
    },
    get neverEnds() {
      return state.neverEnds;
    },
    set neverEnds(v: boolean) {
      state.neverEnds = v;
    },
    get repeatCursor() {
      return state.repeatCursor;
    },
    set repeatCursor(v: boolean) {
      state.repeatCursor = v;
    },
    get calls() {
      return state.calls;
    },
    get written() {
      return state.written;
    },
    async serve(code: string, entries: ManifestEntry[], seq = 1): Promise<void> {
      served = { seq, ct: await sealFileList(code, await encodeManifest(entries, seq, seq > 1 ? "x".repeat(43) : undefined)) };
    },
    servedCt(): string | null {
      return served === null ? null : served.ct;
    },
    stopServing(): void {
      served = null;
    },
    async lastWritten(code: string): Promise<ManifestEntry[]> {
      const ct = state.written.at(-1);
      assert.ok(ct !== undefined, "the tool wrote no file list at all");
      return openFileList(code, ct);
    },
    reset(): void {
      served = null;
      state.items = [];
      state.trashed = [];
      state.objects = null;
      state.pageSize = 100;
      state.neverEnds = false;
      state.repeatCursor = false;
      state.calls = [];
      state.written = [];
      state.pagesHandedOut = 0;
    },
    close(): void {
      server.close();
    },
  };
}

/**
 * A config directory of this test's own, with the one agreement reading the code from the
 * environment needs. Everything is put back afterwards, including variables that were unset.
 */
export async function withAccount(
  fake: FakeItems,
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

/** One stored file as the server would report it. */
export function row(over: Partial<ItemRow> & Pick<ItemRow, "id">): ItemRow {
  return {
    size: 1024,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-02T11:00:00Z",
    dek_wrapped: `wrapped-key-for-${over.id}`,
    content_hash_ct: `sealed-hash-for-${over.id}`,
    ...over,
  };
}

/** Collect what a command printed, line by line. */
export function lines(): { out: string[]; write: (line: string) => void } {
  const out: string[] = [];
  return { out, write: (line) => out.push(line) };
}
