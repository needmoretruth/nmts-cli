// The wallet's activity list — one pure judgement per transaction. ⚠ PUBLISHED — copied
// byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ THE ONE RULE THIS FILE KEEPS: NO NAME OF OURS ON A TRANSACTION WE ARE NOT SURE OF. The chain
//    gives a digest, a time and balance changes — not our words "upload" or "exchange". Writing
//    "upload" on a "probably an upload" is a lie to the person, and the worst kind: they came here
//    to find out why the balance went down.
//    ▶ So a name is put only where a constant we already hold PROVES it, and the rest is "other"
//      — still shown with its time, its balance changes and its chain link. Not knowing is written
//      as not knowing, never drawn as nothing having happened.
//
// ⭐ What proves each name (every one a measured constant, none a guess):
//   · storage network — the transaction's inputs carry the Walrus SYSTEM object (an id the SDK
//     publishes per network) and a Move call's module is `system`. The function then decides:
//     `register_blob` / `certify_blob` → seal · `extend_blob` → extend · `delete_blob` → erase.
//     (Function names read verbatim from `@mysten/walrus`'s generated contract bindings, 2026-08-17.)
//   · exchange — a Move call's package is DeepBook or Bluefin, or the inputs carry the testnet
//     exchange object.
//   · donate — a transaction in which one of our donation addresses GAINED balance.
//   · send / receive — a pure transfer with no Move call; our balance down = send, up = receive.
//   · anything else → no name.
//
// ⚠ What this judgement cannot do:
//   · a transaction that does several things gets the FIRST name that matches (the order below is
//     the answer);
//   · a Walrus package upgrade keeps the system object id, so this survives one; the day the
//     system object itself changes, storage transactions quietly become "other" — a missing name,
//     never a wrong one;
//   · the list is what the CHAIN knows. Whether a storage node still holds the bytes is not
//     proved here.
//
// ⛔ NO CONSTANT IS IMPORTED. Everything the judgement compares against arrives in
//    `ActivityContext`, so the same file serves the browser (which reads its build's network) and
//    the command-line tool (which resolves the network at run time) without a fork.

/** The names we can prove. `other` means "could not name it", not "nothing happened". */
export type ActivityKind =
  | "seal"
  | "extend"
  | "erase"
  | "exchange"
  | "donate"
  | "send"
  | "receive"
  | "other";

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

