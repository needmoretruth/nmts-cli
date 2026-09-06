/** The names we can prove. `other` means "could not name it", not "nothing happened". */
export type ActivityKind = "seal" | "extend" | "erase" | "exchange" | "donate" | "send" | "receive" | "other";
/** Who paid the network fee. `pool` means the free-trial pool did. */
export type GasPayer = "self" | "pool" | "other";
export interface ActivityChange {
    /** The coin's name when it is one we know, else `null` (the type string is kept regardless). */
    coin: "SUI" | "WAL" | null;
    coinType: string;
    /** How much THIS address's balance moved. Negative means it left. */
    amount: bigint;
}
export interface ActivityRow {
    digest: string;
    /** The chain's own timestamp (epoch ms). `null` when the RPC did not give one — never invented. */
    atMs: number | null;
    failed: boolean;
    gasPayer: GasPayer;
    kind: ActivityKind;
    /** THIS address's balance changes only. Other people's changes are not in this list. */
    changes: ActivityChange[];
    explorerUrl: string;
}
/** Everything the judgement compares against — all passed in; this file touches no screen and no network. */
export interface ActivityContext {
    /** The wallet whose list this is. */
    address: string;
    /** Where gifts go (developer, pool). Empty ⇒ nothing is ever named a donation. */
    donationAddresses: readonly string[];
    /** The free-trial pool's address. Empty ⇒ no `pool` judgement. */
    poolAddress: string;
    /** The network's WAL coin type — the one balance change we name "WAL". */
    walCoinType: string;
    /** The Walrus system object id — the input that proves a storage-network transaction. */
    walrusSystemObjectId: string;
    /** The DeepBook package on this network, or `null` when there is none. */
    deepbookPackageId: string | null;
    /** The Bluefin package on this network, or `null` when there is none (testnet). */
    bluefinPackageId: string | null;
    /** The official testnet WAL exchange object, or `null` on a network that has none (mainnet). */
    exchangeObjectId: string | null;
    /** The network name the explorer link is built for: `"mainnet"` or `"testnet"`. */
    network: string;
}
export interface RpcMoveCall {
    package?: string;
    module?: string;
    function?: string;
}
/**
 * One command of a programmable transaction.
 *
 * ⚠ THE INDEX SIGNATURE IS REQUIRED. The SDK's command type is a union of `{MoveCall}`,
 *   `{TransferObjects}`, `{SplitCoins}` … and with only `MoveCall?` here TypeScript refuses it
 *   ("no properties in common" — weak-type detection). The index signature says "any other field
 *   is fine".
 */
export interface RpcCommand {
    MoveCall?: RpcMoveCall;
    [other: string]: unknown;
}
/**
 * What can sit in a command slot — usually the shape above, but sometimes A BARE STRING (the
 * command list of an end-of-epoch transaction carries name-only entries). Our wallet transactions
 * never contain one, but the receiving type includes that branch, so it is accepted — and skipped.
 */
export type RpcCommandEntry = RpcCommand | string;
/** One transaction input. The index signature is needed for the same reason (pure-value inputs have no `objectId`). */
export interface RpcInput {
    objectId?: string;
    [other: string]: unknown;
}
export interface RpcBalanceChange {
    owner?: unknown;
    coinType?: string;
    amount?: string;
}
export interface RpcTransaction {
    digest?: string;
    timestampMs?: string | number | null;
    balanceChanges?: readonly RpcBalanceChange[] | null;
    effects?: {
        status?: {
            status?: string;
        };
    } | null;
    transaction?: {
        data?: {
            sender?: string;
            gasData?: {
                owner?: string;
            };
            transaction?: {
                /** `ProgrammableTransaction` and the like. Not read, but it MUST be declared — for the same
                 *  reason as the index signatures: without it other kinds (`ChangeEpoch`) fail the type check. */
                kind?: string;
                inputs?: readonly RpcInput[];
                transactions?: readonly RpcCommandEntry[];
            };
        };
    } | null;
}
/**
 * Put an address into one shape before comparing.
 *
 * ⚠ A Sui address can be written zero-padded or not (`0x2` and `0x000…02` are the same one). The
 *   RPC's form and the one in our configuration can differ, and then THE SAME ADDRESS COMPARES AS
 *   DIFFERENT — a gift would fall through to "send". So both are padded to 32 bytes first.
 */
export declare function normalizeAddress(raw: string): string;
/**
 * One transaction → one row for a screen or a terminal.
 *
 * ⛔ THE ORDER OF THE JUDGEMENT IS THE ANSWER — a transaction matching several branches gets the
 *    first: ① storage network (system object + a known `system` function) ② exchange ③ donation
 *    ④ send / receive ⑤ other. Storage comes first because it is the commonest reason a balance
 *    here goes down; donation comes before send because a more specific truth beats a less
 *    specific one.
 */
export declare function toActivityRow(tx: RpcTransaction, ctx: ActivityContext): ActivityRow;
/**
 * Where a person can look the transaction up themselves.
 *
 * ⚠ A plain navigation link (not a fetch, so no `connect-src` concern). The same explorer's object
 *   links are already used elsewhere in the product, in the same shape.
 * ⭐ The URL shape was CHECKED IN A REAL BROWSER (2026-08-17): opening it shows that digest.
 *   ⛔ It cannot be checked with `curl` — the site renders in the browser, the fetched HTML is
 *   empty, and EVERY path answers 200.
 */
export declare function explorerTxUrl(digest: string, network: string): string;
/**
 * The two lists (sent, received) folded into one.
 *
 * ⛔ THE RPC FILTER HAS NO OR — `FromAddress` and `ToAddress` cannot be asked for together, so
 *    they are asked for twice and merged here. A transaction can appear on both sides, so
 *    DUPLICATES ARE REMOVED BY DIGEST.
 * ⚠ Rows with no time go LAST — treating a missing time as 0 would float "1970" to the top.
 */
export declare function mergeActivity(groups: readonly (readonly ActivityRow[])[], limit: number): ActivityRow[];
