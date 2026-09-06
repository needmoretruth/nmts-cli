// Storage resources — the "size × time" a wallet holds, read from the chain. ⚠ PUBLISHED —
// copied byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ WHY THIS EXISTS (owner directive 2026-08-10, pressed again 2026-08-27). What the storage
//    network sells is not a file but an OBJECT WITH A SIZE AND A PERIOD. Deleting a file gives
//    that object BACK TO ITS OWNER — and until this, the product had nowhere to see what came
//    back, nor to use it: the erase path sent it to the person's address and stopped, so paid-for
//    space sat there unseen.
//
// ⛔ THE TYPE NAME IS NOT WRITTEN AS A CONSTANT. When Walrus upgrades its contract the package
//    address changes, but a Move type carries the package that FIRST defined it. So the name is cut
//    from the system object's own type — an object that survives upgrades (the same judgement the
//    wallet configuration makes). ⚠ Written by hand, the list would fall to "none" — not to an
//    error — on the day of the next upgrade.
//
// ⛔ EVERYTHING HERE IS A READ. Splitting, fusing and transferring need a signature and are not here.
//
// FAILURE MODES: what cannot be read THROWS — it is not flattened to "0 resources". Having none and
//   failing to read are different facts to a person, and drawing both as one screen is a defect this
//   product has stepped on more than once.

/**
 * The slice of a Sui RPC client this file uses. Structural on purpose: the browser hands in its
 * Walrus-extended client and the command-line tool its plain JSON-RPC client, and neither has to
 * be named here.
 */
export interface StorageChainReader {
  getObject(input: {
    id: string;
    options: { showType: true };
  }): Promise<{ data?: { type?: string | null } | null }>;
  getOwnedObjects(input: {
    owner: string;
    filter: { StructType: string };
    options: { showContent: true };
    cursor?: string;
  }): Promise<{ data?: readonly unknown[] | null; hasNextPage?: boolean; nextCursor?: string | null }>;
}

/** One storage resource — the chain's `Storage { id, start_epoch, end_epoch, storage_size }` as is. */
export interface StorageResource {
  /** The Sui object id. */
  readonly objectId: string;
  /** The epoch from which this resource can be used. */
  readonly startEpoch: number;
  /** The epoch at which it ends. */
  readonly endEpoch: number;
  /** How much it can hold AFTER encoding, in bytes. ⚠ Not a plaintext size. */
  readonly sizeBytes: number;
}

/**
 * This network's storage-resource type name, derived from the system object.
 *
 * ⛔ `showType` only — the content is not needed, and asking for it returns a large answer.
 */
export async function readStorageType(
  client: StorageChainReader,
  systemObjectId: string,
): Promise<string> {
  const res = await client.getObject({ id: systemObjectId, options: { showType: true } });
  const type = res.data?.type;
  if (typeof type !== "string" || !type.includes("::")) {
    throw new Error("The storage network's system object did not say its type.");
  }
  return `${type.split("::")[0]}::storage_resource::Storage`;
}

/** One object response as a storage resource. A different shape gives null — it quietly leaves the list. */
export function toStorageResource(node: unknown): StorageResource | null {
  if (typeof node !== "object" || node === null) return null;
  const data: unknown = Reflect.get(node, "data");
  if (typeof data !== "object" || data === null) return null;
  const objectId: unknown = Reflect.get(data, "objectId");
  const content: unknown = Reflect.get(data, "content");
  if (typeof objectId !== "string" || typeof content !== "object" || content === null) return null;
  const fields: unknown = Reflect.get(content, "fields");
  if (typeof fields !== "object" || fields === null) return null;
  const start = Number(Reflect.get(fields, "start_epoch"));
  const end = Number(Reflect.get(fields, "end_epoch"));
  const size = Number(Reflect.get(fields, "storage_size"));
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(size)) return null;
  return { objectId, startEpoch: start, endEpoch: end, sizeBytes: size };
}

/**
 * Every storage resource this address holds.
 *
 * ⚠ Follows the pages to the end. Reading only the first would show a person with many resources
 *   SOME OF THEM AS IF THEY WERE ALL, which is a worse lie than "none".
 */
export async function readOwnedStorage(
  client: StorageChainReader,
  owner: string,
  storageType: string,
  maxPages = 20,
): Promise<StorageResource[]> {
  const out: StorageResource[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await client.getOwnedObjects({
      owner,
      filter: { StructType: storageType },
      options: { showContent: true },
      ...(cursor === null ? {} : { cursor }),
    });
    for (const node of res.data ?? []) {
      const one = toStorageResource(node);
      if (one !== null) out.push(one);
    }
    if (res.hasNextPage !== true || typeof res.nextCursor !== "string") return out;
    cursor = res.nextCursor;
  }
  // ⛔ Hitting the page ceiling is SAID. Cutting quietly would make the screen claim "this is all".
  throw new Error("Too many storage resources to read in one go.");
}
