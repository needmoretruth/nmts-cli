// The steps both recovery artefacts share: prove the code, read the account, seal the list.
//
// ⛔ ONE PLACE, BECAUSE THE TWO COMMANDS MUST NOT DISAGREE. `recovery-list` writes the sealed list
//    as a file of its own; `kit` writes the same document inside the one file that also carries the
//    NMTS key. If those were assembled twice, one of them would eventually be built from a
//    check the other had dropped — and the difference would only show up in a recovery.
//
// ⛔ AND THE ASSEMBLY ITSELF IS THE LIBRARY'S (`recovery.ts`, spec 2026-09-20 unit B), so an app
//    on the SDK hands its user the same bytes these commands write. What stays here is what only a
//    terminal has: this machine's session, the agreement that lets it read the code, and the
//    sentence that names the file on disk when the server's record fails.

import { accountProofFor } from "./account-proof.ts";
import { ServerError } from "./api.ts";
import { fromUtf8 } from "./bytes.ts";
import { NmtsError } from "./errors.ts";
import { makeRecoveryList, recordRecoveryList as recordWithServer, type RecoveryAccount } from "./recovery.ts";
import type { BuiltRecoveryList } from "./recovery-build.ts";
import { openSession, type Session } from "./session.ts";

export interface AssembleOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Ticks while the account is being read, so a large one does not look frozen. */
  onProgress?: ((loaded: number) => void) | undefined;
}

export interface AssembledRecoveryList {
  session: Session;
  account: RecoveryAccount;
  built: BuiltRecoveryList;
  /** This list's own version number. */
  seq: number;
  /** RFC3339, stamped before the account was read. What the server is told. */
  capturedAt: string;
  /** The `.nmtsmap` document and the name to offer it under. */
  file: { filename: string; content: string; bytes: Uint8Array };
}

export async function assembleRecoveryList(options: AssembleOptions = {}): Promise<AssembledRecoveryList> {
  const session = await openSession({ server: options.server, network: options.network });
  // ⛔ THE AGREEMENT IS ASKED HERE, not in the library: a code read from a plain environment
  //    variable needs this machine's consent before its proof is built (`account-proof.ts`).
  const accountProof = await accountProofFor({ code: session.code, source: session.source });
  const account: RecoveryAccount = {
    server: session.server,
    bearer: session.apiKey,
    code: session.code,
    accountId: session.accountId,
    network: session.network,
    accountProof,
  };
  const made = await makeRecoveryList(account, { onProgress: options.onProgress });
  return {
    session,
    account,
    built: made.built,
    seq: made.seq,
    capturedAt: made.capturedAt,
    file: { filename: made.file.filename, content: fromUtf8(made.file.content), bytes: made.file.content },
  };
}

/**
 * Tell the server a list was written, and what number it carries.
 *
 * ⛔ THE FILE FIRST, THE RECORD SECOND — so this takes the path that already exists. The record is
 *    what makes an account screen say "your list is up to date"; saying that before the file
 *    exists would be a claim about something that may never have been written.
 */
export async function recordRecoveryList(assembled: AssembledRecoveryList, destination: string): Promise<void> {
  const { seq } = assembled;
  try {
    await recordWithServer(assembled.account, { seq, capturedAt: assembled.capturedAt });
  } catch (error) {
    // ⛔ THE FILE IS GOOD AND THE RECORD IS NOT. Those are two different facts and the person needs
    //    both, so this neither swallows the failure nor pretends the run succeeded.
    if (error instanceof ServerError && error.code === "VERSION_CONFLICT") {
      throw new NmtsError(`The file was written, and the server did not record it: ${error.message}`, {
        exitCode: 4,
        nextStep:
          `${destination} IS usable — keep it. What did not happen is the note on the server that ` +
          `says which list is newest, because this account already has one numbered ${seq} or ` +
          `higher: a browser or another machine wrote one this machine has not seen. This run has ` +
          `been remembered, so running the command again offers a higher number.`,
      });
    }
    throw error;
  }
}
