// `nmts wallet storage extend [<item-id>...] --delegation-file <file>` — a business extending a
// user's files from ITS OWN wallet, with the user's delegation token and no key of the user's.
//
// ⛔ IT SIGNS AND SPENDS WAL. The order, the skips and the per-file transactions are
//    `storage-control/extend-for.ts`, which the SDK's `extendFor` calls as well; this file is the
//    terminal over it: the review a person reads, `--yes`, and the wallet unlock held against the
//    total the review measured.
//
// ⛔ WHOSE MONEY. The key this tool is signed in with is the BUSINESS's; its wallet holds the storage
//    a sponsored upload left there and pays. The user is a token in a file, which lists the user's
//    files and records each new date. A blob the business's wallet does not hold is skipped, named.
//
// ⚠ A TOKEN IS A FILE, NEVER AN OPTION'S VALUE: a command line is readable by every process on the
//   machine and recorded by the shell (`args.ts`).

import { readFileSync } from "node:fs";

import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import type { ExtendReads, SignExtension } from "../extend-plan.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveServer } from "../server.ts";
import { extendFor, type ExtendForResult } from "../storage-control.ts";
import { explorerTxUrl } from "../shared/lib/wallet/activity.ts";
import { coinAmount, walletAddress } from "../wallet.ts";
import { payingWalletIndex } from "../wallet-pay-index.ts";
import { recordWalletSpend, requireWalletGrant, type Spend } from "../wallet-grant.ts";

export interface StorageExtendOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  yes?: boolean;
  dryRun?: boolean;
  /** `--force`: extend files that are not near their end yet too. */
  force?: boolean;
  /** `--delegation-file <file>`: the user's delegation token, read from that file. */
  delegationFile?: string | undefined;
  /** `--epochs <n>`: added to each file. Default 2. */
  epochs?: string | undefined;
  /** `--wallet N`: which of this key's wallets pays, this run only. */
  wallet?: string | undefined;
  now?: number;
  /** ⚠ SEAMS, NOT OPTIONS — no flag reaches them. */
  readActiveWallet?: () => Promise<number>;
  readChain?: ((network: string) => Promise<ExtendReads> | ExtendReads) | undefined;
  sign?: SignExtension | undefined;
}

const USAGE = `\`${BINARY_NAME} wallet storage extend [<item-id>...] --delegation-file <file> [--epochs <n>] [--force] [--dry-run] [--yes]\``;

export async function walletStorageExtend(items: readonly string[], options: StorageExtendOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const token = readToken(options.delegationFile);
  const resolved = await requireAccountCode();
  const wallet = await payingWalletIndex(options);
  const address = await walletAddress(resolved.code, wallet);
  const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);
  const now = options.now ?? Date.now();
  const sign = options.sign ?? (await import("../wallet-sign.ts")).signExtension;
  const run = (dryRun: boolean): Promise<ExtendForResult> =>
    extendFor(
      { server, network, token, payer: address },
      { items: items.length === 0 ? undefined : items, epochs: options.epochs, force: options.force === true, dryRun },
      {
        readChain: options.readChain,
        now,
        sign: ({ objectIds, epochs }) => sign({ network, code: resolved.code, wallet, objectIds, epochs }),
      },
    );

  // ⛔ THE REVIEW FIRST, ALWAYS: what would be bought, what is left and why, before any signature.
  const review = await run(true);
  const due = review.files.filter((f) => f.outcome === "priced").length;
  if (!options.json) describe(say, review, wallet);
  if (due === 0 || options.dryRun === true || options.yes !== true) {
    if (options.json) {
      say(JSON.stringify({ network, signed: false, ...review }));
      return due === 0 || options.dryRun === true ? 0 : 4;
    }
    say(``);
    if (due === 0) {
      say(`  Nothing to extend. Nothing was signed.`);
      return 0;
    }
    if (options.dryRun === true) {
      say(`  Nothing was signed. Run the same command with --yes to extend them.`);
      return 0;
    }
    throw new NmtsError(`Nothing was signed: this needs --yes.`, {
      exitCode: 4,
      nextStep: `Read the review above, then run the same command with --yes.`,
    });
  }

  // The unlock, held against the total the review measured. ⛔ Throwing here signs nothing.
  requireWalletGrant("extend", spendOf(review), new Date(now));
  const done = await run(false);
  recordWalletSpend(spendOf(done));
  if (options.json) {
    say(JSON.stringify({ network, signed: true, ...done }));
  } else {
    say(``);
    for (const file of done.files) {
      if (file.outcome !== "extended" || file.digest === null) continue;
      say(`  Extended ${file.itemId} to epoch ${String(file.newEndEpoch)}. ${explorerTxUrl(file.digest, network)}`);
    }
  }
  if (done.stopped === null) return 0;
  throw new NmtsError(`${done.stopped.code}: ${done.stopped.reason}`, {
    exitCode: done.stopped.code === "EXTEND_RECORDED_LATE" ? 1 : 4,
    nextStep:
      done.stopped.code === "EXTEND_RECORDED_LATE"
        ? "Do not run this again for that file: it would pay for the same time twice."
        : "The files above it were extended. The rest were not. Run it again once that is fixed.",
  });
}

/** The user's token out of its file, refusing a missing or empty one before anything is read. */
function readToken(file: string | undefined): string {
  if (file === undefined || file === "") {
    throw new NmtsError(`Name the file that holds the user's delegation token.`, { exitCode: 2, nextStep: USAGE });
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    // ⚠ The reason is the system's, about a path; never the file's content.
    throw new NmtsError(`The delegation token file could not be read: ${file}.`, {
      exitCode: 2,
      nextStep: `${error instanceof Error && "code" in error ? String(error.code) : "unreadable"}. Nothing was signed.`,
    });
  }
  const token = text.trim();
  if (token === "") throw new NmtsError(`The delegation token file is empty: ${file}.`, { exitCode: 2, nextStep: USAGE });
  return token;
}

/** What a run costs this wallet: the WAL of every file bought and the fees measured for them. */
function spendOf(result: ExtendForResult): Spend {
  return { walFrost: BigInt(result.wal), suiMist: BigInt(result.sui) };
}

/** The review a person reads: each file and what happens to it, then the total and the wallet. */
function describe(say: (line: string) => void, review: ExtendForResult, wallet: number): void {
  const priced = review.files.filter((f) => f.outcome === "priced");
  say(`Would extend ${priced.length} of ${review.files.length} file${review.files.length === 1 ? "" : "s"} from ${review.wallet.address} (wallet ${wallet}).`);
  for (const file of review.files) {
    if (file.outcome === "priced") {
      say(`  ${file.itemId}  epoch ${String(file.endEpoch)} to ${String(file.newEndEpoch)}  ${coinAmount(BigInt(file.wal ?? "0"))} WAL`);
    } else {
      say(`  ${file.itemId}  left as it is: ${file.reason ?? file.code ?? "skipped"}`);
    }
  }
  if (priced.length === 0) return;
  say(`  Storage ${coinAmount(BigInt(review.wal))} WAL in all, one transaction per file.`);
  say(`  Chain fees about ${coinAmount(BigInt(review.sui))} SUI, measured by dry runs just now.`);
  const wal = review.wallet.wal === null ? "WAL not read" : `${coinAmount(BigInt(review.wallet.wal))} WAL`;
  const sui = review.wallet.sui === null ? "SUI not read" : `${coinAmount(BigInt(review.wallet.sui))} SUI`;
  say(`  The wallet holds ${wal} and ${sui}.`);
  say(`  Nobody, NMTS included, can reverse it.`);
}
