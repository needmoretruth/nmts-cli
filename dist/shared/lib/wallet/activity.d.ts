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
export interface ChainMoveCall {
    package?: string | undefined;
    module?: string | undefined;
    function?: string | undefined;
}
/**
 * One command of a programmable transaction.
 *
 * ⚠ THE INDEX SIGNATURE IS REQUIRED. The SDK's command type is a union of `{MoveCall}`,
 *   `{TransferObjects}`, `{SplitCoins}` … and with only `MoveCall?` here TypeScript refuses it
 *   ("no properties in common" — weak-type detection). The index signature says "any other field
 *   is fine".
 */
export interface ChainCommand {
    MoveCall?: ChainMoveCall | null | undefined;
    [other: string]: unknown;
}
/**
 * One transaction input — `{ Object: { SharedObject | ImmOrOwnedObject | Receiving: { objectId } } }`,
 * `{ UnresolvedObject: { objectId } }`, or a pure value that carries no object. Read with checks
 * rather than declared, for the same weak-type reason.
 */
export type ChainInput = Readonly<Record<string, unknown>>;
export interface ChainBalanceChange {
    address?: string | undefined;
    coinType?: string | undefined;
    amount?: string | undefined;
}
export interface ChainTransaction {
    digest?: string | undefined;
    timestampMs?: string | number | null | undefined;
    status?: {
        success?: boolean | undefined;
    } | null | undefined;
    balanceChanges?: readonly ChainBalanceChange[] | null | undefined;
    transaction?: {
        sender?: string | null | undefined;
        gasData?: {
            owner?: string | null | undefined;
        } | undefined;
        inputs?: readonly ChainInput[] | undefined;
        commands?: readonly ChainCommand[] | undefined;
    } | null | undefined;
}
/**
 * Put an address into one shape before comparing.
 *
 * ⚠ A Sui address can be written zero-padded or not (`0x2` and `0x000…02` are the same one). The
 *   chain's form and the one in our configuration can differ, and then THE SAME ADDRESS COMPARES AS
 *   DIFFERENT — a gift would fall through to "send". So both are padded to 32 bytes first.
 */
export declare function normalizeAddress(raw: string): string;
/**
 * A coin type with its package address padded — `0x2::sui::SUI` and `0x000…02::sui::SUI` are one type.
 *
 * ⛔ The gRPC and GraphQL nodes write the long form, where JSON-RPC wrote the short one for SUI; a
 *    comparison against the short form alone would stop naming SUI anywhere in the list.
 */
export declare function normalizeCoinType(raw: string): string;
/**
 * One transaction → one row for a screen or a terminal.
 *
 * ⛔ THE ORDER OF THE JUDGEMENT IS THE ANSWER — a transaction matching several branches gets the
 *    first: ① storage network (system object + a known `system` function) ② exchange ③ donation
 *    ④ send / receive ⑤ other. Storage comes first because it is the commonest reason a balance
 *    here goes down; donation comes before send because a more specific truth beats a less
 *    specific one.
 */
export declare function toActivityRow(tx: ChainTransaction, ctx: ActivityContext): ActivityRow;
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
 * Lists of rows folded into one — newest first, each digest once, at most `limit`.
 *
 * ⭐ Since 2026-10-21 the chain is asked ONE question per page ("every transaction that moved this
 *    address's state" — the gRPC `affectedAddress` filter), where the retired JSON-RPC could only ask
 *    "sent" and "received" separately and this function merged the two. It still takes several lists,
 *    because a caller may page, and DUPLICATES ARE STILL REMOVED BY DIGEST.
 * ⚠ Rows with no time go LAST — treating a missing time as 0 would float "1970" to the top.
 */
export declare function mergeActivity(groups: readonly (readonly ActivityRow[])[], limit: number): ActivityRow[];
