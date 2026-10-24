// The three chain questions asked in more than one place, in the core API's words — "what would these
// calls return" (a devInspect), "what would this transaction cost" (a dry run), and "what are this
// object's fields". One implementation each, over any client that speaks the core API (gRPC or
// GraphQL), so every caller reads the answer the same way. ⚠ PUBLISHED — copied byte-for-byte into
// the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ WHY THIS FILE EXISTS (2026-10-21). Sui retired JSON-RPC, and with it `devInspectTransactionBlock`
//    and `dryRunTransactionBlock`. Their replacement is ONE call, `simulateTransaction`, whose answer
//    has a different shape (results under `commandResults`, BCS bytes without a type tag, status as
//    `{ success, error }`). Writing that translation at each call site — seven in the browser, more
//    in the command-line tool — would have made that many slightly different readings of one answer.
//
// ⚠ WHAT THE NEW ANSWER NO LONGER CARRIES. A JSON-RPC return value came with its Move type name
//   (`[bytes, "u64"]`) and callers checked it. A simulation's return value is bytes only, so the checks
//   that remain are the byte LENGTH and the command/value position — a u64 is exactly eight bytes.
import type { ClientWithCoreApi, SuiClientTypes } from "@mysten/sui/client";
import type { Transaction } from "@mysten/sui/transactions";

/** What a devInspect gave: one list of BCS return values per command, or the chain's refusal. */
export interface Inspection {
  /** The chain's own words when the calls aborted; `null` when they ran. */
  error: string | null;
  results: { returnValues: Uint8Array[] }[];
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
export async function inspect(
  client: ClientWithCoreApi,
  transaction: Transaction,
  sender: string,
): Promise<Inspection> {
  transaction.setSenderIfNotSet(sender);
  const res = await client.core.simulateTransaction({
    transaction,
    checksEnabled: false,
    include: { commandResults: true },
  });
  if (res.$kind === "FailedTransaction") {
    return { error: res.FailedTransaction.status.error?.message ?? "the calls did not run", results: [] };
  }
  return {
    error: null,
    results: (res.commandResults ?? []).map((r) => ({ returnValues: r.returnValues.map((v) => v.bcs) })),
  };
}

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
export async function dryRun(client: ClientWithCoreApi, bytes: Uint8Array): Promise<DryRun> {
  const res = await client.core.simulateTransaction({ transaction: bytes, include: { effects: true } });
  const tx = res.Transaction ?? res.FailedTransaction;
  const effects = tx?.effects;
  if (tx === undefined || effects === undefined || effects === null) {
    throw new Error("The dry run came back without effects.");
  }
  return { status: tx.status, gasUsed: effects.gasUsed };
}

/** A u64 return value: exactly eight little-endian bytes, or a refusal to guess. */
export function u64FromLe(bytes: Uint8Array | undefined): bigint {
  if (bytes === undefined || bytes.length !== 8) {
    throw new Error("The chain answered a number in an unexpected shape.");
  }
  return bytes.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}

/**
 * An object's Move fields as JSON, or `null` when the node rendered none. An object that does not
 * exist (deleted, wrapped, or on another network) THROWS — the core API's `getObject` refuses rather
 * than answering empty, and a caller that must tell "gone" from "unreadable" catches it.
 *
 * ⚠ The JSON form is the node's rendering of the struct; the SDK warns that its exact field shapes
 * may differ between transports. Callers here read top-level primitive fields (a package id, a
 * number) only, which every transport renders the same way.
 */
export async function objectFields(
  client: ClientWithCoreApi,
  objectId: string,
): Promise<Record<string, unknown> | null> {
  const { object } = await client.core.getObject({ objectId, include: { json: true } });
  return object.json ?? null;
}
