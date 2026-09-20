// The bytes a wallet is asked to sign, and the one place a signature it hands back is judged.
//
// ⛔ THE MESSAGE IS THE ENGINE'S AND IS NEVER RETYPED HERE. `opener_message` builds it in Rust so
//    that the browser, this tool and the recovery tool ask for ONE message: a character of drift
//    between them is a different wrapping key, a different locator, and a slot that no longer
//    opens. Nothing in this file writes a line of it, checks an address for itself, or repairs an
//    input the engine refuses — all three are inside what a person reads in the wallet popup.
//
// ⛔ THE SERIALIZED SIGNATURE NEVER LEAVES THIS FILE'S CALL STACK. `withSignature` borrows it for
//    the length of one piece of work and answers whatever that work answers; it is not returned,
//    not stored on anything returned, and not closed over by anything that outlives the call. That
//    is review finding 2-B3 kept on this side of the boundary — the Rust crate keeps it on the
//    other (`crypto/src/opener.rs`) — and `cli/test/openers.test.ts` proves the objects these
//    functions hand back cannot reach it.
//
// ⛔ THE SCHEME IS READ BEFORE THE SIGNATURE IS VERIFIED, and it is read with the chain library's
//    own flag table rather than a list written here. Three schemes sign the same bytes the same
//    way every time and can be openers; multisig, zkLogin and passkeys cannot, and each of them
//    gets its own reason code because the answer differs — a passkey holder needs to be told that
//    passkeys sign differently every time, not that "something was wrong". The ENGINE refuses them
//    too, and that refusal is the authority; what is here is which sentence a caller can say.
//
// ⚠ VERIFIED AGAINST OUR OWN BYTES, ALWAYS. The wallet is asked to sign a message this file built
//   and the signature is checked against that same message and the address it names — never
//   against whatever the wallet says it signed. A wallet that answers `bytes` has them compared
//   first, so "it signed something else" is reported as itself rather than as an invalid signature.

import { SIGNATURE_FLAG_TO_SCHEME } from "@mysten/sui/cryptography";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";

import { fromBase64Url } from "../bytes.ts";
import { loadCrypto } from "../crypto.ts";
import { NmtsError } from "../errors.ts";
import type { OpenerHints } from "./hints.ts";

/** What a wallet hands back: the serialized signature, and what it says it signed. */
export interface WalletSignature {
  /** The serialized signature, base64 — `flag ‖ signature ‖ public key`, as every wallet sends it. */
  signature: string;
  /** Base64 of the bytes the wallet signed, when it says. Compared, never trusted. */
  bytes?: string | undefined;
}

/** A wallet's answer in either shape: the standard's object, or the signature on its own. */
export type SignedMessage = WalletSignature | string;

/** Whatever holds the wallet's key: a browser extension, a key file, a hardware device. */
export type SignWallet = (message: Uint8Array) => Promise<SignedMessage> | SignedMessage;

/** Which account this wallet opens, and how to ask it. */
export interface WalletOpener {
  /** The wallet's Sui address, `0x` and 64 LOWERCASE hex. Refused, never repaired. */
  address: string;
  /**
   * Which of this wallet's NMTS accounts. Default 1.
   *
   * ⛔ IT IS INSIDE THE SIGNED BYTES, so nothing can look for the others: a sign-in that finds no
   *    opener cannot try 2, 3, 4 without asking the person to sign again, once per number.
   */
  account?: number | undefined;
  /**
   * A product scope. Absent means one wallet opens the same account everywhere; present means this
   * wallet opens a different account for this product alone.
   *
   * ⚠ THE PRICE OF LEAVING IT OUT: every product that gets this signature opens the same files.
   */
  app?: string | undefined;
  sign: SignWallet;
}

/** The scheme flags that can be an opener, by the chain library's own name for each. */
const OPENS: readonly string[] = ["ED25519", "Secp256k1", "Secp256r1"];

/**
 * Why a wallet's signing scheme cannot hold an opener. ⛔ ONE CODE PER REASON: the thing to do
 * about a multisig wallet and about a passkey are different, so the two cannot share an answer.
 */
