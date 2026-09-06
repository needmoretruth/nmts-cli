/** Network codes, as stored. Fixed forever once a row carries one. */
export declare const NETWORK_WALRUS = 0;
/** Filecoin — product tier 「NMTS Heavy」. Reserved; no upload path exists yet. */
export declare const NETWORK_FILECOIN = 1;
/** Arweave — reserved and deliberately last: it cannot be deleted, ever (BACKLOG §2.2). */
export declare const NETWORK_ARWEAVE = 2;
/** The wire NAME of each network, as the recovery map spells it. */
export type StorageNetworkName = "walrus" | "filecoin" | "arweave";
/**
 * Code → the name a recovery map stores. `null` for a code this build has never heard of.
 *
 * A newer client could store a network this one predates. Returning null makes that visible to
 * the caller instead of mislabelling someone's bytes.
 */
export declare function networkName(code: number): StorageNetworkName | null;
/** Name → code. `null` for anything not in the registry. */
export declare function networkCode(name: string): number | null;
/**
 * What an ABSENT network field means: Walrus.
 *
 * This is a fact, not a fallback. No other network has ever had an upload path, so every part,
 * entry and map written before the field existed is on Walrus by construction. Stated as a named
 * constant so the reasoning sits next to every use of it rather than being re-derived.
 */
export declare const NETWORK_WHEN_UNRECORDED = 0;
