import type { ClientWithCoreApi, SuiClientTypes } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";
/** What a devInspect gave: one list of BCS return values per command, or the chain's refusal. */
export interface Inspection {
    /** The chain's own words when the calls aborted; `null` when they ran. */
    error: string | null;
    results: {
        returnValues: Uint8Array[];
    }[];
}
/**
 * Run `transaction` without signing, checks off, and return what each command returned.
 *
 * `sender` is set only when the transaction has none — a devInspect needs one, and nothing is spent:
 * with checks off and no gas payment the node simulates with a mocked gas coin.
 *
 * ⛔ A refusal the node REPORTS (the Move call aborted) comes back as `error`; a request the node
 * could not run at all (no such object, malformed call) throws, as the old call's RPC errors did.
 */
export declare function inspect(client: ClientWithCoreApi, transaction: Transaction, sender: string): Promise<Inspection>;
/** What a dry run of built bytes says: whether it would succeed, and what it would burn in gas. */
export interface DryRun {
    status: SuiClientTypes.ExecutionStatus;
    gasUsed: SuiClientTypes.GasCostSummary;
}
/**
 * Simulate built transaction bytes exactly as they would be submitted (checks on, gas as built).
 *
 * Nothing is signed, nothing is broadcast. Throws when the node returns no effects, because a dry run
 * without a gas figure is not an answer any caller can use.
 */
export declare function dryRun(client: ClientWithCoreApi, bytes: Uint8Array): Promise<DryRun>;
/** A u64 return value: exactly eight little-endian bytes, or a refusal to guess. */
export declare function u64FromLe(bytes: Uint8Array | undefined): bigint;
/**
 * An object's Move fields as JSON, or `null` when the node rendered none. An object that does not
 * exist (deleted, wrapped, or on another network) THROWS — the core API's `getObject` refuses rather
 * than answering empty, and a caller that must tell "gone" from "unreadable" catches it.
 *
 * ⚠ The JSON form is the node's rendering of the struct; the SDK warns that its exact field shapes
 * may differ between transports. Callers here read top-level primitive fields (a package id, a
 * number) only, which every transport renders the same way.
 */
export declare function objectFields(client: ClientWithCoreApi, objectId: string): Promise<Record<string, unknown> | null>;
