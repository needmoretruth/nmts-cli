import { JsonRpcHTTPTransport } from "@mysten/sui/jsonRpc";
/**
 * A Sui transport that asks the network's hosts in order.
 *
 * ⭐ 2026-09-01. There used to be one host per network, and on that morning
 * the testnet one was measured dead — `rpc-testnet.suiscan.xyz` completes the TCP handshake in
 * 31 ms and then sends nothing for twelve seconds, three times running. It had been that way for
 * eleven days, so every command that needed the shard count on testnet had simply stopped.
 *
 * ⚠ One transport per client on purpose: the host that answered becomes the one asked first, and
 *   sharing that state across clients would let one command's bad luck redirect every other. The
 *   flip side is that a recovered first host is not noticed until the process restarts — that is
 *   the price of not probing a node nobody asked us to talk to.
 */
export declare function suiRpcTransport(network: string): JsonRpcHTTPTransport;
