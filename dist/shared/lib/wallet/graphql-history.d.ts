import type { DeeperHistory } from "./address-history.ts";
/**
 * Sui's public GraphQL services per network, in the order they are asked. Measured 2026-10-21 for
 * Mysten Labs: the `affectedAddress` filter answered back to 2023 on both networks, in 0.2–0.9 s,
 * with `access-control-allow-origin: *`.
 *
 * ⭐ A SECOND OPERATOR ON MAINNET (2026-11-09). Until then Mysten Labs was the only one and a
 *   failure there left every wallet's older history unread. 01NODE Funding SRL (Bucharest, Romania,
 *   its own network) runs a public mainnet GraphQL at `sui.01.ro`; measured that day from this machine:
 *   the same query and the same rows as Mysten's (the treasury's oldest transaction, 2026-08-02),
 *   checkpoints back to 2023, `access-control-allow-origin: *`, 1.3 s. Triton One's `rpcpool` answered
 *   too; it is not used because its company is not one the Privacy Policy names. Testnet keeps one
 *   operator: development has no second public GraphQL and no one's activity depends on it.
 * Still the second tier and never the only one: when every service fails the answer is
 * `complete: false`, never "nothing there".
 */
export declare const SUI_GRAPHQL_URLS: Readonly<Record<"mainnet" | "testnet", readonly string[]>>;
/**
 * The deeper source over Sui's GraphQL services at `urls`, asked in order until one answers cleanly.
 *
 * ⛔ Anything but a clean answer from a service moves to the next — an error list, a missing page, a
 *    row of the wrong shape, no connection; when none answers it throws. The caller turns that into
 *    `complete: false`; it never becomes an empty history. A call the caller aborted is not retried.
 */
export declare function graphqlHistory(urls: string | readonly string[], fetchFn?: (input: string, init: RequestInit) => Promise<Response>): DeeperHistory;
