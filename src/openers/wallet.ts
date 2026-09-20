// What a wallet actually does: open an account, be attached to one, be taken off one.
//
// ⛔ ONE IMPLEMENTATION, FOUR CALLERS — the command line, the SDK, a page and the recovery tool
//    ask for the same acts with different surfaces around them. The order inside each act is the
//    part that must not be written twice: which bytes are signed, what is compared against what,
//    when the account's 20 key bytes exist and when they are wiped, and what the server is told.
//
// ⛔ NOTHING HERE PRINTS, PROMPTS, OR CHOOSES AN EXIT CODE. A terminal shows the address and asks;
//    a page shows a button; a library caller decided by calling. Every refusal is thrown with a
//    machine code at the front of it, and the sentence after that code is the caller's to replace.
//
// ⛔ THE ACCOUNT CODE IS BORROWED, NOT KEPT. `addWallet` takes it, parses it to the 20 bytes the
//    engine seals, and wipes those bytes on every path out — including the failing one. What comes
//    back from an attach is a locator and nothing else; what comes back from a sign-in IS the
//    account, and it goes straight to whoever asked and nowhere else.

import { toBase64Url } from "../bytes.ts";
import { loadCrypto } from "../crypto.ts";
import type { CryptoGlue } from "../crypto-surface.ts";
import { NmtsError } from "../errors.ts";
import {
  fetchSlot,
  KIND_WALLET,
  putOpener,
  removeOpener,
  type OpenerAccess,
} from "./doors.ts";
import type { OpenerHints } from "./hints.ts";
import { withRepeatedSignature, withSignature, type WalletOpener } from "./sign.ts";

/** What a sign-in with a wallet answers. */
export interface WalletSignIn {
  /** The NMTS key this wallet opened, in the form a person reads and types. */
  accountCode: string;
  /** The name the slot it opened is filed under — what `remove` takes. */
  locator: string;
}

/** What attaching a wallet answers. ⛔ The signature that made it is not here and cannot be. */
export interface AttachedWallet {
  locator: string;
  kind: "wallet";
}

/**
 * Sign in with a wallet: sign once, ask for the slot that name finds, and open it.
 *
 * ⛔ THERE IS NO "WRONG SIGNATURE, RIGHT SLOT" CASE. The name the slot is filed under and the key
 *    that opens it come out of the same signature, so a signature that finds a slot opens it —
 *    which is why a failure to open is reported as a defect rather than as a wrong wallet.
 *
 * ⚠ AN ACCOUNT NUMBER IS INSIDE THE SIGNED BYTES, so nothing here can look for the others. A
 *   sign-in that finds nothing says so; trying 2, 3, 4 would mean asking the person to sign once
 *   per number, and the caller is the one that may ask.
 */
export async function signInWithWallet(
  server: string,
  input: WalletOpener,
  hints: OpenerHints = {},
): Promise<WalletSignIn> {
  const glue = await loadCrypto();
  return withSignature(
    input,
    async (serialized) => {
      const locator = toBase64Url(glue.opener_locator(serialized));
      const slot = await fetchSlot(server, locator);
      if (slot === null) {
        throw new NmtsError(
          // Copy facts — the sentence. Facts: this wallet, at this account number, has no opener on
          // this server; nothing was created and nothing was sent but the lookup. Another number
          // needs another signature, because the number is inside what was signed.
          "NO_OPENER_FOR_WALLET: no NMTS account on this server opens with this wallet.",
          {
            exitCode: 4,
            nextStep:
              hints.noOpener ??
              "Nothing was opened. A different account number is a different message, so it needs a new signature.",
          },
        );
      }
      const key = glue.opener_open(serialized, slot);
      try {
        return { accountCode: glue.account_code_display(key), locator };
      } finally {
        key.fill(0);
      }
    },
    hints,
  );
}

/**
 * Attach this wallet to the account `accountCode` opens.
 *
 * ⛔ THE SIGNATURE IS TAKEN TWICE AND THE TWO MUST MATCH — see `withRepeatedSignature`. A wallet
 *    that signs differently the second time would seal a slot it could never open.
 *
 * ⛔ WHAT THIS CREATES IS A STANDING WAY INTO THE ACCOUNT. Whoever holds this wallet can open every
 *    file in it, from any machine, until the slot is removed. The server is given a locked lump it
 *    cannot open and a name it cannot trace to a wallet.
 *
 * ⛔ AND THE NAME IS ASKED FOR BEFORE ANYTHING IS SEALED OR SENT. One wallet at one account number
 *    reaches exactly one locator, so a slot already filed under it is either this account's — the
 *    wallet is attached already — or another account's, and a PUT would meet the server's flat
 *    "not found" (its deliberate answer for "not yours"). Both are said here instead, in the words
 *    that tell the person what to do about it.
 */
export async function addWallet(
  access: OpenerAccess,
  accountCode: string,
  input: WalletOpener,
  hints: OpenerHints = {},
): Promise<AttachedWallet> {
  const glue = await loadCrypto();
  return withRepeatedSignature(
    input,
    async (serialized) => {
      const locator = toBase64Url(glue.opener_locator(serialized));
      const taken = await fetchSlot(access.server, locator);
      if (taken !== null) refuseTakenName(glue, serialized, taken, accountCode, input.account ?? 1, hints);
      const key = keyBytes(glue.account_code_parse.bind(glue), accountCode);
      let slot: Uint8Array;
      try {
        slot = glue.opener_seal(serialized, key);
      } finally {
        key.fill(0);
      }
      await putOpener(access, locator, KIND_WALLET, slot);
      return { locator, kind: "wallet" };
    },
    hints,
  );
}

