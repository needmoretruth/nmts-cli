// What an account code says about itself, computed on this machine and nowhere else.
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
//   recovery routes that ask a key to prove the account code as well — the same value a sign-in
//   sends, and its own header says why sending it is safe and what it can still do if it is
//   stolen. Neither returns it to anything else, and nothing here changed: this module still does
//   not hand it out. ⚠ `dataKey` is a different matter and is NOT returned by anything, here or
//   there — the few commands that need it cut it from their own derivation and wipe it in the
//   same function.

import { DERIVED, loadCrypto } from "./crypto.ts";
import { NmtsError } from "./errors.ts";

export interface AccountIdentity {
  /** Base64url of the 16 bytes the server knows this account by. Public. */
  accountId: string;
  /** The address other people use to share with this account. Public. */
  publicCode: string;
  /** The account code as it is meant to be read, in groups. NOT printed by default. */
  displayCode: string;
}

/**
 * Check that a string is a real account code.
 *
 * ⛔ This is the engine's own parser, which verifies the trailing check symbol. A typo therefore
 *    fails HERE, offline, instead of becoming a sign-in failure the person cannot tell apart from
 *    a wrong password, a network problem or a suspended account.
 */
export async function assertUsableCode(code: string): Promise<void> {
  const glue = await loadCrypto();
  try {
    glue.account_code_parse(code);
  } catch {
    // ⛔ The engine's own message is not repeated: it can contain the input.
    throw new NmtsError("That is not a valid NMTS account code.", {
      exitCode: 2,
      nextStep: "Check for a mistyped or missing character. The last character is a check symbol.",
    });
  }
}

/** Derive the public facts about an account from its code. */
export async function identityOf(code: string): Promise<AccountIdentity> {
  const glue = await loadCrypto();
  let bytes: Uint8Array;
  try {
    bytes = glue.account_code_parse(code);
  } catch {
    throw new NmtsError("That is not a valid NMTS account code.", {
      exitCode: 2,
      nextStep: "Check for a mistyped or missing character. The last character is a check symbol.",
    });
  }
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
      accountId: Buffer.from(derived.slice(idFrom, idTo)).toString("base64url"),
      publicCode: glue.share_address_display(derived.slice(shareFrom, shareTo)),
      displayCode: glue.account_code_display(bytes),
    };
  } finally {
    derived.fill(0);
    bytes.fill(0);
  }
}
