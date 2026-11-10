// The recovery list riding in a wallet upload — the command line's and the SDK's copy of what the
// browser does in `web/src/lib/recovery/network-copy.ts` (spec 2026-09-20 unit B · NCF-3 §2.5).
//
// ⛔ WHY IT RIDES IN THE SAME UPLOAD. A quilt's blob id is a hash of its contents, so a list written
//    afterwards could not name the quilt it is in, and one written before the next upload would
//    describe every file but the one it rode with — for somebody who uploads once, all of them.
//    NRM-3's own-quilt placement says "my patch is called X, in the quilt you found me in"; the
//    standalone recovery program finds the list by the patch name the NMTS key derives and the
//    wallets it derives, with no server anywhere in the picture.
//
// ⛔ IT NEVER FAILS AN UPLOAD. Whatever goes wrong before the bytes leave — the switch unreadable,
//    the list not reconciling, a proof refused — is reported through `onProblem` and the file goes
//    up as its own blob, as it would have with the switch off. The person asked for a file to be
//    stored; the copy is a passenger.
//
// ⛔ ONE PART, UNDER 64 MiB, NEW STORAGE. A file of several parts has no single quilt to ride in, and
//    the browser draws the same line. A held storage resource was sized for the file alone, and a
//    quilt is a little larger — so a reused resource uploads without the passenger.
//
// ⛔ PLANNED BEFORE THE PRICE. Storage is bought for the bytes the register signature names, and a
//    quilt is larger than the file in it. So the decision to ride, and the quilt's length, come
//    before the quote — the browser's order (`web/src/lib/upload/quilt-session.ts`: encode, quote,
//    check the funds). `plan` lays the quilt out with the file's length in zeros and a list with
//    the riding entry's fields at their real lengths; a quilt's layout depends on lengths alone, so
//    the quilt laid out after agreement is the same size. If it is not — the account changed in
//    between — the file goes up alone, which costs less than was agreed, never more.
//
// ⛔ A RESUME DOES NOT RE-QUILT. The rail keeps the bytes it was given; the record here says those
//    bytes were a quilt and where the file sits inside it, so a second run prices that quilt and
//    reports the same patch.

import { fromBase64Url, toBase64Url } from "./bytes.ts";
import { DERIVED, loadCrypto } from "./crypto.ts";
import { isRecord } from "./guards.ts";
import { host } from "./host.ts";
import { makeRecoveryList, noteOfferedSeq, readRecoveryCopy, recordRecoveryList, type RecoveryAccount, type RidingFile } from "./recovery.ts";
import { registrationProofOf } from "./registration.ts";
import { fileSecrets } from "./seal.ts";
import { fileKeyOf, type PlaintextSource } from "./upload-file.ts";
import { partKey, readReservationRecord } from "./upload-store.ts";
import { RIDE_CEILING_BYTES, type BlobProtocol, type PaidPart, type UploadInput } from "./upload-wire.ts";

// The largest sealed file a recovery list rides with lives in `upload-wire.ts`, beside the seam.
export { RIDE_CEILING_BYTES };

/** What one ride remembers, so a resumed run reports the same patch. */
interface Ride {
  /** The file's own patch: its name and its place in the quilt. */
  identifier: string;
  startIndex: number;
  endIndex: number;
  /** The list's number, noted before the bytes left. */
  seq: number;
  /** The file's own sealed stream and the quilt it sits in. */
  streamLen: number;
  quiltLen: number;
}

export interface RideContext {
  account: RecoveryAccount;
  protocol: BlobProtocol;
  /** Said once per skipped or failed copy. The upload goes on either way. */
  onProblem?: ((message: string) => void) | undefined;
}

/** The one part a ride is planned for, before anything is sealed. */
export interface RideShape {
  /** The part's record key, as `uploadFile` files it. */
  partKey: string;
  /** Its sealed length, as `planAndPrice` works it out. */
  sealedLen: number;
  name: string;
  parentId: string | null;
  size: number;
  streamPlaintextLen: number;
}

export interface RecoveryRide {
  /**
   * Before the quote: the length the storage is bought for when the list rides — a fresh quilt, or
   * the quilt a first run stored — or null when the file goes up alone. Never throws.
   */
  plan(shape: RideShape): Promise<number | null>;
  /** The rail, wrapped, for what `plan` decided. */
  wrap(rail: (input: UploadInput) => Promise<PaidPart>): (input: UploadInput) => Promise<PaidPart>;
  /**
   * After the commit: tell the server which quilt holds the newest list. Never throws. Answers the
   * number of the list that rode, or null when none did.
   */
  record(): Promise<number | null>;
}

const rideKey = (key: string): string => `recovery-copy/${key}`;