/**
 * Refuse NOW if this wallet, at this account number, already opens an account on this server.
 *
 * ⛔ FOR THE ONE PATH WHERE THE ACCOUNT DOES NOT EXIST YET. `nmts create --wallet` would otherwise
 *    make an account, print its key, and only then learn that the wallet cannot be attached to it —
 *    leaving behind an account nobody asked for. One signature answers that before anything is
 *    created, and there is nothing to compare the slot against, so every slot found is another
 *    account's.
 */
export async function refuseIfWalletOpensAnAccount(
  server: string,
  input: WalletOpener,
  hints: OpenerHints = {},
): Promise<void> {
  const glue = await loadCrypto();
  await withSignature(
    input,
    async (serialized) => {
      const locator = toBase64Url(glue.opener_locator(serialized));
      if ((await fetchSlot(server, locator)) !== null) throw opensAnother(input.account ?? 1, hints);
    },
    hints,
  );
}

/**
 * What a locator that is already taken means, said as one of two refusals.
 *
 * ⛔ THE PROBE'S OPENED KEY IS A SECRET LIKE ANY OTHER. It is compared and wiped on every path out,
 *    including the throwing ones, and it is never returned, printed or put in a message.
 *
 * ⚠ A SLOT THAT WILL NOT OPEN COUNTS AS ANOTHER ACCOUNT'S. The name comes from the same signature
 *   the opening key does, so this cannot happen to a sound slot; what it must never become is a
 *   PUT that walks into the server's "not found".
 */
function refuseTakenName(
  glue: CryptoGlue,
  serialized: Uint8Array,
  slot: Uint8Array,
  accountCode: string,
  account: number,
  hints: OpenerHints,
): never {
  let opened: Uint8Array | null = null;
  let mine: Uint8Array | null = null;
  try {
    try {
      opened = glue.opener_open(serialized, slot);
    } catch {
      opened = null;
    }
    if (opened !== null) {
      const key = keyBytes(glue.account_code_parse.bind(glue), accountCode);
      mine = key;
      if (opened.length === key.length && opened.every((byte, at) => byte === key[at])) {
        throw new NmtsError("WALLET_ALREADY_ATTACHED: this wallet already opens this account.", {
          exitCode: 4,
          nextStep: hints.alreadyAttached ?? "Nothing was stored.",
        });
      }
    }
    throw opensAnother(account, hints);
  } finally {
    opened?.fill(0);
    mine?.fill(0);
  }
}

/** The refusal for a name that belongs to an account this key does not open. */
function opensAnother(account: number, hints: OpenerHints): NmtsError {
  return new NmtsError(
    `WALLET_OPENS_ANOTHER_ACCOUNT: under account number ${account}, this wallet already opens another NMTS account.`,
    {
      exitCode: 4,
      nextStep:
        hints.opensAnother ??
        "Nothing was stored. One wallet and one number open one account: use another account number, and the same number when signing in.",
    },
  );
}

/**
 * Take one wallet off the account.
 *
 * ⛔ "FROM NOW ON", NOT "AS IF IT NEVER KNEW". A wallet that opened this account once has held the
 *    NMTS key. The only answer to that is a new account, and the screen or command that offers
 *    removal is where that sentence belongs.
 */
export async function removeWallet(access: OpenerAccess, locator: string): Promise<void> {
  await removeOpener(access, requiredLocator(locator));
}

/**
 * The sealed 62 bytes filed under one locator — the file the recovery tool opens with a signature.
 *
 * ⛔ IT NEEDS NO CREDENTIAL AND PROVES NOTHING. Whoever has the locator can fetch these bytes, and
 *    they are worth nothing without the wallet: the name is derived from the same secret the key
 *    is. What it buys is that a person can keep their own copy and open their account with their
 *    wallet alone, with this server gone.
 */
export async function walletSlot(server: string, locator: string): Promise<Uint8Array> {
  const slot = await fetchSlot(server, requiredLocator(locator));
  if (slot === null) {
    throw new NmtsError("OPENER_NOT_FOUND: this server has no slot filed under that name.", {
      exitCode: 4,
      // Copy facts — the next step. Fact: an unknown name, a malformed one and somebody else's are
      // one answer on purpose — any difference between them is a way to learn which names exist.
      nextStep: "Nothing was fetched. The list of this account's openers has the names it holds.",
    });
  }
  return slot;
}

/** A locator that is at least present. What it NAMES is the server's to judge. */
function requiredLocator(locator: string): string {
  if (locator.trim() === "") {
    throw new NmtsError("OPENER_LOCATOR_MISSING: no opener was named.", {
      exitCode: 2,
      nextStep: "Nothing was sent. Name the opener by the locator the list prints.",
    });
  }
  return locator.trim();
}

/**
 * The account's 20 key bytes, with the one refusal this tool words for a code that is not one.
 *
 * ⚠ The engine's own message is not repeated: it can contain the input, and the input here is the
 *   account itself.
 */
function keyBytes(parse: (code: string) => Uint8Array, accountCode: string): Uint8Array {
  try {
    return parse(accountCode);
  } catch {
    throw new NmtsError("ACCOUNT_CODE_INVALID: that is not a valid NMTS key.", {
      exitCode: 2,
      nextStep: "Nothing was stored. The last character is a check symbol; look for a mistyped one.",
    });
  }
}
