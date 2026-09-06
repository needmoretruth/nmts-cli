// The chunk half of the two fake servers — `PUT`/`GET /v1/manifest/chunks/{hash}` and the `refs`
// the index write carries (NCF-3 §6.3).
//
// ⛔ IT CHECKS THE NAME AGAINST THE BYTES, exactly as the real route does. That check is what the
//    whole format rests on — a chunk is served by hash and a client is told it may keep it forever
//    — so a fake that stored anything under any name could not fail for a tool that hashed the
//    wrong thing, which is the easiest mistake to make here (the digest is over the base64url
//    TRANSPORT STRING, not over the bytes it encodes).
//
// ⛔ AND IT REFUSES AN INDEX THAT NAMES A CHUNK IT DOES NOT HOLD, with the code the server uses.
//    That refusal has a mechanical remedy the tool is supposed to carry out, and a fake that
//    accepted every index could not fail for a tool that skipped it.
//
// ⚠ THE ALLOWANCE IS NOT MODELLED. It is server policy measured against what the chain confirmed,
//   and nothing in this package can influence it; the tool's job is to report that refusal, which
//   `api-advice.ts` covers.

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { registerNodeZstd } from "../src/zstd-node.ts";
import {
  encodeChunk,
  encodeIndex,
  FILE_LIST_VERSION_CHUNKED,
  type ManifestChunkRef,
} from "../src/shared/lib/drive/manifest-chunks.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { buildIndex } from "../src/shared/lib/drive/manifest-index.ts";
import { placementKey } from "../src/shared/lib/drive/manifest-pack.ts";
import { sealFileList, sealFileListChunk } from "./helpers.ts";

/** A refusal body in the server's own shape. */
interface Refusal {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** One index write as it arrived. */
export interface IndexWrite {
  ct: string;
  refs: string[];
}

export interface ChunkFake {
  /** The sealed chunks this account holds, by name. A test may edit it to corrupt one. */
  readonly store: Map<string, string>;
  /** Every index write the tool made, in order — what it carried and which chunks it named. */
  readonly indexWrites: IndexWrite[];
  /** Refuse the next `n` index writes with `MANIFEST_CHUNK_MISSING`, whatever they name. */
  refuseMissing: number;
  /** Answer the two chunk routes. True when this request was one of them. */
  route(method: string, url: string, req: IncomingMessage, res: ServerResponse): boolean;
  /** Record an index write, and answer with the refusal it earns, or null to carry on. */
  noteIndexWrite(body: unknown): Refusal | null;
  /** Seal these groups as one version-2 index and its chunks, and hold the chunks. */
  publish(
    code: string,
    groups: readonly (readonly ManifestEntry[])[],
    seq: number,
    prev?: string,
  ): Promise<{ seq: number; ct: string }>;
  reset(): void;
}

/** The name a chunk travels under: base64url SHA-256 of its transport string. */
export function nameOf(ct: string): string {
  return createHash("sha256").update(ct, "utf8").digest("base64url");
}

export function chunkFake(): ChunkFake {
  const store = new Map<string, string>();
  const indexWrites: IndexWrite[] = [];
  const state = { refuseMissing: 0 };

  const send = (res: ServerResponse, status: number, body: unknown): true => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return true;
  };

  return {
    store,
    indexWrites,
    get refuseMissing() {
      return state.refuseMissing;
    },
    set refuseMissing(v: number) {
      state.refuseMissing = v;
    },

    route(method, url, req, res): boolean {
      const at = /^\/v1\/manifest\/chunks\/([A-Za-z0-9_-]+)$/.exec(url);
      if (at === null) return false;
      const hash = at[1] ?? "";
      if (method === "GET") {
        const ct = store.get(hash);
        if (ct === undefined) {
          return send(res, 404, { error: { code: "NOT_FOUND", message: "no such chunk" } });
        }
        return send(res, 200, { ct });
      }
      if (method !== "PUT") return false;
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
      req.on("end", () => {
        const body: unknown = raw === "" ? {} : JSON.parse(raw);
        const ct: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "ct") : null;
        if (typeof ct !== "string") {
          send(res, 400, { error: { code: "VALIDATION", message: "ct is missing" } });
          return;
        }
        if (nameOf(ct) !== hash) {
          send(res, 422, {
            error: { code: "MANIFEST_CHUNK_HASH", message: "the name is not the hash of these bytes" },
          });
          return;
        }
        const existed = store.has(hash);
        store.set(hash, ct);
        send(res, 200, { existed });
      });
      return true;
    },

    noteIndexWrite(body): Refusal | null {
      const raw: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "refs") : null;
      const refs: string[] = [];
      for (const name of Array.isArray(raw) ? raw : []) {
        if (typeof name === "string") refs.push(name);
      }
      const ct: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "ct") : "";
      indexWrites.push({ ct: typeof ct === "string" ? ct : "", refs });
      const missing = state.refuseMissing > 0 ? refs : refs.filter((h) => !store.has(h));
      if (state.refuseMissing > 0) state.refuseMissing -= 1;
      if (missing.length === 0) return null;
      return {
        error: {
          code: "MANIFEST_CHUNK_MISSING",
          message: "the index names chunks this account has not stored",
          details: { missing },
        },
      };
    },

    async publish(code, groups, seq, prev): Promise<{ seq: number; ct: string }> {
      registerNodeZstd();
      const all = groups.flat();
      const index = buildIndex(all);
      const rows: ManifestChunkRef[] = [];
      for (const items of groups) {
        const ct = await sealFileListChunk(
          code,
          await encodeChunk({ v: FILE_LIST_VERSION_CHUNKED, seq, items }),
        );
        store.set(nameOf(ct), ct);
        const first = items[0];
        const last = items[items.length - 1];
        rows.push({
          h: nameOf(ct),
          n: items.length,
          f: first === undefined ? "" : placementKey(first, index),
          l: last === undefined ? "" : placementKey(last, index),
        });
      }
      const body = await encodeIndex({
        v: FILE_LIST_VERSION_CHUNKED,
        seq,
        ...(seq > 1 ? { p: prev ?? "cHJldmlvdXM" } : {}),
        chunks: rows,
      });
      return { seq, ct: await sealFileList(code, body) };
    },

    reset(): void {
      store.clear();
      indexWrites.length = 0;
      state.refuseMissing = 0;
    },
  };
}
