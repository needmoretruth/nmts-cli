// What an NMTS key says about itself, computed on this machine and nowhere else.
//
// ⛔ EVERY VALUE HERE IS DERIVED LOCALLY. None of it is asked of a server, and none of it needs
//    one: that is the property the whole product rests on, and it is why `whoami` can answer
//    before this tool can even sign in.
//
// ⛔ `authSecret` AND `dataKey` ARE NOT EXPOSED. The derivation produces them, this module does
//    not hand them out, and nothing that prints goes near them. `identityOf` returns only the two
//    values that are already public: the account id the server knows you by, and the code other
//    people use to share with you.
//
// ⚠ TWO OTHER MODULES DERIVE `authSecret`, AND THEY ARE NAMED HERE SO THIS PARAGRAPH STAYS TRUE.
//   `registration.ts` builds it for the single call that CREATES an account, because the server
//   has to be given it once to store a verifier of it. `account-proof.ts` builds it for the three
//   recovery routes that ask a key to prove the NMTS key as well — the same value a sign-in
//   sends, and its own header says why sending it is safe and what it can still do if it is
//   stolen. Neither returns it to anything else, and nothing here changed: this module still does
//   not hand it out. ⚠ `dataKey` is a different matter and is NOT returned by anything, here or
//   there — the few commands that need it cut it from their own derivation and wipe it in the
//   same function.

import { toBase64Url } from "./bytes.ts";
import { DERIVED, loadCrypto, type CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";

export interface AccountIdentity {
  /** Base64url of the 16 bytes the server knows this account by. Public. */
  accountId: string;
  /** The address other people use to share with this account. Public. */
  publicCode: string;
  /** The NMTS key as it is meant to be read, in groups. NOT printed by default. */
  displayCode: string;
}

/**
 * Check that a string is a real NMTS key — or its 15-word recovery phrase — and return the key in
 * its display form, so what gets stored is the key whichever spelling was typed.
 *
 * ⛔ This is the engine's own parser, which verifies the trailing check symbol. A typo therefore
 *    fails HERE, offline, instead of becoming a sign-in failure the person cannot tell apart from
 *    a wrong password, a network problem or a suspended account. The engine's own message is not
 *    repeated: it can contain the input.
 */
export async function assertUsableCode(code: string): Promise<string> {
  const glue = await loadCrypto();
  const bytes = parseKeyOrPhrase(glue, code);
  try {
    return glue.account_code_display(bytes);
  } finally {
    bytes.fill(0);
  }
}

/** Derive the public facts about an account from its code. */
export async function identityOf(code: string): Promise<AccountIdentity> {
  const glue = await loadCrypto();
  const bytes = parseKeyOrPhrase(glue, code);
  // ⛔ WIPED, like every other derivation in this tool. This buffer is not an account id — it is
  //    EVERY KEY IN THE ACCOUNT: the sign-in secret, the key that opens the files, the key that
  //    opens the file list, and the wallet root. This one call site was leaving all of it live for
  //    as long as the process ran, and `put` calls it on the path that then spends money and holds
  //    a file's plaintext. The two public values are copied out first; nothing else survives.
  const derived = glue.kdf_derive(bytes);
  try {
    const [idFrom, idTo] = DERIVED.accountId;
    const [shareFrom, shareTo] = DERIVED.shareAddress;
    return {
      accountId: toBase64Url(derived.slice(idFrom, idTo)),
      publicCode: glue.share_address_display(derived.slice(shareFrom, shareTo)),
      displayCode: glue.account_code_display(bytes),
    };
  } finally {
    derived.fill(0);
    bytes.fill(0);
  }
}

/**
 * The 20 bytes of an NMTS key or its 15-word recovery phrase. A phrase's refusal says which way it
 * is wrong — a 12- or 24-word input is most likely a wallet's seed pasted into the wrong place.
 */
function parseKeyOrPhrase(glue: CryptoGlue, input: string): Uint8Array {
  try {
    return glue.account_code_parse(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const nextStep = message.startsWith("phrase:count")
      ? "An NMTS recovery phrase has 15 words. A 12- or 24-word phrase belongs to a wallet, not to NMTS."
      : message.startsWith("phrase:word")
        ? `Word ${message.split(":")[2] ?? "?"} is not in the recovery phrase word list. Check its spelling.`
        : message.startsWith("phrase:checksum")
          ? "Every word is in the list, but one is wrong or two are in the wrong order."
          : "Check for a mistyped or missing character. The last character is a check symbol.";
    throw new NmtsError("That is not a valid NMTS key or recovery phrase.", { exitCode: 2, nextStep });
  }
}

/** The NMTS key as its 15-word recovery phrase, in `en` (default) or `ko`. */
export async function phraseOf(code: string, lang: string | undefined): Promise<string> {
  if (lang !== undefined && lang !== "en" && lang !== "ko") {
    throw new NmtsError(`There is no recovery phrase word list "${lang}".`, {
      exitCode: 2,
      nextStep: "--lang takes en or ko.",
    });
  }
  const glue = await loadCrypto();
  const bytes = parseKeyOrPhrase(glue, code);
  try {
    return glue.account_code_phrase(bytes, lang ?? "en");
  } finally {
    bytes.fill(0);
  }
}
