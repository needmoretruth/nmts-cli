import { type StorageTier } from "./shared/lib/storage-tier.ts";
/** A file's tier from its parts: every part's network must name the same tier. */
export declare function tierOfParts(networks: readonly (number | undefined)[]): StorageTier | null;
/** The tier word as the column prints it. */
export declare function tierLabel(tier: StorageTier | null): string;
/** Each file id's tier, or null where it could not be read. */
export declare function tiersOf(server: string, apiKey: string, ids: readonly string[]): Promise<Map<string, StorageTier | null>>;
