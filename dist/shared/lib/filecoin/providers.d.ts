/** A Filecoin chain NMTS Heavy can run on. */
export type FilecoinChain = "calibration" | "mainnet";
/** One storage company NMTS may place a copy with. */
export interface FilecoinProvider {
    /** The company's id in the chain's service-provider registry. */
    readonly id: bigint;
    /** The host of its storage service (`https://<host>`); uploads and reads go here. */
    readonly host: string;
    /** Who runs it. Two copies of one file never go to the same operator when another exists. */
    readonly operator: string;
    /** Whether the chain's endorsement list names it. The first copy always goes to an endorsed one. */
    readonly endorsed: boolean;
}
/** The allowlist, per chain, in preference order. */
export declare const FILECOIN_PROVIDERS: Readonly<Record<FilecoinChain, readonly FilecoinProvider[]>>;
/**
 * Which Filecoin chain goes with which NMTS network: test data stays on test networks.
 *
 * Keyed by the NMTS network name ("testnet" | "mainnet") so that this file needs no import.
 */
export declare const FILECOIN_CHAIN_FOR_NETWORK: Readonly<Record<"testnet" | "mainnet", FilecoinChain>>;
/** The `https://<host>` origins of one chain's list, in order. */
export declare function filecoinProviderOrigins(chain: FilecoinChain): string[];
/** The allowlisted company serving `host` on `chain`, or `null` when the host is not on the list. */
export declare function providerForHost(chain: FilecoinChain, host: string): FilecoinProvider | null;