const REFUSED_SCHEME: Readonly<Record<string, string>> = {
  // Copy facts — the sentences. Facts, in order: a multisig wallet's bytes depend on which signers
  // took part, so the same message does not always give the same signature; zkLogin's ephemeral
  // key and proof change every session; a passkey signs over a counter, so no two signatures over
  // one message match. None of the three can re-open a slot tomorrow, which is why they are
  // refused at the door rather than discovered later.
  MultiSig: "WALLET_MULTISIG: this wallet signs differently depending on which signers take part.",
  ZkLogin: "WALLET_ZKLOGIN: this wallet signs differently in every session.",
  Passkey: "WALLET_PASSKEY: this wallet signs differently every time.",
};

/** The exact bytes this wallet is asked to sign. Built by the engine; refused, never repaired. */
export async function openerMessage(input: WalletOpener): Promise<Uint8Array> {
  const glue = await loadCrypto();
  const account = input.account ?? 1;
  try {
    return input.app === undefined
      ? glue.opener_message(input.address, account)
      : glue.opener_message(input.address, account, input.app);
  } catch (error) {
    // ⚠ The engine's own sentence is carried: it names which of the three inputs was not canonical,
    //   and every one of them is a value the caller passed rather than anything secret.
    throw new NmtsError(`WALLET_MESSAGE_REFUSED: ${message(error)}`, {
      exitCode: 2,
      // Copy facts — the next step. Facts: the address is `0x` + 64 lowercase hex, the account
      // number starts at 1, an app is 1–64 of a-z0-9.- starting and ending alphanumeric — and none
      // of the three is tidied up here, because all three are inside what the person signs.
      nextStep: "Nothing was signed. Pass the address exactly as the wallet spells it.",
    });
  }
}

/**
 * Get one signature over this account's message, judge it, and lend it to `use`.
 *
 * ⛔ THE SIGNATURE IS NOT THE ANSWER. Whatever `use` returns is; the bytes are dropped when this
 *    call ends, and there is deliberately no form of this that hands them back.
 */
export async function withSignature<T>(
  input: WalletOpener,
  use: (serialized: Uint8Array) => Promise<T>,
  hints: OpenerHints = {},
): Promise<T> {
  const message = await openerMessage(input);
  return use(await judged(await input.sign(message), message, input.address, hints));
}

/**
 * Get the signature TWICE and refuse unless both are the same 64 bytes, then lend it to `use`.
 *
 * ⛔ THE ONE CHECK THAT MAKES AN OPENER WORTH STORING. A slot is opened by the same signature that
 *    sealed it, so a wallet that signs differently the second time seals something it can never
 *    open — and the person would learn that at their next sign-in, with the account behind it.
 *    Two signatures now is a question a wallet answers in seconds; the alternative is a slot that
 *    looks fine forever.
 *
 * ⚠ IT IS RUN FOR EVERY SCHEME, including the three that sign deterministically. An Ed25519 wallet
 *   held by a signing service, an MPC wallet or a hardware wallet with its own nonce rule all
 *   present as Ed25519 and all may hedge — the flag says how a signature is checked, not how it
 *   was made.
 */
export async function withRepeatedSignature<T>(
  input: WalletOpener,
  use: (serialized: Uint8Array) => Promise<T>,
  hints: OpenerHints = {},
): Promise<T> {
  const message = await openerMessage(input);
  const first = await judged(await input.sign(message), message, input.address, hints);
  const again = await judged(await input.sign(message), message, input.address, hints);
  if (!sameBytes(first, again)) {
    throw new NmtsError(
      // Copy facts — the sentence. Facts: the wallet was asked for the same signature twice and gave
      // two different answers; a slot is opened by the signature that sealed it, so this wallet
      // could not open what it is about to seal. Nothing was stored.
      "WALLET_NOT_REPEATABLE: this wallet signed the same message two different ways.",
      {
        exitCode: 4,
        nextStep:
          hints.notRepeatable ??
          "Nothing was stored. A wallet that signs differently each time cannot open what it seals.",
      },
    );
  }
  return use(first);
}

/**
 * One wallet answer, turned into serialized bytes this layer will act on — or a named refusal.
 *
 * The order is deliberate: what it signed, then what it signed WITH, then whether the signature
 * holds. Each question's failure has a different answer, and asking them in this order means the
 * reason a caller is given is the first thing that was actually wrong.
 */
