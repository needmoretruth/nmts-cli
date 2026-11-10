// A business keeping a user's files alive from its own wallet, with no key of the user's anywhere in
// the process: the user's delegation token says which files and records the new dates, the
// business's wallet holds the storage and pays.
//
// ⛔ WHO PAYS CHOSE TO PAY. This is the business spending its own WAL on storage its own wallet holds
//    — the storage a sponsored upload left in that wallet. It is not a person's money moving on its
//    own: a person's wallet is never the payer here, and nothing here can make it one. A person's
//    own storage is extended only when that person approves it, every time.
//
// ⛔ ONLY STORAGE THE PAYING WALLET HOLDS. A blob held by any other address is named and skipped
//    before anything is signed (`refuseUnheld`). The chain would refuse it anyway, but only after a
//    signature had been asked for, and the user's own storage is the user's to extend.
//
// ⛔ NO NMTS KEY. Everything the walk needs is on the NMTS server under the user's credential —
//    `/v1/objects` for which rows exist, `/extend-preview` for which blobs — and on the chain. File
//    names are inside the sealed list, which only the key opens, so a file is named here by its id.
//
// ⛔ ONE FILE, ONE TRANSACTION. The server records an extension against one item per transaction
//    digest (its replay guard), so each file is bought and recorded on its own.
//
// ⚠ A FILE IT CANNOT EXTEND IS A ROW, NOT A FAILURE OF THE RUN. A daily job over a hundred users must
//   not stop at the first file whose storage another wallet holds. What does stop the run is what
//   would make the next spend wrong too: a wallet known to be short, a server that stopped writing
//   dates down, a credential the server no longer takes.

import { ServerError } from "../api.ts";
import { NmtsError } from "../errors.ts";
import { readWindowOrRefuse, type ExtendReads } from "../extend-plan.ts";
import { readDelegation, SCOPE_BITS } from "../platform-sign.ts";
import { serverObjects } from "../server-objects.ts";
import type { StorageHints } from "./hints.ts";
import { defaultReads, planItemExtension, recordExtension, type ItemExtendPlan } from "./extend.ts";

/** Where to talk and with what. ⛔ No NMTS key: the user's is not here and none is needed. */
export interface ExtendForInput {
  server: string;
  network: string;
  /** The user's delegation token. It must carry `files_read` and `storage_spend`. */
  token: string;
  /** The address that holds the storage and pays. Every blob must be held by it. */
  payer: string;
}

/** What to extend and how. */
export interface ExtendForAsk {
  /** Item ids. Absent = every file the user's account holds that is not in the trash. */
  items?: readonly string[] | undefined;
  /** Epochs to add to each file. Default `DEFAULT_EXTEND_EPOCHS`. */
  epochs?: string | number | undefined;
  /** Extend files that are not near their end yet too. Without it they are skipped as not due. */
  force?: boolean | undefined;
  /** Price every file and sign nothing. */
  dryRun?: boolean | undefined;
}

/** The chain and the signature. ⚠ Seams, not options. */
export interface ExtendForSeams {
  readChain?: ((network: string) => Promise<ExtendReads> | ExtendReads) | undefined;
  /** Signs one file's extension from the paying wallet and answers the transaction digest. */
  sign?: ((input: { objectIds: readonly string[]; epochs: number }) => Promise<string>) | undefined;
  /** Told the instant a file's signature exists, before the server is asked to write it down. */
  onSigned?: ((itemId: string, digest: string) => void) | undefined;
  now: number;
  hints?: StorageHints | undefined;
}

/** What happened to one file. */
export interface ExtendForFile {
  itemId: string;
  /** `extended` = signed and paid; `priced` = a dry run's price; `skipped` = nothing signed. */
  outcome: "extended" | "priced" | "skipped";
  /** Why it was skipped, as a code a program can match (`EXTEND_NOT_DUE`, `EXTEND_NOT_OWNED`, …). */
  code: string | null;
  /** Why, in words. Null when nothing needs saying. */
  reason: string | null;
  epochs: number | null;
  /** The blobs' sizes added up — what a ledger that sells size × time charges by. */
  bytes: number | null;
  /** The chain's end of the soonest blob before, and after this extension. */
  endEpoch: number | null;
  newEndEpoch: number | null;
  /** Price in FROST and the fee measured in MIST, as strings. */
  wal: string | null;
  sui: string | null;
  digest: string | null;
}

