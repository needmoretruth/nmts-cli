// The stub drives the gateway tests are driven against, and the two ways of talking to a gateway.
//
// ⚠ `readOnly` stubs the file bytes and nothing else. What the account really holds and how it is
//   decrypted is tested where that code lives; in those files the question is whether the protocol
//   in front of it is right.
//
// ⛔ `fakeDrive` IS AN ACCOUNT, NOT A WRITER. It is handed to the real `createDriveSource`, so the
//    tests that write go through the same-file rule, the overwrite rule and the list read again for
//    the tag — the code `nmts s3` and the SDK both run. Its hashes are sealed with a real NMTS key,
//    the way an upload seals them, so "the same bytes" is decided by the real reader.

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AAD, DERIVED, loadCrypto } from "../src/crypto.ts";
import type { PlaintextSink } from "../src/download-sink.ts";
import { entryAt, normaliseName } from "../src/drive-paths.ts";
import { planAddition } from "../src/manifest-write.ts";
import { createDriveSource, type DriveAccount, type DriveSourceOptions } from "../src/s3/drive.ts";
import { freeingIntents } from "../src/s3/drive-trashed-name.ts";
import { objectsOf, type DriveObject } from "../src/s3/listing.ts";
import { newCredential, type DriveSource, type WriteMeta } from "../src/s3/server.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { applyIntents, type ManifestIntent } from "../src/shared/lib/drive/manifest-ops.ts";
import { generateCode } from "./helpers.ts";
import { sign } from "./s3-sign.ts";

export const CREDENTIAL = newCredential();
export const CONTENT = Buffer.from("the bytes of a file that lives in the drive");

export function file(id: string, name: string, parentId: string | null, size: number): ManifestEntry {
  return {
    id,
    parentId,
    kind: 1,
    name,
    size,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    dekWrapped: "not-opened-in-this-test",
  };
}

export function folder(id: string, name: string, parentId: string | null): ManifestEntry {
  return { id, parentId, kind: 0, name, size: 0, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 };
}

export const ENTRIES: readonly ManifestEntry[] = [
  folder("f1", "photos", null),
  folder("f2", "2026", "f1"),
  folder("f3", "empty", null),
  file("i1", "readme.txt", null, CONTENT.length),
  file("i2", "a.jpg", "f1", 11),
  file("i3", "b.jpg", "f2", 22),
  { ...file("i4", "gone.txt", null, 5), deletedAt: 1_700_000_400_000 },
  { ...file("i5", "inside-trashed-folder.txt", "f4", 5) },
  { ...folder("f4", "thrown-away", null), deletedAt: 1_700_000_400_000 },
];

/** What `nmts s3` hands the gateway: one pair, one name, one drive. */
export const readOnly = {
  entries: async () => ENTRIES,
  fetch: async (object: DriveObject, sink: PlaintextSink) => {
    sink.expect(object.size);
    await sink.write(CONTENT.subarray(0, object.size));
    await sink.commit();
  },
};

/** Seal a content hash the way an upload does, so the same-file reader is tested against the format. */
async function sealHash(code: string, bytes: Uint8Array): Promise<string> {
  const crypt = await loadCrypto();
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(code));
  const dataKey = derived.slice(from, to);
  derived.fill(0);
  const hash = new Uint8Array(createHash("sha256").update(bytes).digest());
  const out = crypt.b64_encode(crypt.envelope_seal(dataKey, new TextEncoder().encode(AAD.contentHash), hash));
  dataKey.fill(0);
  return out;
}

export interface FakeDrive {
  readonly account: DriveAccount;
  /** The account's list as it stands, trash included. */
  readonly entries: ManifestEntry[];
  /** Every call to `store`, in order. */
  readonly stores: Array<{ key: string; replace: boolean; meta: WriteMeta }>;
  /** Every path sent to the trash, in order. */
  readonly trashed: string[];
  /** How many runs of plaintext the reader handed a sink, over the whole test. */
  readonly delivered: { writes: number };
  /** Make the next `store` throw this. */
  failNextStore(error: unknown): void;
  /** Make every `fetch` throw this, until cleared with null. */
  failFetch(error: unknown): void;
  /** Put a file straight into the list, with or without a recorded hash. */
  seed(key: string, text: string, options?: { hashed?: boolean }): Promise<void>;
  /** The plaintext the drive holds at a key now. */
  textAt(key: string): string | undefined;
  /** A source over this drive, with a staging directory of its own. */
  source(options?: Partial<DriveSourceOptions>): DriveSource;
  /** How many times the list was written, over the whole test. */
  readonly listWrites: { count: number };
  /** Make every attempt to trash this path fail, alone or in a batch. */
  failTrashOf(path: string, error: unknown): void;
}

