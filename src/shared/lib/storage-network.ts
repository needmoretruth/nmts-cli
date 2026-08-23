// WHICH STORAGE NETWORK a stored piece lives on — the client half of the registry. The server
// keeps the same codes in its own item rows. NCF-3 dropped the storage-network section the old
// format document carried, so these modules ARE the registry now.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.
//
// WHY THIS EXISTS AT ALL: every placement field NMTS has ever written is Walrus vocabulary —
// `blob_id`, `patch_id`, `sui_object_id`, `expiry_epoch`. Nothing said so, because until the
// tiers were decided (BACKLOG §2.2) "the storage network" and "Walrus" were the same thing. A
// blob id is only meaningful on the network that issued it, so a recovery tool holding one and
// no network name has to guess which aggregator to ask.
//
// TWO SPELLINGS, ONE MEANING — and the split is deliberate:
//   · NUMBER (0/1/2) in the database and in the sealed FILE LIST (NMF-1), where every byte is
//     rewritten on each save and repeated across thousands of entries.
//   · NAME ("walrus") in the RECOVERY MAP (NRM-2), which a standalone tool parses years from now
//     with none of our code beside it. A magic number in that document is a trap; a word is not.
// This mirrors the existing `kind` field, which is `1` in the file list and `"file"` in the map.
//
// ⚠ NOT A TIER MAPPING. 「NMTS Fast」/「NMTS Heavy」 are product names for what the person buys;
// these are the networks underneath. The screen keeps its own mapping (components/drive/
// StorageTier.tsx) so a rename of either never silently redefines the other.
//
// FAILURE MODES: none at runtime — pure functions over constants. An UNKNOWN code answers `null`
// rather than falling back to Walrus: a wrong network recorded in a recovery map is unfixable
// years later, so callers are made to decide what to do about it.

/** Network codes, as stored. Fixed forever once a row carries one. */
export const NETWORK_WALRUS = 0;
/** Filecoin — product tier 「NMTS Heavy」. Reserved; no upload path exists yet. */
export const NETWORK_FILECOIN = 1;
/** Arweave — reserved and deliberately last: it cannot be deleted, ever (BACKLOG §2.2). */
export const NETWORK_ARWEAVE = 2;

/** The wire NAME of each network, as the recovery map spells it. */
export type StorageNetworkName = "walrus" | "filecoin" | "arweave";

const BY_CODE: Record<number, StorageNetworkName> = {
  [NETWORK_WALRUS]: "walrus",
  [NETWORK_FILECOIN]: "filecoin",
  [NETWORK_ARWEAVE]: "arweave",
};

const BY_NAME: Record<string, number> = {
  walrus: NETWORK_WALRUS,
  filecoin: NETWORK_FILECOIN,
  arweave: NETWORK_ARWEAVE,
};

/**
 * Code → the name a recovery map stores. `null` for a code this build has never heard of.
 *
 * A newer client could store a network this one predates. Returning null makes that visible to
 * the caller instead of mislabelling someone's bytes.
 */
export function networkName(code: number): StorageNetworkName | null {
  return BY_CODE[code] ?? null;
}

/** Name → code. `null` for anything not in the registry. */
export function networkCode(name: string): number | null {
  return BY_NAME[name] ?? null;
}

/**
 * What an ABSENT network field means: Walrus.
 *
 * This is a fact, not a fallback. No other network has ever had an upload path, so every part,
 * entry and map written before the field existed is on Walrus by construction. Stated as a named
 * constant so the reasoning sits next to every use of it rather than being re-derived.
 */
export const NETWORK_WHEN_UNRECORDED = NETWORK_WALRUS;
