/** Which NMTS server this run talks to. */
export declare const SERVER_ENV_VAR = "NMTS_SERVER";
/** Which storage network that server uses. */
export declare const NETWORK_ENV_VAR = "NMTS_NETWORK";
/**
 * Point reads at somebody else's aggregator, or at a development stack.
 *
 * ⚠ It replaces the list rather than adding to it, and that is deliberate: a run should read from
 *   where it was told to read, not from there AND the public hosts. Comma-separated for more
 *   than one, tried in the order given.
 */
export declare const AGGREGATOR_ENV_VAR = "NMTS_AGGREGATOR";
/**
 * Push writes through somebody else's relay, or through a development stack.
 *
 * ⚠ ONE host, not a list. Unlike reads there is nothing to fail over to — see `RELAY_HOSTS`.
 */
export declare const RELAY_ENV_VAR = "NMTS_RELAY";
/** Ask a different Sui JSON-RPC node the shard-count question. */
export declare const SUI_RPC_ENV_VAR = "NMTS_SUI_RPC";