/** How big each run of plaintext `fetch` hands the sink. Small, so a range spans several. */
export const FETCH_RUN = 4;

export async function fakeDrive(): Promise<FakeDrive> {
  const code = await generateCode();
  const entries: ManifestEntry[] = [];
  const bytes = new Map<string, Buffer>();
  const stores: FakeDrive["stores"] = [];
  const trashed: string[] = [];
  const delivered = { writes: 0 };
  const listWrites = { count: 0 };
  const failTrash = new Map<string, unknown>();
  let failStore: unknown = null;
  let failRead: unknown = null;
  let tick = 0;
  const now = (): number => 1_700_000_000_000 + (tick += 1000);

  let made = 0;
  /** One write to the list, as the real edit makes it: the whole list, replaced. */
  const apply = (intents: readonly ManifestIntent[]): void => {
    if (intents.length === 0) return;
    listWrites.count += 1;
    entries.splice(0, entries.length, ...applyIntents(entries, intents));
  };
  // ⛔ THE REAL RULES, NOT A COPY OF THEM: a folder already there (compared as names are) is the
  //    folder, a file in the way refuses, and a name the trash holds is still taken.
  const folderNamed = (parent: string | null, name: string): ManifestEntry | undefined => {
    const there = entries.find(
      (e) => e.parentId === parent && normaliseName(e.name) === normaliseName(name) && e.deletedAt === undefined,
    );
    if (there !== undefined && there.kind !== 0) throw new Error(`NAME_TAKEN: "${name}" is a file`);
    return there;
  };
  const makeFolder = async (path: string): Promise<void> => {
    let parent: string | null = null;
    for (const name of path.split("/")) {
      let found = folderNamed(parent, name);
      if (found === undefined) {
        const at = now();
        found = { id: `d${(made += 1)}`, parentId: parent, kind: 0, name, size: 0, createdAt: at, updatedAt: at };
        apply([{ op: "add", entry: found }]);
      }
      parent = found.id;
    }
  };
  const folderId = (path: string | undefined): string | null => {
    if (path === undefined) return null;
    let parent: string | null = null;
    for (const name of path.split("/")) {
      const found = folderNamed(parent, name);
      if (found === undefined) throw new Error(`no folder ${path}`);
      parent = found.id;
    }
    return parent;
  };
  /** Add a file the way an upload does: `planAddition` decides its name and what it displaces. */
  const add = async (at: string | undefined, name: string, body: Buffer, hashed: boolean, replace: boolean): Promise<string> => {
    const stamp = now();
    const id = `x${(made += 1)}`;
    const entry: ManifestEntry = {
      id,
      parentId: folderId(at),
      kind: 1,
      name,
      size: body.length,
      createdAt: stamp,
      updatedAt: stamp,
      dekWrapped: "fake",
      ...(hashed ? { contentHashCt: await sealHash(code, body) } : {}),
    };
    apply(planAddition(entries, entry, replace ? "overwrite" : "rename", stamp).intents);
    bytes.set(id, body);
    return id;
  };
  /** Send paths to the trash in one write, refusing the whole run when one does not resolve — as `rm` does. */
  const trashPaths = (paths: readonly string[]): void => {
    const found = paths.map((path) => entryAt(entries, path));
    apply([{ op: "trash", ids: found.map((e) => e.id), at: now() }]);
    trashed.push(...paths);
  };
  const split = (key: string): { at: string | undefined; name: string } => {
    const slash = key.lastIndexOf("/");
    return slash < 0 ? { at: undefined, name: key } : { at: key.slice(0, slash), name: key.slice(slash + 1) };
  };

  const account: DriveAccount = {
    readList: async () => entries.map((e) => ({ ...e })),
    withCode: (use) => use(code),
    makeFolder,
    store: async (local, name, at, how) => {
      stores.push({ key: at === undefined ? name : `${at}/${name}`, replace: how.replace, meta: how.meta });
      if (failStore !== null) {
        const error = failStore;
        failStore = null;
        throw error;
      }
      // The upload path stores an empty file as it stores any other.
      const body = readFileSync(local);
      return { id: await add(at, name, body, true, how.replace) };
    },
    trash: async (path) => {
      if (failTrash.has(path)) throw failTrash.get(path);
      trashPaths([path]);
    },
    trashMany: async (paths) => {
      const refused = paths.find((path) => failTrash.has(path));
      if (refused !== undefined) throw new Error(`the server refused to trash ${refused}`);
      trashPaths(paths);
    },
    freeTrashedName: async (folder, name) => {
      apply(freeingIntents(entries, folder, name, now()));
    },
    fetch: async (object, sink) => {
      if (failRead !== null) throw failRead;
      const body = bytes.get(object.entry.id) ?? Buffer.alloc(0);
      try {
        sink.expect(body.length);
        for (let at = 0; at < body.length; at += FETCH_RUN) {
          delivered.writes += 1;
          await sink.write(new Uint8Array(body.subarray(at, at + FETCH_RUN)));
        }
        await sink.commit();
      } catch (error) {
        await sink.abandon();
        throw error;
      }
    },
  };

  return {
    account,
    entries,
    stores,
    trashed,
    delivered,
    failNextStore: (error) => {
      failStore = error;
    },
    failFetch: (error) => {
      failRead = error;
    },
    seed: async (key, text, options = {}) => {
      const { at, name } = split(key);
      if (at !== undefined) await makeFolder(at);
      await add(at, name, Buffer.from(text), options.hashed ?? true, false);
    },
    textAt: (key) => {
      const object = objectsOf(entries).find((o) => o.key === key);
      return object === undefined ? undefined : bytes.get(object.entry.id)?.toString();
    },
    listWrites,
    failTrashOf: (path, error) => {
      failTrash.set(path, error);
    },
    source: (options = {}) =>
      createDriveSource({
        account,
        stagingRoot: mkdtempSync(join(tmpdir(), "nmts-gateway-test-")),
        writable: true,
        listCacheMs: 0,
        ...options,
      }),
  };
}

