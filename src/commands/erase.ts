// `nmts erase <paths>` — erase files for good: the server's record, and this account's key to
// them in the sealed file list. ⛔ IRREVERSIBLE, and the one act above high besides erasing the
// account.
//
// ⛔ TWO THINGS ARE DESTROYED AND THIS COMMAND ALWAYS DESTROYS THE FIRST. The server row carries
//    the wrapped key that opens the bytes; the list entry carries this account's own copy. Both
//    go here. The BYTES on the storage network are a third thing: bought by the wallet, they stay
//    until their term runs out (burning them is a signed transaction the browser makes); bought
//    with credits, `--release-storage` asks the server to destroy the treasury's storage under
//    each file first, which it does on the chain one blob at a time and reports per file.
//
// ⛔ THE SERVER GOES FIRST, THE LIST LAST. A row erased before the list entry leaves a file the
//    person can see and never open; that is the same order the trash keeps, for the same reason.
//    A release that fails leaves the file whole — nothing is erased behind a failed release.
//
// ⛔ THE SENTENCE IS TYPED IN EVERY MODE BUT SKIP-PERMISSIONS, where the tier gate's `--reason`
//    and `--yes` stand for it — the same rule as `delete-account`, because it is the same tier.

import { accountProofFor } from "../account-proof.ts";
import { request, ServerError } from "../api.ts";
import { currentMode } from "../autonomy.ts";
import { CONFIRM_SENTENCE } from "./delete-account.ts";
import { buildIndex, fullPathOf, KIND_FILE } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { readFileList } from "../manifest.ts";
import { applyToList, batchTargets } from "../manifest-write.ts";
import { BINARY_NAME } from "../product.ts";
import { promptLine, stdinIsATerminal } from "../prompt.ts";
import { openSession } from "../session.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { filesUnder } from "./trash.ts";

/** The server takes at most this many ids in one erase (`ERASE_BATCH_MAX`). */
const BATCH = 200;

export interface EraseOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  /** Also destroy the treasury's storage under credit-paid files, before erasing them. */
  releaseStorage?: boolean;
  /** Under skip-permissions only: the tier gate's answer, given with a `--reason`. */
  yes?: boolean;
  write?: ((line: string) => void) | undefined;
  /** Injected in tests: answers the one typed line. */
  readLine?: ((question: string) => Promise<string>) | undefined;
}

/** What one file's storage release came back with. */
interface Released {
  path: string;
  released: number;
  alreadyReleased: number;
  failed: number;
  /**
   * Credits the release actually cost, and where they came from.
   *
   * ⛔ TWO FIELDS, NOT ONE, because "it cost nothing" and "it cost nothing OUT OF THE BALANCE" are
   *    different answers and only one of them is true. A release paid out of the file's own
   *    deposit charges the balance nothing; a file with no deposit pays twice the fee from the
   *    balance, and somebody watching their credits needs to be able to tell which happened.
   */
  feeCredits: number;
  fromDeposit: boolean;
  /** The server's typed refusal when the storage was not the treasury's to destroy. */
  refused: string | null;
}

/** The refusal a no-deposit release gets when the balance cannot cover the doubled fee. */
const FEE_INSUFFICIENT = "DEPOSIT_FEE_INSUFFICIENT";