/** The whole run. */
export interface ExtendForResult {
  dryRun: boolean;
  /**
   * The paying wallet as the first plan read it, in FROST and MIST as decimal strings — the units of
   * every amount here. ⛔ NULL IS NOT ZERO: the chain would not say, or no file was priced.
   */
  wallet: { address: string; wal: string | null; sui: string | null };
  files: ExtendForFile[];
  /** What the extended (or, on a dry run, priced) files cost together, in FROST and MIST. */
  wal: string;
  sui: string;
  /** Why the run stopped before the end, or null when it reached every file. */
  stopped: { code: string; reason: string } | null;
}

/**
 * Extend a user's files from the paying wallet. Files not due, held by another wallet, already at the
 * network's ceiling or past their end are skipped and said so; the rest are bought one by one.
 *
 * ⛔ THIS SIGNS unless `dryRun` is set, and nothing it buys comes back.
 */
export async function extendFor(
  input: ExtendForInput,
  ask: ExtendForAsk,
  seams: ExtendForSeams,
): Promise<ExtendForResult> {
  refuseWithoutScopes(input.token);
  const where = { server: input.server, apiKey: input.token, network: input.network };
  const targets = await targetsOf(input, ask.items);
  const reads = await (seams.readChain ?? defaultReads)(input.network);
  const window = await readWindowOrRefuse(reads, input.network);
  const dryRun = ask.dryRun === true;
  const result: ExtendForResult = {
    dryRun,
    wallet: { address: input.payer, wal: null, sui: null },
    files: [],
    wal: "0",
    sui: "0",
    stopped: null,
  };
  let wal = 0n;
  let sui = 0n;
  let walletRead = false;

  for (const target of targets) {
    if (target.skip !== null) {
      result.files.push(skipped(target.id, target.skip.code, target.skip.reason));
      continue;
    }
    let plan: ItemExtendPlan;
    try {
      plan = await planItemExtension(where, { id: target.id, label: target.id }, {
        reads,
        window,
        address: input.payer,
        epochs: ask.epochs,
        now: seams.now,
        hints: seams.hints,
      });
    } catch (error) {
      if (stopsTheRun(error)) {
        result.stopped = { code: "CREDENTIAL_REFUSED", reason: message(error) };
        break;
      }
      if (!(error instanceof NmtsError)) throw error;
      result.files.push(skipped(target.id, codeOf(error), message(error)));
      continue;
    }
    const budget = plan.budget;
    if (!walletRead) {
      result.wallet = { address: input.payer, wal: amountOrNull(budget.walFrost), sui: amountOrNull(budget.suiMist) };
      walletRead = true;
    }
    const priced = {
      epochs: plan.epochs,
      bytes: plan.bytes,
      endEpoch: plan.facts.endEpoch,
      newEndEpoch: plan.facts.newEndEpoch,
      wal: budget.priceFrost.toString(),
      sui: budget.feeMist === null ? null : budget.feeMist.toString(),
    };
    // ⛔ A FILE THAT IS NOT RUNNING OUT IS NOT EXTENDED BY A SCHEDULE, and a dry run says what the
    //    real run would spend — so it skips the same files.
    if (plan.stage === "later" && ask.force !== true) {
      result.files.push({
        ...skipped(target.id, "EXTEND_NOT_DUE", "It is not near the end of its storage term."),
        epochs: null,
        endEpoch: plan.facts.endEpoch,
      });
      continue;
    }
    if (dryRun) {
      result.files.push({ itemId: target.id, outcome: "priced", code: null, reason: null, digest: null, ...priced });
      wal += budget.priceFrost;
      sui += budget.feeMist ?? 0n;
      continue;
    }
    // ⛔ A WALLET KNOWN TO BE SHORT STOPS THE RUN BEFORE THE NEXT SIGNATURE, with both numbers.
    if (budget.shortfall !== null) {
      result.stopped = { code: "EXTEND_SHORTFALL", reason: `${budget.shortfall} Send what is missing to ${budget.address}.` };
      break;
    }
    const sign = seams.sign ?? refuseUnsigned;
    const digest = await sign({ objectIds: plan.objectIds, epochs: plan.epochs });
    seams.onSigned?.(target.id, digest);
    wal += budget.priceFrost;
    sui += budget.feeMist ?? 0n;
    const outcome = await recordExtension(where, plan, digest);
    result.files.push({ itemId: target.id, outcome: "extended", code: null, reason: null, digest, ...priced });
    if (!outcome.recorded) {
      // ⛔ THE STORAGE IS EXTENDED AND PAID FOR. Going on would pay for more files whose dates the
      //    server would not write down either.
      result.stopped = {
        code: "EXTEND_RECORDED_LATE",
        reason:
          `The storage of ${target.id} IS extended and paid for (transaction ${digest}), and the NMTS ` +
          `server was not told, so the account goes on showing the old date. Do not extend it again. ` +
          `Cause: ${outcome.notRecorded ?? "unknown"}`,
      };
      break;
    }
  }
  result.wal = wal.toString();
  result.sui = sui.toString();
  return result;
}

