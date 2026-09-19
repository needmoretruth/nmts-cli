// The names of the environment variables this tool reads.
//
// ⛔ NAMES ONLY, AND NO IMPORTS. `nmts --help` prints several of these, and a help text that had to
//    load the module that USES a variable would drag that module's whole chain into every run —
//    `check:cli-startup` measures exactly that, and it is the leak it has caught most often. The
//    modules that read the variables re-export their own name from here, so every caller still
//    finds it where it belongs and there is still only one spelling of each.
/** Which NMTS server this run talks to. */
export const SERVER_ENV_VAR = "NMTS_SERVER";
/** Which storage network that server uses. */
export const NETWORK_ENV_VAR = "NMTS_NETWORK";
/**
 * Point reads at somebody else's aggregator, or at a development stack.
 *
 * ⚠ It replaces the list rather than adding to it, and that is deliberate: a run should read from
 *   where it was told to read, not from there AND the public hosts. Comma-separated for more
 *   than one, tried in the order given.
 */
export const AGGREGATOR_ENV_VAR = "NMTS_AGGREGATOR";
/**
 * Push writes through somebody else's relay, or through a development stack.
 *
 * ⚠ ONE host, not a list. Unlike reads there is nothing to fail over to — see `RELAY_HOSTS`.
 */
export const RELAY_ENV_VAR = "NMTS_RELAY";
/** Ask a different Sui JSON-RPC node the shard-count question. */
export const SUI_RPC_ENV_VAR = "NMTS_SUI_RPC";
