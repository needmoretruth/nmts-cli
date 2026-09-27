/** The tiers a person can pick, by the word every interface uses. */
export type StorageTier = "standard" | "heavy";
/** Every tier, in the order an interface lists them. */
export declare const STORAGE_TIERS: readonly StorageTier[];
/** What an upload uses when nobody chose. */
export declare const DEFAULT_STORAGE_TIER: StorageTier;
/** The storage network code a tier stores on. */
export declare function networkForTier(tier: StorageTier): number;
/**
 * The tier a stored network code belongs to, or `null` for a code no tier uses.
 *
 * An absent network field means Walrus (every part written before the field existed is on Walrus),
 * so `undefined` answers "standard". An unknown code answers `null` rather than a guess: a newer
 * client may have stored something this one has never heard of, and calling it Standard would send
 * a reader to the wrong network.
 */
export declare function tierForNetwork(network: number | undefined): StorageTier | null;
/** Whether a string is one of the tier words, exactly as written. */
export declare function isStorageTier(value: unknown): value is StorageTier;
/**
 * Read a tier word typed by a person (a `--tier` flag, an SDK option, a config file).
 *
 * Surrounding space and letter case are forgiven, because nothing else about the word is ambiguous.
 * Anything else is refused with a message naming the accepted words — never mapped to the default,
 * because a typo that silently stores a file on the other network is the one mistake a person cannot
 * see afterwards.
 */
export declare function parseStorageTier(raw: string): StorageTier;
