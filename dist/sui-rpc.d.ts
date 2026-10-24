import { SuiGrpcClient } from "@mysten/sui/grpc";
import { type DeeperHistory } from "./shared/lib/wallet/address-history.ts";
/**
 * A Sui client for `network` that asks the network's hosts in order.
 *
 * ⚠ One failover per client on purpose: the host that answered becomes the one asked first, and
 *   sharing that state across clients would let one command's bad luck redirect every other. The
 *   flip side is that a recovered first host is not noticed until the process restarts — that is
 *   the price of not probing a node nobody asked us to talk to.
 *
 * `format: "binary"` — protobuf bytes as they are; every host in the tables answers binary
 * (measured 2026-10-21), and the default text form base64s every message.
 */
export declare function suiClient(network: "testnet" | "mainnet"): SuiGrpcClient;
/**
 * Where a wallet's history OLDER than a gRPC node's few-week window is read — Sui's GraphQL service
 * (`shared/lib/wallet/address-history.ts` holds why and the measurements) — or `null` when this run
 * named its own Sui node: somebody who names a node is saying *that one*, and quietly asking a public
 * service as well would send their addresses somewhere they did not choose. The history answer then
 * says it is partial instead.
 */
export declare function deeperHistory(network: "testnet" | "mainnet"): DeeperHistory | null;
