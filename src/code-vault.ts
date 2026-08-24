// Locking the account code with a passphrase, so what is on disk is not the code.
//
// WHY THIS EXISTS. `nmts login` used to write the account code in the clear at mode 600, which is
//   what `gh`, `aws` and `docker login` do. Mode 600 answers exactly one question — "can another
//   user on this machine read it" — and answers nothing about a backup, a copied home directory,
//   a synced folder, a container image layer, or a disk pulled out of a laptop. A passphrase
//   answers those, and only those.
//
// ⛔ WHAT IT DOES NOT DO, SAID FIRST. It does not protect the code from anything running AS YOU
//    while you are using the tool: whatever supplies the passphrase can be read the same way the
//    passphrase is. On a machine where an unattended agent runs, the passphrase has to come from
//    somewhere the agent can reach, and at that point this is a lock whose key is taped beside it.
//    That is not a reason to leave it out — it is the reason the tool ALSO offers a secret file,
//    which is the right answer for an unattended agent — but it is the reason nothing here claims
//    the code is "safe".
//
// ⛔ NODE BUILT-INS ONLY. `scrypt` and AES-256-GCM are in `node:crypto`; a password-hashing
//    dependency would put somebody else's code on the path the account code travels, for a
//    function the platform already ships. This is local storage, not the NMTS crypto format —
//    NCF-3 governs what leaves this machine, and nothing here does.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { NmtsError } from "./errors.ts";

/**
 * scrypt's cost: N=2^16, r=8, p=2 — one of the sets OWASP's Password Storage Cheat Sheet gives as
 * equivalent to its headline N=2^17, r=8, p=1.
 *
 * ⛔ THE EQUIVALENT SET WAS CHOSEN FOR ITS MEMORY, NOT ITS SPEED. Work is proportional to N·r·p,
 *    so these two cost the same processor time; peak memory is proportional to N·r, so this one
 *    needs 64 MiB where the other needs 128 MiB. This tool is meant to run inside containers, and
 *    a container with a 128 MiB limit would have the whole process killed — which arrives as a
 *    dead command with no message rather than as a wrong passphrase.
 *
 * ⚠ Measured on the machine this was written on: about a third of a second per unlock. It is paid
 *   once per command that needs the code, and the tool says so during `login` rather than letting
 *   somebody discover it on their fiftieth upload. Both halves of the cost are the point — memory
 *   is what stops a GPU being better at this than a laptop.
 */
const N = 1 << 16;
const R = 8;
const P = 2;

/**
 * ⛔ SCRYPT'S OWN MEMORY CEILING HAS TO BE RAISED BY HAND. Node's default `maxmem` is 32 MiB and
 *    these parameters need `128 × N × r` = 64 MiB, so the call throws "Invalid scrypt param"
 *    without this — a failure that looks like a bug in the passphrase rather than a limit.
 */
const MAXMEM = 96 * 1024 * 1024;

/**
 * ⛔ A STORED FILE MAY NOT ASK FOR MORE THAN THIS VERSION ITSELF WRITES.
 *
 * The parameters travel in the file so an old file still opens after the cost is raised — but a
 * file is something an attacker can edit, and every one of the three is a lever on how long this
 * process spends before the tag is checked and the guess is rejected. An adversarial review
 * measured it: `n` alone was bounded, and an edited `p` of 81,918 — the largest OpenSSL would
 * accept — made every command grind for **39 minutes** before answering "wrong passphrase".
 *
 * So the ceiling is what THIS version would produce, on both axes that matter:
 *   · memory  ∝ n·r      — capped at exactly ours, so a file cannot make a small container
 *                          OOM-kill the process, which arrives as a command that died saying
 *                          nothing rather than as a refusal;
 *   · work    ∝ n·r·p    — capped at exactly ours, so the worst a hostile file can buy is the
 *                          same fraction of a second an honest one costs.
 *
 * ⚠ THE PRICE IS FORWARD COMPATIBILITY, AND IT IS PAID ON PURPOSE. A future version that raises
 *   the cost writes files this one refuses. That is what the `v` field is for: raising the cost
 *   is a code change AND a version bump, not a number somebody edits in a file.
 *
 * The floor matters for the opposite reason: a file rewritten with n=2 would unlock in
 * microseconds if the passphrase were guessed, so we would have done the guessing cheaply on the
 * attacker's behalf.
 */
const MIN_N = 1 << 14;
const MAX_MEMORY_UNITS = N * R;
const MAX_WORK_UNITS = N * R * P;

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

/** What gets written. Every field is needed to open it again; none of them is a secret. */
export interface LockedCode {
  /** Format version of THIS file, not of the NMTS crypto format. */
  v: 1;
  kdf: "scrypt";
  n: number;
  r: number;
  p: number;
  /** base64 */
  salt: string;
  /** base64 */
  nonce: string;
  /** base64, ciphertext followed by the 16-byte tag. */
  ct: string;
}

/** Thrown when the passphrase does not open the file. ⛔ Never says how close it was. */
export class WrongPassphraseError extends NmtsError {
  constructor() {
    super("That passphrase does not open the stored account code.", {
      exitCode: 3,
      nextStep:
        "Try again. If the passphrase is lost, the stored copy cannot be recovered — sign in " +
        "again with the account code itself.",
    });
    this.name = "WrongPassphraseError";
  }
}