/** The patch id an aggregator reads one patch by: the quilt id, then version 1 and the two indices. */
export function quiltPatchId(quiltId: string, startIndex: number, endIndex: number): string {
  const id = fromBase64Url(quiltId);
  const out = new Uint8Array(id.length + 5);
  out.set(id, 0);
  out[id.length] = 1;
  new DataView(out.buffer).setUint16(id.length + 1, startIndex, true);
  new DataView(out.buffer).setUint16(id.length + 3, endIndex, true);
  return toBase64Url(out);
}

async function readRide(key: string): Promise<Ride | null> {
  const bytes = await host().state.read(rideKey(key));
  if (bytes === undefined) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(v)) return null;
    const { identifier, startIndex, endIndex, seq, streamLen, quiltLen } = v;
    if (typeof identifier !== "string") return null;
    const nums = [startIndex, endIndex, seq, streamLen, quiltLen];
    if (!nums.every((n) => typeof n === "number" && Number.isSafeInteger(n))) return null;
    return { identifier, startIndex: Number(startIndex), endIndex: Number(endIndex), seq: Number(seq), streamLen: Number(streamLen), quiltLen: Number(quiltLen) };
  } catch {
    return null;
  }
}

/** The quilt a first run stored, when the record says this part rode: its length, else null. */
async function resumedQuilt(key: string): Promise<{ ride: Ride | null; sealedLen: number } | null> {
  const reserved = await readReservationRecord(key);
  if (reserved === null) return null;
  const known = await readRide(key);
  return { ride: known !== null && reserved.sealedLen === known.quiltLen ? known : null, sealedLen: reserved.sealedLen };
}

/** The failure's own sentence, without its full stop — the line around it ends the sentence. */
function why(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/, "");
}

