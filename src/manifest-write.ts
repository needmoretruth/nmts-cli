// Writing the sealed file list — the step that turns a stored file into a visible one.
//
// ⛔ A FILE THAT IS NOT IN THIS LIST DOES NOT EXIST TO ITS OWNER. The server knows a file was
//    committed and charges for it; the NAME, the folder and the key that opens it live only here,
//    sealed under a key the server does not have. So this is the last step of an upload and the
//    one that must not be skipped after the money moved.
//
// ⛔ THE WHOLE LIST IS REWRITTEN EVERY TIME. There is no "append" on the wire — the blob is sealed
//    as one piece. That is why this re-reads immediately before writing: the version it builds on
//    has to be the current one, and anything another device added since must be carried forward,
//    not overwritten.
//
// ⛔ WHAT PROTECTS AGAINST BUILDING ON A STALE LIST. Three things, and none of them alone:
//      · this machine's own record refuses a list older than one it already saw;
//      · the server's compare-and-swap on `base_seq` refuses a write built on a version it has
//        already moved past — which is what catches an ordinary race between two devices;
//      · the `prev` link inside the blob makes a fork visible to the NEXT reader on any device.
//    The account's own settings ride along for the same reason: they live in this blob or nowhere,
//    so rewriting the list without them would silently clear them.

import { request, ServerError } from "./api.ts";
import { AAD, DERIVED, loadCrypto } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { readFileList, recordWrittenList } from "./manifest.ts";
import { encodeManifest, type ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
import { entryAt, type FindOptions, namesIn } from "./drive-paths.ts";
import { applyIntents, type ManifestIntent } from "./shared/lib/drive/manifest-ops.ts";
import { uniqueFileName } from "./shared/lib/drive/unique-name.ts";

/** How many times a lost compare-and-swap is re-applied before giving up. */
const CONFLICT_RETRIES = 3;

/**
 * ⛔ THE SAME FIELD NAMES `Session` USES, so a session IS a valid input and nothing has to be
 *    translated between the two. One thing with two names is how a caller ends up passing the
 *    server where the account id goes on the day a field moves.
 */
export interface ListEditInput {
  server: string;
  apiKey: string;
  code: string;
  accountId: string;
}

export interface ListEditResult {
  /** The version now current. */
  seq: number;
  /** True when the list was rebuilt because another device wrote first. */
  reappliedAfterConflict: boolean;
  /** False when the intent was already true of the list, so nothing was written. */
  changed: boolean;
  /** The list as it now stands — after the edit, or as found when nothing changed. */
  entries: readonly ManifestEntry[];
}

/**
 * Apply one intent to the account's sealed file list.
 *
 * ⛔ THE INTENT IS WHAT IS RETRIED, NEVER FINISHED BYTES. On a lost compare-and-swap the list is
 *    read again and the intent is applied to the NEW one, so both edits survive. That is why the
 *    caller passes a function rather than an intent: an intent computed once against the old list
 *    could name a folder id, or a free name, that the new list no longer has.
 *
 * ⛔ AND THE INTENTS COME FROM THE BROWSER'S OWN MODULE, copied here byte-for-byte by
 *    `deploy/gen-cli-shared.mjs`. Re-implementing "send to the trash" would look trivial and be
 *    wrong in the small places: a re-trashed item must keep its ORIGINAL instant (it is the start
 *    of the 30-day window the product promises), and trashing a folder must not stamp its
 *    children (that would reset each child's own clock).
 *
 * `make` returning null means there is nothing to do; nothing is written and `changed` is false.
 */
export async function applyToList(
  input: ListEditInput,
  make: (entries: readonly ManifestEntry[]) => ManifestIntent | null,
): Promise<ListEditResult> {
  // ⛔ ONE COMPARE-AND-SWAP LOOP IN THIS FILE, and this is the one-intent door into it. A second
  //    copy would be a second place for "decide again on every attempt" to be got right, and the
  //    copy nobody re-reads is the one that quietly re-applies a stale decision.
  return applyManyToList(input, (entries) => {
    const intent = make(entries);
    return intent === null ? [] : [intent];
  });
}

/**
 * Apply a RUN of intents to the account's sealed file list — as ONE write.
 *
 * ⛔ ONE WRITE, NOT ONE PER TARGET. A command naming five things and writing five times is five
 *    chances to lose the compare-and-swap, and losing it half way leaves a drive nobody asked
 *    for: three things moved, two not, and one error that names neither half. The whole list is
 *    rewritten on every save anyway (see the header), so five edits cost exactly what one costs.
 *
 * ⛔ AND `make` DECIDES THE WHOLE RUN AGAIN ON EVERY ATTEMPT. A free name, an existing folder and
 *    a live target are all facts about the version that was READ, and a retry happens against a
 *    version somebody else has just written. A `make` that folds its own intents onto a working
 *    copy as it goes must start that fold from the list it is handed each time — never from the
 *    working copy it built on the attempt before.
 *
 * An empty run means there is nothing to do; nothing is written and `changed` is false.
 */
export async function applyManyToList(
  input: ListEditInput,
  make: (entries: readonly ManifestEntry[]) => readonly ManifestIntent[],
): Promise<ListEditResult> {
  const crypt = await loadCrypto();
  const [from, to] = DERIVED.fileListKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(input.code));
  const key = derived.slice(from, to);
  derived.fill(0);

  try {
    let conflicted = false;
    for (let attempt = 0; attempt <= CONFLICT_RETRIES; attempt += 1) {
      const current = await readFileList(input.server, input.apiKey, input.code, input.accountId);
      const entries: readonly ManifestEntry[] = current.manifest ? current.manifest.entries : [];

      const intents = make(entries);
      // ⛔ A no-op is a SUCCESS, not a failure. Renaming a file to the name it already has, or
      //    trashing something already in the trash, must not cost a version bump every other
      //    device then has to download.
      if (intents.length === 0) {
        return { seq: current.seq ?? 0, reappliedAfterConflict: conflicted, changed: false, entries };
      }
      const next = applyIntents(entries, intents);
      if (next === entries) {
        return { seq: current.seq ?? 0, reappliedAfterConflict: conflicted, changed: false, entries };
      }

      const body = await encodeManifest(
        next,
        (current.seq ?? 0) + 1,
        current.fingerprint,
        current.manifest?.settings,
      );
      const sealed = crypt.envelope_seal(key, new TextEncoder().encode(AAD.fileList), body);
      body.fill(0);
      const ct = Buffer.from(sealed).toString("base64url");

      try {
        const answer = await request(input.server, "/v1/manifest", {
          method: "PUT",
          token: input.apiKey,
          body: { base_seq: current.seq ?? null, ct },
        });
        const seq = seqOf(answer);
        await recordWrittenList(input.accountId, seq, ct);
        return { seq, reappliedAfterConflict: conflicted, changed: true, entries: next };
      } catch (error) {
        // ⛔ A version conflict is an ORDINARY outcome, not a failure: another device wrote first.
        //    Anything else is not, and must not be retried into a second attempt at the same edit.
        if (!(error instanceof ServerError) || error.code !== "VERSION_CONFLICT") throw error;
        conflicted = true;
      }
    }
    throw new NmtsError(
      `The file list was rewritten by something else ${CONFLICT_RETRIES + 1} times in a row.`,
      {
        nextStep:
          "Nothing about this edit was lost — running the same command again applies it to the " +
          "list as it now stands.",
      },
    );
  } finally {
    key.fill(0);
  }
}