/** Listen on a free loopback port and answer the host a client puts in its requests. */
export async function listening(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  if (bound === null || typeof bound !== "object") throw new Error("the gateway is not on a port");
  return `127.0.0.1:${bound.port}`;
}

export interface Sent {
  readonly body?: Buffer | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly credential?: { accessKeyId: string; secretAccessKey: string } | undefined;
}

/**
 * One signed request over real HTTP. Extra `x-amz-*` headers are signed, as S3 requires and every
 * client does; the rest are sent unsigned, which S3 and the gateway allow.
 */
export async function send(host: string, method: string, target: string, sent: Sent = {}): Promise<Response> {
  const body = sent.body ?? Buffer.alloc(0);
  const amz = Object.fromEntries(Object.entries(sent.headers ?? {}).filter(([name]) => name.startsWith("x-amz-")));
  const signed = sign(method, target, host, sent.credential ?? CREDENTIAL, new Date(), body, amz);
  const reading = method === "GET" || method === "HEAD";
  return await fetch(signed.url, {
    method,
    headers: { ...signed.headers, ...(reading ? {} : { "content-length": String(body.length) }), ...sent.headers },
    ...(body.length > 0 ? { body } : {}),
  });
}

export interface RawAnswer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/**
 * One request with every header chosen by the caller — a `Host` that is not the address connected
 * to, a body that is not what was signed — which `fetch` will not send.
 */
export async function raw(
  host: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer = Buffer.alloc(0),
): Promise<RawAnswer> {
  const port = Number(host.slice(host.lastIndexOf(":") + 1));
  return await new Promise<RawAnswer>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }),
      );
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** The `<Tag>value</Tag>` values of a document, in order, with the escapes XML needs undone. */
export function values(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((m) =>
    (m[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}