/** One file to visit, or a file already known to be skipped. */
interface Target {
  id: string;
  skip: { code: string; reason: string } | null;
}

/** The files to visit: the ones named, or every row the user's account holds. */
async function targetsOf(input: ExtendForInput, named: readonly string[] | undefined): Promise<Target[]> {
  if (named !== undefined) {
    if (named.length === 0) {
      throw new NmtsError("No file was named to extend.", {
        exitCode: 2,
        nextStep: "Nothing was signed and nothing was charged. Name item ids, or leave them out to take every file.",
      });
    }
    return [...new Set(named)].map((id) => ({ id, skip: null }));
  }
  const listing = await serverObjects(input.server, input.token);
  if (!listing.complete) {
    throw new NmtsError("This account has more stored files than one run will read.", {
      exitCode: 4,
      nextStep: "Nothing was signed and nothing was charged. Name the item ids to extend instead.",
    });
  }
  return listing.rows.map((row) => ({
    id: row.id,
    // ⚠ A file in the trash is on its way out. Paying to keep it is a choice somebody makes by
    //   naming it, never a schedule's default.
    skip: row.trashed ? { code: "EXTEND_TRASHED", reason: "It is in the trash." } : null,
  }));
}

/**
 * Refuse a token that could not see the files or could not record the new dates — before the first
 * read, not after the first payment.
 */
function refuseWithoutScopes(token: string): void {
  const read = readDelegation(token);
  if (read === null) return;
  const missing = (["files_read", "storage_spend"] as const).filter((name) => (read.scope & SCOPE_BITS[name]) === 0);
  if (missing.length === 0) return;
  throw new NmtsError(
    `DELEGATION_SCOPE: the user's delegation token was minted without ${missing.map((m) => `\`${m}\``).join(" and ")}.`,
    {
      exitCode: 3,
      nextStep:
        "Nothing was signed and nothing was charged. Mint the user a token that carries `files_read` " +
        "and `storage_spend`: the first lists the files, the second records the new dates.",
    },
  );
}

/** No signer was supplied. A defect in the caller, refused before anything is spent. */
async function refuseUnsigned(): Promise<string> {
  throw new NmtsError("No signer was supplied for the paying wallet.", {
    exitCode: 1,
    nextStep: "Nothing was signed. This is a defect in the caller of `extendFor`.",
  });
}

/** A credential the server refused for one file is refused for the rest. */
function stopsTheRun(error: unknown): boolean {
  return error instanceof ServerError && (error.status === 401 || error.status === 403);
}

function skipped(itemId: string, code: string, reason: string): ExtendForFile {
  return { itemId, outcome: "skipped", code, reason, epochs: null, bytes: null, endEpoch: null, newEndEpoch: null, wal: null, sui: null, digest: null };
}

/** The leading `CODE:` of a refusal, or a neutral code for one that carries none. */
function codeOf(error: NmtsError): string {
  const match = /^([A-Z][A-Z_]{3,}):/.exec(error.message);
  return match?.[1] ?? "EXTEND_SKIPPED";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function amountOrNull(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}