async function judged(
  answer: SignedMessage,
  message: Uint8Array,
  address: string,
  hints: OpenerHints,
): Promise<Uint8Array> {
  const signature = typeof answer === "string" ? answer : answer.signature;
  const said = typeof answer === "string" ? undefined : answer.bytes;
  if (typeof signature !== "string" || signature === "") {
    throw new NmtsError("WALLET_SIGNATURE_MISSING: the wallet answered no signature.", {
      exitCode: 4,
      nextStep: "Nothing was stored and nothing was opened.",
    });
  }
  // ⛔ FIRST, BECAUSE IT IS THE ONE FAILURE THAT IS NOT ABOUT CRYPTOGRAPHY. A wallet that signed a
  //    different message — its own wrapper, a truncation, another site's text — would otherwise be
  //    reported as an invalid signature, which sends whoever reads it to look at the wrong thing.
  if (said !== undefined && !sameBytes(fromBase64Url(said), message)) {
    throw new NmtsError("WALLET_SIGNED_OTHER_BYTES: the wallet signed something other than this message.", {
      exitCode: 4,
      // Copy facts — the next step. Facts: what the wallet returned as the signed bytes is not what
      // it was handed; the message carries the address, the account number and the version, and
      // opening depends on those exact bytes. Nothing was stored.
      nextStep: "Nothing was stored. The message this asked for and the one that was signed differ.",
    });
  }
  const serialized = decoded(signature);
  refuseTheScheme(serialized, hints);
  try {
    await verifyPersonalMessageSignature(message, signature, { address });
  } catch {
    // ⛔ THE LIBRARY'S OWN MESSAGE IS NOT CARRIED. It differs between "not valid for this message"
    //    and "not this address", and both mean one thing to whoever asked: what came back does not
    //    belong to the wallet that was named, over the bytes it was given.
    throw new NmtsError("WALLET_SIGNATURE_INVALID: that signature is not this wallet's, over these bytes.", {
      exitCode: 4,
      nextStep: "Nothing was stored and nothing was opened.",
    });
  }
  return serialized;
}

/** The serialized signature's bytes, or a refusal that does not quote what was handed in. */
function decoded(signature: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(signature);
  } catch {
    throw new NmtsError("WALLET_SIGNATURE_MALFORMED: the wallet's signature is not base64.", {
      exitCode: 4,
      nextStep: "Nothing was stored and nothing was opened.",
    });
  }
  if (bytes.length === 0) {
    throw new NmtsError("WALLET_SIGNATURE_MALFORMED: the wallet's signature is empty.", {
      exitCode: 4,
      nextStep: "Nothing was stored and nothing was opened.",
    });
  }
  return bytes;
}

/**
 * Refuse a scheme that cannot hold an opener, by its own name.
 *
 * ⚠ AN ALLOW LIST. A flag nobody here has judged is refused for being unknown rather than let
 *   through for being new — the same rule the engine keeps one layer down.
 */
function refuseTheScheme(serialized: Uint8Array, hints: OpenerHints): void {
  const flag = serialized[0];
  const scheme = flag === undefined ? undefined : Reflect.get(SIGNATURE_FLAG_TO_SCHEME, String(flag));
  if (typeof scheme === "string" && OPENS.includes(scheme)) return;
  const named = typeof scheme === "string" ? REFUSED_SCHEME[scheme] : undefined;
  throw new NmtsError(
    named ??
      // Copy facts — the sentence for a scheme nothing here knows. Fact: this version accepts the
      // three Sui schemes that sign one message the same way every time.
      `WALLET_UNKNOWN_SCHEME: this version does not know how wallet scheme 0x${(flag ?? 0).toString(16).padStart(2, "0")} signs.`,
    {
      exitCode: 4,
      nextStep:
        hints.wrongKind ??
        "Nothing was stored and nothing was opened. An opener needs a wallet that signs one message the same way every time.",
    },
  );
}

/** Two runs of bytes, compared for being the same. Neither of them is secret. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, at) => byte === b[at]);
}

/** Whatever an engine refusal said, as text. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
