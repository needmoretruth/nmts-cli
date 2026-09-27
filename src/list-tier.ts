// Which tier each listed file is stored on — the `tier` column of `nmts ls --long`.
//
// ⛔ THE SEALED LIST DOES NOT KNOW IT. Names and sizes live in the account's sealed list; which
//    storage network holds a file's parts is the server's row. So the long listing asks the server
//    the one question it already answers for a download (`GET /v1/items/{id}/parts`), a few files at
//    a time, and only when `--long` was asked for — a plain `ls` stays one request.
//
// ⛔ WHAT CANNOT BE READ IS `?`, NEVER A GUESS. A part on a network this build does not know, a file
//    the server would not describe (a trashed one), or a request that failed — each is shown as `?`
//    rather than called Standard, because calling it Standard would name the wrong network.

import { request } from "./api.ts";
import { asParts } from "./download-part.ts";
import { tierForNetwork, type StorageTier } from "./shared/lib/storage-tier.ts";

/** How many files are asked about at once. */
const AT_ONCE = 8;

/** A file's tier from its parts: every part's network must name the same tier. */
export function tierOfParts(networks: readonly (number | undefined)[]): StorageTier | null {
  if (networks.length === 0) return null;
  const tiers = new Set(networks.map((n) => tierForNetwork(n)));
  const [only] = [...tiers];
  return tiers.size === 1 && only !== undefined ? only : null;
}

/** The tier word as the column prints it. */
export function tierLabel(tier: StorageTier | null): string {
  return tier ?? "?";
}

/** Each file id's tier, or null where it could not be read. */
export async function tiersOf(
  server: string,
  apiKey: string,
  ids: readonly string[],
): Promise<Map<string, StorageTier | null>> {
  const out = new Map<string, StorageTier | null>();
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let id = ids[next]; id !== undefined; id = ids[next]) {
      next += 1;
      try {
        const described = asParts(await request(server, `/v1/items/${encodeURIComponent(id)}/parts`, { token: apiKey }));
        out.set(id, tierOfParts(described.parts.map((p) => p.network)));
      } catch {
        // Not readable is its own answer, and the column says so with `?`.
        out.set(id, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, ids.length) }, worker));
  return out;
}