// ── The shape we READ out of an RPC response, and nothing more ───────────────────────────────
// ⛔ The SDK's own types are not used here: a test building one response by hand would have to
//    fill in every field nobody reads. What is written below is the list of fields that ARE read,
//    which is also its documentation, and the SDK's response fits it structurally (no assertion).

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
  effects?: { status?: { status?: string } } | null;
  transaction?: {
    data?: {
      sender?: string;
      gasData?: { owner?: string };
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

// ── Small readers ─────────────────────────────────────────────────────────────────────────────

/** The address out of `{ AddressOwner: "0x…" }`. Other owner shapes (shared, immutable) have none → `null`. */
function ownerAddress(owner: unknown): string | null {
  if (typeof owner !== "object" || owner === null) return null;
  if (!("AddressOwner" in owner)) return null;
  const value = owner.AddressOwner;
  return typeof value === "string" ? value : null;
}

/** The RPC gives the time as a string. Unreadable ⇒ `null`, NEVER an invented number. */
function readTimestamp(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Put an address into one shape before comparing.
 *
 * ⚠ A Sui address can be written zero-padded or not (`0x2` and `0x000…02` are the same one). The
 *   RPC's form and the one in our configuration can differ, and then THE SAME ADDRESS COMPARES AS
 *   DIFFERENT — a gift would fall through to "send". So both are padded to 32 bytes first.
 */
export function normalizeAddress(raw: string): string {
  const body = raw.trim().toLowerCase().replace(/^0x/, "");
  if (body === "" || !/^[0-9a-f]+$/.test(body) || body.length > 64) return raw.trim().toLowerCase();
  return `0x${body.padStart(64, "0")}`;
}

/** Every Move call (empty for a pure transfer). */
function moveCalls(tx: RpcTransaction): RpcMoveCall[] {
  const commands = tx.transaction?.data?.transaction?.transactions ?? [];
  const calls: RpcMoveCall[] = [];
  for (const command of commands) {
    if (typeof command === "string") continue;
    if (command.MoveCall !== undefined) calls.push(command.MoveCall);
  }
  return calls;
}

/** Every object id among the inputs, zero-padded. */
function inputObjectIds(tx: RpcTransaction): Set<string> {
  const ids = new Set<string>();
  for (const input of tx.transaction?.data?.transaction?.inputs ?? []) {
    if (typeof input.objectId === "string") ids.add(normalizeAddress(input.objectId));
  }
  return ids;
}

/** The functions of the Walrus `system` module whose names we know → our kind. */
const WALRUS_FUNCTION_KIND: Readonly<Record<string, ActivityKind>> = {
  register_blob: "seal",
  certify_blob: "seal",
  extend_blob: "extend",
  delete_blob: "erase",
};

/**
 * One transaction → one row for a screen or a terminal.
 *
 * ⛔ THE ORDER OF THE JUDGEMENT IS THE ANSWER — a transaction matching several branches gets the
 *    first: ① storage network (system object + a known `system` function) ② exchange ③ donation
 *    ④ send / receive ⑤ other. Storage comes first because it is the commonest reason a balance
 *    here goes down; donation comes before send because a more specific truth beats a less
 *    specific one.
 */
export function toActivityRow(tx: RpcTransaction, ctx: ActivityContext): ActivityRow {
  const me = normalizeAddress(ctx.address);
  const digest = typeof tx.digest === "string" ? tx.digest : "";
  const sender = normalizeAddress(tx.transaction?.data?.sender ?? "");
  const gasOwnerRaw = tx.transaction?.data?.gasData?.owner;
  const gasOwner = typeof gasOwnerRaw === "string" ? normalizeAddress(gasOwnerRaw) : sender;
  const pool = ctx.poolAddress === "" ? null : normalizeAddress(ctx.poolAddress);
  const gasPayer: GasPayer =
    gasOwner === sender ? "self" : pool !== null && gasOwner === pool ? "pool" : "other";

  const changes: ActivityChange[] = [];
  let donationGain = false;
  for (const change of tx.balanceChanges ?? []) {
    const owner = ownerAddress(change.owner);
    if (owner === null) continue;
    const normalized = normalizeAddress(owner);
    const amount = BigInt(change.amount ?? "0");
    if (normalized === me) {
      const coinType = change.coinType ?? "";
      changes.push({
        coin: coinType === ctx.walCoinType ? "WAL" : coinType === "0x2::sui::SUI" ? "SUI" : null,
        coinType,
        amount,
      });
      continue;
    }
    if (amount > 0n && ctx.donationAddresses.some((a) => a !== "" && normalizeAddress(a) === normalized)) {
      donationGain = true;
    }
  }

  const calls = moveCalls(tx);
  const inputs = inputObjectIds(tx);
  const walrusSystem = normalizeAddress(ctx.walrusSystemObjectId);
  let kind: ActivityKind = "other";
  const walrusCall = inputs.has(walrusSystem)
    ? calls.find((c) => c.module === "system" && (c.function ?? "") in WALRUS_FUNCTION_KIND)
    : undefined;
  if (walrusCall !== undefined) {
    kind = WALRUS_FUNCTION_KIND[walrusCall.function ?? ""] ?? "other";
  } else if (
    calls.some(
      (c) =>
        typeof c.package === "string" &&
        ((ctx.deepbookPackageId !== null &&
          normalizeAddress(c.package) === normalizeAddress(ctx.deepbookPackageId)) ||
          (ctx.bluefinPackageId !== null &&
            normalizeAddress(c.package) === normalizeAddress(ctx.bluefinPackageId))),
    ) ||
    (ctx.exchangeObjectId !== null && inputs.has(normalizeAddress(ctx.exchangeObjectId)))
  ) {
    kind = "exchange";
  } else if (donationGain && sender === me) {
    kind = "donate";
  } else if (calls.length === 0 && changes.length > 0) {
    const net = changes.reduce((sum, c) => sum + c.amount, 0n);
    if (sender === me && net < 0n) kind = "send";
    else if (sender !== me && net > 0n) kind = "receive";
  }

  return {
    digest,
    atMs: readTimestamp(tx.timestampMs),
    failed: (tx.effects?.status?.status ?? "success") !== "success",
    gasPayer,
    kind,
    changes,
    explorerUrl: explorerTxUrl(digest, ctx.network),
  };
}

/**
 * Where a person can look the transaction up themselves.
 *
 * ⚠ A plain navigation link (not a fetch, so no `connect-src` concern). The same explorer's object
 *   links are already used elsewhere in the product, in the same shape.
 * ⭐ The URL shape was CHECKED IN A REAL BROWSER (2026-08-17): opening it shows that digest.
 *   ⛔ It cannot be checked with `curl` — the site renders in the browser, the fetched HTML is
 *   empty, and EVERY path answers 200.
 */
export function explorerTxUrl(digest: string, network: string): string {
  return `https://suiscan.xyz/${network}/tx/${digest}`;
}

/**
 * The two lists (sent, received) folded into one.
 *
 * ⛔ THE RPC FILTER HAS NO OR — `FromAddress` and `ToAddress` cannot be asked for together, so
 *    they are asked for twice and merged here. A transaction can appear on both sides, so
 *    DUPLICATES ARE REMOVED BY DIGEST.
 * ⚠ Rows with no time go LAST — treating a missing time as 0 would float "1970" to the top.
 */
export function mergeActivity(
  groups: readonly (readonly ActivityRow[])[],
  limit: number,
): ActivityRow[] {
  const byDigest = new Map<string, ActivityRow>();
  for (const group of groups) {
    for (const row of group) {
      if (row.digest !== "" && !byDigest.has(row.digest)) byDigest.set(row.digest, row);
    }
  }
  return [...byDigest.values()]
    .sort((a, b) => {
      if (a.atMs === b.atMs) return 0;
      if (a.atMs === null) return 1;
      if (b.atMs === null) return -1;
      return b.atMs - a.atMs;
    })
    .slice(0, limit);
}