/** A fresh patch name for the file, from the platform's generator. */
function freshIdentifier(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Wrap a wallet rail so that, with the copy switched on, the recovery list rides in the same quilt. */
export function rideRecoveryList(ctx: RideContext): RecoveryRide {
  const rides: { partKey: string; seq: number; quiltId: string }[] = [];
  const say = (message: string): void => ctx.onProblem?.(message);
  const encode = ctx.protocol.encodeQuilt?.bind(ctx.protocol);
  let planned: { identifier: string; quiltLen: number } | null = null;

  /** The list with `riding` in it, and the quilt it makes with `stream`. */
  const lay = async (riding: RidingFile, stream: Uint8Array) => {
    if (encode === undefined) throw new Error("this storage network protocol cannot lay out a quilt");
    const made = await makeRecoveryList(ctx.account, { riding: [riding] });
    const encoded = await encode([
      { contents: stream, identifier: riding.identifier },
      { contents: fromBase64Url(made.built.sealed), identifier: await patchNameOf(ctx.account.code) },
    ]);
    const mine = encoded.patches.find((p) => p.identifier === riding.identifier);
    if (mine === undefined) throw new Error("the quilt has no patch for the file");
    return { quilt: encoded.quilt, mine, seq: made.seq };
  };

  const plan = async (shape: RideShape): Promise<number | null> => {
    planned = null;
    if (encode === undefined) return null;
    try {
      const resumed = await resumedQuilt(shape.partKey);
      if (resumed !== null) return resumed.ride?.quiltLen ?? null;
      if (shape.sealedLen > RIDE_CEILING_BYTES) return null;
      const state = await readRecoveryCopy(ctx.account);
      if (state === null || !state.enabled) return null;
      const identifier = freshIdentifier();
      const { quilt } = await lay({ identifier, ...shape, ...(await secretsOfLength(ctx.account.code)) }, new Uint8Array(shape.sealedLen));
      planned = { identifier, quiltLen: quilt.length };
      return quilt.length;
    } catch (error) {
      say(`The recovery list was left out of this upload: ${why(error)}. The file goes up on its own.`);
      return null;
    }
  };

  const onQuilt = (key: string, ride: Ride, paid: PaidPart): PaidPart => {
    rides.push({ partKey: key, seq: ride.seq, quiltId: paid.blobId });
    return { ...paid, sealedLen: ride.streamLen, patchId: quiltPatchId(paid.blobId, ride.startIndex, ride.endIndex) };
  };

  const wrap = (rail: (input: UploadInput) => Promise<PaidPart>) => async (input: UploadInput): Promise<PaidPart> => {
    if (input.part.total !== 1) return rail(input);
    // ── a resume: the bytes handed in are whatever the first run stored ──
    const resumed = await resumedQuilt(input.key);
    if (resumed !== null) return resumed.ride === null ? rail(input) : onQuilt(input.key, resumed.ride, await rail(input));
    const agreed = planned;
    if (agreed === null) return rail(input);

    let ride: Ride;
    let quilt: Uint8Array;
    try {
      const { entry } = input;
      const laid = await lay(
        { identifier: agreed.identifier, name: entry.name, parentId: entry.parentId, size: entry.plaintextLen, streamPlaintextLen: input.part.plaintextLen, dekWrapped: entry.dekWrapped, contentHashCt: entry.contentHashCt },
        input.sealed,
      );
      // ⛔ THE PRICE AGREED WAS FOR THIS LENGTH. Any other quilt goes unregistered.
      if (laid.quilt.length !== agreed.quiltLen) throw new Error("the file list changed while this upload was being priced");
      quilt = laid.quilt;
      ride = { identifier: agreed.identifier, startIndex: laid.mine.startIndex, endIndex: laid.mine.endIndex, seq: laid.seq, streamLen: input.sealed.length, quiltLen: quilt.length };
      // ⛔ NOTED BEFORE THE BYTES LEAVE. Skipping a number breaks nothing; reusing one is the defect.
      await noteOfferedSeq(ctx.account.accountId, laid.seq);
      await host().state.write(rideKey(input.key), new TextEncoder().encode(JSON.stringify(ride)));
    } catch (error) {
      say(`The recovery list was left out of this upload: ${why(error)}. The file goes up on its own.`);
      return rail(input);
    }
    return onQuilt(input.key, ride, await rail({ ...input, sealed: quilt }));
  };

  const record = async (): Promise<number | null> => {
    let newest: number | null = null;
    for (const r of rides) {
      newest = Math.max(newest ?? 0, r.seq);
      try {
        await recordRecoveryList(ctx.account, { seq: r.seq, blobId: r.quiltId });
      } catch (error) {
        // ⚠ The bytes ARE on the storage network and the recovery program finds them without us.
        //   What is missing is the account screen's note, so it is said and nothing else.
        say(`The recovery list went up with the file, and the server did not record it: ${why(error)}. The recovery program finds it without the server.`);
      }
      await host().state.remove(rideKey(r.partKey)).catch(() => undefined);
    }
    return newest;
  };

  return { plan, wrap, record };
}

/**
 * The ride for one wallet upload, planned for its one part: the ride, and the length to price.
 *
 * ⚠ THE PROOF IS `authSecret` — what every sign-in sends and the proof header carries. The caller
 *   already holds the code for the upload itself, so building it here asks nothing new of anybody.
 *
 * ⚠ THE FILE IS READ ONCE MORE, to find its records (a resume prices what the first run stored). A
 *   ride is a file of one part under 64 MiB, so nothing larger is read twice.
 */
export async function planWalletRide(
  ctx: { server: string; apiKey: string; code: string; accountId: string; network: string },
  protocol: BlobProtocol,
  onProblem: ((message: string) => void) | undefined,
  file: { source: PlaintextSource; name: string; parentId: string | null; destination: string; streamPlaintextLen: number; sealedLen: number },
): Promise<{ ride: RecoveryRide; quiltLen: number | null }> {
  const { authSecret } = await registrationProofOf(ctx.code);
  const account: RecoveryAccount = {
    server: ctx.server,
    bearer: ctx.apiKey,
    code: ctx.code,
    accountId: ctx.accountId,
    network: ctx.network,
    accountProof: authSecret,
  };
  const ride = rideRecoveryList({ account, protocol, onProblem });
  if (protocol.encodeQuilt === undefined || file.sealedLen > RIDE_CEILING_BYTES) return { ride, quiltLen: null };
  const fileKey = await withDataKey(ctx.code, (dataKey) => fileKeyOf(dataKey, file.source, file.name, file.destination));
  const quiltLen = await ride.plan({
    partKey: partKey(fileKey, 0),
    sealedLen: file.sealedLen,
    name: file.name,
    parentId: file.parentId,
    size: file.source.size,
    streamPlaintextLen: file.streamPlaintextLen,
  });
  return { ride, quiltLen };
}

/** Run `use` with the data key the NMTS key derives, and wipe it after. */
async function withDataKey<T>(code: string, use: (dataKey: Uint8Array) => T | Promise<T>): Promise<T> {
  const crypt = await loadCrypto();
  const derived = crypt.kdf_derive(crypt.account_code_parse(code));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  try {
    return await use(dataKey);
  } finally {
    dataKey.fill(0);
  }
}

/** The name the list's patch takes, derived from the data key (NCF-3 §2.5). */
async function patchNameOf(code: string): Promise<string> {
  const crypt = await loadCrypto();
  return withDataKey(code, (dataKey) => crypt.recovery_patch_name(dataKey));
}

/**
 * A wrapped key and a sealed hash at the lengths a real upload's are, for pricing before anything
 * is sealed. Made by the very function `uploadFile` uses, so the lengths cannot drift; the key in
 * them is thrown away.
 */
async function secretsOfLength(code: string): Promise<{ dekWrapped: string; contentHashCt: string }> {
  const crypt = await loadCrypto();
  return withDataKey(code, (dataKey) => {
    const made = fileSecrets(crypt, dataKey, new Uint8Array(32));
    made.dek.fill(0);
    return { dekWrapped: made.dekWrapped, contentHashCt: made.contentHashCt };
  });
}