export async function erase(paths: readonly string[], options: EraseOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (paths.length === 0) {
    throw new NmtsError(`\`${BINARY_NAME} erase\` needs the path of at least one thing in the drive.`, {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} ls --all\` prints the paths as this expects them.`,
    });
  }
  const typedFor = options.yes === true && currentMode() === "skip-permissions";
  const ask = options.readLine ?? promptLine;
  if (!typedFor && options.readLine === undefined && !stdinIsATerminal()) {
    throw new NmtsError("There is no terminal to type into (stdin is not a TTY).", {
      exitCode: 3,
      nextStep: `Run this where a person can type: erasing is confirmed by typing a sentence.`,
    });
  }

  const session = await openSession(options);
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  const entries: readonly ManifestEntry[] = list.manifest?.entries ?? [];
  const index = buildIndex(entries);
  const targets = batchTargets(entries, paths, { includeTrashed: true, nothingHappened: "Nothing was erased." });
  const files = uniqueById(targets.flatMap((t) => (t.kind === KIND_FILE ? [t] : filesUnder(entries, t.id))));
  const going = uniqueById([...targets, ...files]);
  if (files.length === 0) {
    throw new NmtsError(`Nothing named holds a file; empty folders are removed with \`${BINARY_NAME} rm\`.`, {
      exitCode: 4,
    });
  }

  say(`This erases ${files.length} file${files.length === 1 ? "" : "s"} for good. It cannot be undone, and not by the trash.`);
  for (const f of files) say(`  ${fullPathOf(index, f)}`);
  say(``);
  say(`  Erased:       the server's record of each file and this account's key to it, and its shares.`);
  if (options.releaseStorage === true) {
    say(`  Destroyed:    the storage bought with credits under each file, on the chain, before the erase.`);
    say(`                Storage bought by the wallet is not touched — it stays until its term ends.`);
  } else {
    say(`  Not erased:   the bytes on the storage network. They stay, unreadable, until their term ends;`);
    say(`                \`--release-storage\` also destroys the storage bought with credits under them.`);
  }
  say(`  Not refunded: storage already paid for.`);
  say(``);
  const typed = typedFor ? CONFIRM_SENTENCE : (await ask(`Type exactly: ${CONFIRM_SENTENCE}\n> `)).trim();
  if (typed !== CONFIRM_SENTENCE) {
    say(`Nothing was erased.`);
    return 1;
  }

  // ⛔ THE PROOF IS BUILT FOR THIS ONE RUN AND NOTHING KEEPS IT.
  const accountProof = await accountProofFor({ code: session.code, source: session.source });

  const releases: Released[] = [];
  if (options.releaseStorage === true) {
    for (const f of files) {
      const path = fullPathOf(index, f);
      try {
        const reply = await request(session.server, `/v1/items/${encodeURIComponent(f.id)}/release-storage`, {
          method: "POST",
          body: {},
          token: session.apiKey,
          accountProof,
        });
        releases.push({ path, refused: null, ...counts(reply), ...fee(reply) });
      } catch (error) {
        // ⛔ THE ONE REFUSAL THAT STOPS THE RUN. A file with no deposit pays twice the chain fee
        //    out of the balance, and a balance that cannot cover it means the release did not
        //    happen — erasing behind it would destroy the account's key to bytes that are still
        //    being served and still being paid for. Nothing is erased, and the two numbers say
        //    exactly how far short the balance is.
        if (error instanceof ServerError && error.code === FEE_INSUFFICIENT) {
          throw new NmtsError(
            `${path}: releasing its storage costs ${amount(error, "needed_credits")} credits and this ` +
              `account has ${amount(error, "balance_credits")}. It has no deposit, so the fee comes out of the balance.`,
            {
              exitCode: 4,
              nextStep:
                `Nothing was erased. Buy credits and run this again, or leave --release-storage off ` +
                `to erase the file and let its storage run out on its own.`,
            },
          );
        }
        // ⚠ "Not ours to destroy" is an answer, not a failure: the storage was bought by the
        //   wallet, and the erase goes on. A refusal of the KEY or the proof, and anything the
        //   server could not do, stops the run before a row is touched.
        if (error instanceof ServerError && error.status !== 401 && error.status !== 403 && error.status < 500) {
          releases.push({ path, released: 0, alreadyReleased: 0, failed: 0, feeCredits: 0, fromDeposit: false, refused: error.message });
          continue;
        }
        throw error;
      }
    }
  }

  let erased = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    const reply = await request(session.server, "/v1/items/erase", {
      method: "POST",
      body: { item_ids: files.slice(i, i + BATCH).map((f) => f.id) },
      token: session.apiKey,
      accountProof,
    });
    erased += typeof reply === "object" && reply !== null && typeof Reflect.get(reply, "erased") === "number"
      ? Number(Reflect.get(reply, "erased"))
      : 0;
  }

  // ⛔ THE LIST GOES LAST, and re-decided against the list as it is on this attempt: only the
  //    ids this run erased leave it, whatever another device wrote in between.
  const ids = new Set(going.map((e) => e.id));
  const result = await applyToList(session, (current) => {
    const still = current.filter((e) => ids.has(e.id)).map((e) => e.id);
    return still.length === 0 ? null : { op: "purge", ids: still };
  });

  if (options.json) {
    say(JSON.stringify({ erased, files: files.map((f) => ({ id: f.id, path: fullPathOf(index, f) })), releases, seq: result.seq }));
    return 0;
  }
  say(`Erased ${erased} file${erased === 1 ? "" : "s"}. Their entries are out of the file list.`);
  for (const r of releases) {
    if (r.refused !== null) say(`  ${r.path}: storage not released — ${r.refused}`);
    else if (r.failed > 0) say(`  ${r.path}: ${r.released} released, ${r.failed} could not be — those bytes are still being served.`);
    else say(`  ${r.path}: storage released (${r.released} destroyed${r.alreadyReleased > 0 ? `, ${r.alreadyReleased} already gone` : ""}).`);
    // ⛔ ONLY WHEN THE SERVER NAMED A NUMBER. Every release the new ledger charges costs at least
    //    one credit, so a zero here is a server that did not say rather than a release that was
    //    free — and "no credits were charged" is the wrong sentence to invent about money.
    if (r.refused === null && r.feeCredits > 0) say(`  ${r.path}: ${feeLine(r)}`);
  }
  return 0;
}

/** What the release cost and where it came from, in one clause. */
function feeLine(r: Released): string {
  const credits = `${r.feeCredits} credit${r.feeCredits === 1 ? "" : "s"}`;
  return r.fromDeposit
    ? `${credits} taken from that file's deposit — nothing came out of the balance`
    : `${credits} taken from the balance — that file had no deposit, so the fee is doubled`;
}

/** The three counts a release answers with, read defensively. */
function counts(reply: unknown): { released: number; alreadyReleased: number; failed: number } {
  const n = (name: string): number => {
    const v = typeof reply === "object" && reply !== null ? Reflect.get(reply, name) : undefined;
    return typeof v === "number" ? v : 0;
  };
  return { released: n("released"), alreadyReleased: n("already_released"), failed: n("failed") };
}

/** What it cost, read the same defensive way. An older server says neither, which reads as 0. */
function fee(reply: unknown): { feeCredits: number; fromDeposit: boolean } {
  const at = (name: string): unknown =>
    typeof reply === "object" && reply !== null ? Reflect.get(reply, name) : undefined;
  const charged = at("fee_credits");
  return {
    feeCredits: typeof charged === "number" ? charged : 0,
    fromDeposit: at("from_deposit") === true,
  };
}

/** One credit amount out of a refusal's details, or `?` when the server did not name it. */
function amount(error: ServerError, field: string): string {
  const value = error.details[field];
  return typeof value === "number" ? String(value) : "?";
}

function uniqueById(list: readonly ManifestEntry[]): ManifestEntry[] {
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}
