// Writing THE FIRST VERSION of an account's sealed file list — the only write that builds on
// nothing. ("Version 1" here is the store version — `seq` — and not the sealed format version:
// what this writes is format version 2, an index plus its chunks, like every other write.)
//
// ⛔ IT IS A SEPARATE DOOR FROM EVERY OTHER WRITE, AND THAT IS THE POINT. Ordinary edits read the
//    current list, apply an intent to it and hand the server the version they built on; there is
//    no version to build on here, so this one declares `base_seq: null` — "I believe this account
//    has no list". The server accepts that only while none exists. So the guarantee "a rebuild
//    never overwrites a list" is not a check this file performs and could forget: it is the shape
//    of the request. A list that appeared while this ran comes back as a version conflict, and a
//    conflict here is a REFUSAL rather than something to retry — retrying would mean rebuilding on
//    top of somebody's real names.
//
// ⛔ AND THE CALLER MUST STILL LOOK FIRST. The server's refusal is the last line, not the first:
//    reading the list before building one is what lets this tool say "this account already has a
//    file list" without spending a listing of the whole account first.

import { ServerError } from "./api.ts";
import { DERIVED, loadCrypto } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { writeChunkedList, type ChunkIO } from "./manifest-chunk-flow.ts";
import { recordWrittenList } from "./manifest.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";

export interface CreateListInput {
  server: string;
  apiKey: string;
  /** The account code. Used to derive the file-list key, and not kept. */
  code: string;
  accountId: string;
}

export interface CreateListResult {
  /** The version the server says is now current. 1 for a list that had nothing before it. */
  seq: number;
}

/**
 * Seal these entries as store version 1 and write them, or refuse because a list already exists.
 *
 * ⛔ NO `prev` LINK, because there is nothing before this. The first version is the one version
 *    that is allowed not to name what it continued from; every version after it must, or the fork
 *    check has a hole exactly where a fork would be introduced.
 *
 * ⛔ NO SETTINGS EITHER. Account settings live in this blob or nowhere, and a rebuild has none to
 *    carry: they were in the list that was lost. Writing an empty set is not a loss caused here.
 */
export async function createFirstList(
  input: CreateListInput,
  entries: readonly ManifestEntry[],
): Promise<CreateListResult> {
  const crypt = await loadCrypto();
  const [from, to] = DERIVED.fileListKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(input.code));
  const key = derived.slice(from, to);
  derived.fill(0);

  const io: ChunkIO = {
    server: input.server,
    apiKey: input.apiKey,
    accountId: input.accountId,
    crypt,
    key,
  };
  try {
    let written: { seq: number; ct: string };
    try {
      written = await writeChunkedList(io, {
        previous: [],
        entries,
        seq: 1,
        settings: {},
        // ⛔ `null` IS THE WHOLE SAFETY DEVICE. Any number here would mean "replace the version I
        //    read", which is exactly what a rebuild must never do.
        baseSeq: null,
      });
    } catch (error) {
      if (error instanceof ServerError && error.code === "VERSION_CONFLICT") {
        throw new NmtsError("This account already has a file list, so nothing was rebuilt.", {
          exitCode: 4,
          nextStep:
            "Nothing was changed. A list appeared while this ran — another device wrote one, or " +
            "one was there all along. Run `nmts ls` to see what it holds; a rebuild would have " +
            "replaced its names with placeholders.",
        });
      }
      throw error;
    }

    // ⛔ ONLY NOW. Recording a version the server did not accept would leave this machine believing
    //    in a list that never existed, and then refusing the real one as a rollback.
    await recordWrittenList(input.accountId, written.seq, written.ct);
    return { seq: written.seq };
  } finally {
    key.fill(0);
  }
}
