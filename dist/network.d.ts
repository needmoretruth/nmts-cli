export declare const NETWORKS: readonly ["mainnet", "testnet"];
export type Network = (typeof NETWORKS)[number];
export declare const NETWORK_ENV_VAR = "NMTS_NETWORK";
/**
 * Decide the network for this run.
 *
 * `explicit` beats the environment, which beats the one inference this function is willing to
 * make: the live server is mainnet. Anything else and it refuses.
 */
export declare function resolveNetwork(server: string, explicit?: string | undefined): Network;