/**
 * Bind the parameters to the ciphertext.
 *
 * Editing `n` in the file then changes what the tag is checked against, so a tampered parameter
 * fails as a wrong passphrase rather than as a successful decryption of something else. It costs
 * one string and removes a whole class of question about what an edited file can do.
 */
function aad(locked: Pick<LockedCode, "v" | "kdf" | "n" | "r" | "p">): Buffer {
  return Buffer.from(`nmts-cli/code-vault/${locked.v}/${locked.kdf}/${locked.n}/${locked.r}/${locked.p}`, "utf8");
}

/**
 * ⛔ CHECKED BEFORE ONE BYTE OF WORK IS DONE. Every branch here is reached in microseconds; the
 *    tag that would reject a tampered file is checked at the END of the derivation, so a bound
 *    applied afterwards is not a bound at all.
 */
function refuseCost(locked: LockedCode): void {
  const { n, r, p } = locked;
  const whole = (v: number): boolean => Number.isInteger(v) && v >= 1;
  const refuse = (): never => {
    throw new NmtsError("The stored account code names a key-derivation cost this version refuses.", {
      exitCode: 1,
      nextStep:
        "The file has been edited, or was written by a newer version of this tool. Sign in again " +
        "with the account code itself.",
    });
  };
  if (!whole(n) || !whole(r) || !whole(p)) refuse();
  // scrypt's own requirement, and the reason a non-power-of-two is refused rather than rounded.
  if ((n & (n - 1)) !== 0 || n < MIN_N) refuse();
  // ⛔ SCRYPT'S OWN CONSTRAINT, CHECKED HERE SO THE REFUSAL IS OURS. RFC 7914 requires
  //    `N < 2^(128·r/8)`, so a file naming r=1 beside our n=2^16 is not merely expensive — it is
  //    invalid, and OpenSSL's own message for it ("Invalid scrypt param") says nothing a person
  //    could act on. Found by a test that expected r=1 to be a CHEAPER file and got a different
  //    error than the one it was written to see.
  if (n >= 2 ** (16 * r)) refuse();
  if (n * r > MAX_MEMORY_UNITS) refuse();
  // ⛔ Multiplied in this order and compared against a constant this process can hold: the three
  //    are already bounded above by the memory check and by each other, so no product here can
  //    leave the safe-integer range before it is compared.
  if (n * r * p > MAX_WORK_UNITS) refuse();
}

function deriveKey(passphrase: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  try {
    return scryptSync(Buffer.from(passphrase, "utf8"), salt, KEY_BYTES, { N: n, r, p, maxmem: MAXMEM });
  } catch (error) {
    throw new NmtsError("The stored account code asks for a key derivation this machine refused.", {
      exitCode: 1,
      nextStep: `Cause: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** Seal the code under a passphrase. The result is safe to write to a file. */
export function lockCode(code: string, passphrase: string): LockedCode {
  if (passphrase.length === 0) throw new NmtsError("An empty passphrase locks nothing.", { exitCode: 2 });
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const key = deriveKey(passphrase, salt, N, R, P);
  const head = { v: 1, kdf: "scrypt", n: N, r: R, p: P } as const;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad(head));
    const body = Buffer.concat([cipher.update(Buffer.from(code, "utf8")), cipher.final()]);
    return {
      ...head,
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      ct: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}

/**
 * Open a sealed code.
 *
 * ⛔ The tag is checked before a single byte is returned — that is what `final()` does for GCM, and
 *    it is why a wrong passphrase cannot yield a plausible-looking wrong code.
 */
export function unlockCode(locked: LockedCode, passphrase: string): string {
  refuseCost(locked);
  const n = locked.n;
  const salt = Buffer.from(locked.salt, "base64");
  const nonce = Buffer.from(locked.nonce, "base64");
  const whole = Buffer.from(locked.ct, "base64");
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES || whole.length <= TAG_BYTES) {
    throw new WrongPassphraseError();
  }
  const body = whole.subarray(0, whole.length - TAG_BYTES);
  const tag = whole.subarray(whole.length - TAG_BYTES);
  const key = deriveKey(passphrase, salt, n, locked.r, locked.p);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(locked));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);
    try {
      return plain.toString("utf8");
    } finally {
      plain.fill(0);
    }
  } catch (error) {
    if (error instanceof NmtsError) throw error;
    throw new WrongPassphraseError();
  } finally {
    key.fill(0);
  }
}

/** Shape check for something read off disk. ⛔ A parser, not an assertion: the file is input. */
export function isLockedCode(value: unknown): value is LockedCode {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["v"] === 1 &&
    v["kdf"] === "scrypt" &&
    typeof v["n"] === "number" &&
    typeof v["r"] === "number" &&
    typeof v["p"] === "number" &&
    typeof v["salt"] === "string" &&
    typeof v["nonce"] === "string" &&
    typeof v["ct"] === "string"
  );
}

/**
 * Are these two passphrases the same? Used only to catch a typo when one is being set.
 *
 * ⚠ Constant-time because it costs nothing to be. Neither value is secret to this process, but a
 *   comparison that short-circuits is a habit worth not having near a passphrase.
 */
export function samePassphrase(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