/**
 * The entries a run of typed paths names, in the order they were typed.
 *
 * ⛔ HERE, BESIDE THE BATCH WRITE, so every command that takes many paths answers "the same thing
 *    named twice" the same way: once. `nmts rm a.txt a.txt` is not two deletions, and a repeated
 *    id inside one intent would make the count in the message disagree with the list written.
 *
 * ⛔ AND A PATH THAT DOES NOT RESOLVE REFUSES THE WHOLE RUN, because it throws from here before
 *    anything is composed. That is the decision every batch command in this tool makes: nothing
 *    is half-done. Moving the four paths that resolved and skipping the fifth would exit 0 on a
 *    command that did not do what it was told, and the caller would have to diff the drive to
 *    find out which one. A path already IN the state being asked for is not this case — that is
 *    a no-op, and each command names it in its own words.
 *
 * ⚠ Call it INSIDE `make`. A path is a question about the list, and the answer changes when
 *   another device writes first.
 */
export function batchTargets(
  entries: readonly ManifestEntry[],
  paths: readonly string[],
  options: FindOptions = {},
): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const found = entryAt(entries, path, options);
    if (seen.has(found.id)) continue;
    seen.add(found.id);
    out.push(found);
  }
  return out;
}

export interface AddEntryInput extends ListEditInput {
  /** The entry to add. Its `name` may be changed to avoid a collision — see the result. */
  entry: ManifestEntry;
}

export interface AddEntryResult {
  /** The version now current. */
  seq: number;
  /** The name the entry actually got, which is not the requested one if that was taken. */
  name: string;
  /** True when the list was rebuilt because another device wrote first. */
  reappliedAfterConflict: boolean;
}

/**
 * Add one entry to the account's sealed file list.
 *
 * ⛔ THE NAME IS CHOSEN AGAINST THE LIST AS IT IS ON THIS ATTEMPT. That is the reason this passes
 *    a function to `applyToList`: after a lost compare-and-swap the free names have changed, and
 *    a name picked against the old list could land on top of what the other device just added.
 */
export async function addEntry(input: AddEntryInput): Promise<AddEntryResult> {
  let name = input.entry.name;
  let alreadyThere: string | null = null;

  const result = await applyToList(input, (entries) => {
    // ⛔ An id already in the list is not added twice: the account would show two rows for one
    //    file and the second would be unreachable. It is also how a re-run of an interrupted
    //    upload finds its own work already done.
    const existing = entries.find((e) => e.id === input.entry.id);
    if (existing !== undefined) {
      alreadyThere = existing.name;
      return null;
    }
    name = uniqueFileName(input.entry.name, namesIn(entries, input.entry.parentId));
    return { op: "add", entry: { ...input.entry, name } };
  });

  return {
    seq: result.seq,
    name: alreadyThere ?? name,
    reappliedAfterConflict: result.reappliedAfterConflict,
  };
}

function seqOf(answer: unknown): number {
  if (typeof answer === "object" && answer !== null) {
    const seq: unknown = Reflect.get(answer, "seq");
    if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 1) return seq;
  }
  throw new NmtsError("The file list was written but the server did not say which version it is now.", {
    nextStep: "The entry is saved. Run `nmts ls` to see it.",
  });
}
