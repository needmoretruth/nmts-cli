import type { Network } from "./network.ts";
import type { SponsorFacts } from "./sponsor-check.ts";
/** Every relay's tip address that answers now, for `network`. */
export declare function readRelayTipAddresses(network: Network, extra?: readonly string[]): Promise<string[]>;
/**
 * The live facts for `network`, read once and kept: the package, the system object and the tip
 * addresses do not change between two transactions of one upload. `operator` is the address the
 * encoded-length question is asked as (a read; nothing is signed).
 */
export declare function sponsorFacts(network: Network, operator: string): Promise<SponsorFacts>;
