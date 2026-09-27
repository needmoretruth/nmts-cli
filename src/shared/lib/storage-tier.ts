// WHICH TIER a person picks, and which storage network that tier means — the one place the two
// are tied together.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package.
//   Keep the comments self-contained English, with no pointer only we can follow.
//
// A TIER IS A PRODUCT NAME; A NETWORK IS WHAT IS UNDERNEATH. A person chooses "NMTS Standard" or
// "NMTS Heavy" and never has to learn what Walrus or Filecoin is. Stored rows, sealed file lists and
// recovery maps record the NETWORK (`storage-network.ts`), because that is what a reader needs years
// later to find the bytes. Keeping the mapping here, and only here, means renaming a tier can never
// silently change where anybody's bytes are recorded to be.
//
//   standard ↔ network 0 (Walrus)   — erasure-coded across many storage nodes, paid per epoch
//   heavy    ↔ network 1 (Filecoin) — whole copies kept by two separate storage companies
//
// The same word is used everywhere: `--tier standard|heavy` on the command line, `tier:` in the SDK.
// The default is "standard".

import { NETWORK_FILECOIN, NETWORK_WALRUS } from "./storage-network.ts";

/** The tiers a person can pick, by the word every interface uses. */
export type StorageTier = "standard" | "heavy";

/** Every tier, in the order an interface lists them. */
export const STORAGE_TIERS: readonly StorageTier[] = ["standard", "heavy"];

/** What an upload uses when nobody chose. */
export const DEFAULT_STORAGE_TIER: StorageTier = "standard";

const NETWORK_OF: Readonly<Record<StorageTier, number>> = {
  standard: NETWORK_WALRUS,
  heavy: NETWORK_FILECOIN,
};

/** The storage network code a tier stores on. */
export function networkForTier(tier: StorageTier): number {
  return NETWORK_OF[tier];
}

/**
 * The tier a stored network code belongs to, or `null` for a code no tier uses.
 *
 * An absent network field means Walrus (every part written before the field existed is on Walrus),
 * so `undefined` answers "standard". An unknown code answers `null` rather than a guess: a newer
 * client may have stored something this one has never heard of, and calling it Standard would send
 * a reader to the wrong network.
 */
export function tierForNetwork(network: number | undefined): StorageTier | null {
  if (network === undefined || network === NETWORK_WALRUS) return "standard";
  if (network === NETWORK_FILECOIN) return "heavy";
  return null;
}

/** Whether a string is one of the tier words, exactly as written. */
export function isStorageTier(value: unknown): value is StorageTier {
  return value === "standard" || value === "heavy";
}

/**
 * Read a tier word typed by a person (a `--tier` flag, an SDK option, a config file).
 *
 * Surrounding space and letter case are forgiven, because nothing else about the word is ambiguous.
 * Anything else is refused with a message naming the accepted words — never mapped to the default,
 * because a typo that silently stores a file on the other network is the one mistake a person cannot
 * see afterwards.
 */
export function parseStorageTier(raw: string): StorageTier {
  const value = raw.trim().toLowerCase();
  if (isStorageTier(value)) return value;
  throw new RangeError(`Unknown storage tier "${raw}". Use "standard" or "heavy".`);
}
