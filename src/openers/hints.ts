// The words a caller puts in a refusal, where the neutral sentence is not the one to say.
//
// ⛔ A TERMINAL NAMES ITS OWN COMMANDS AND A LIBRARY NAMES NONE. "`nmts openers add` attaches this
//    wallet" is the right next step for somebody at a prompt and the wrong one inside somebody
//    else's page, where that program does not exist. So the JUDGEMENT is written once, in this
//    folder, and the sentence that follows it belongs to whoever asked — the same division
//    `storage-control/hints.ts` keeps, for the same reason.
//
// ⚠ EVERY FIELD IS OPTIONAL, and what is left out is answered with a sentence that names nothing
//   outside the caller's own program. The SDK passes none of them.

export interface OpenerHints {
  /**
   * The `nextStep` for a wallet that has no opener on this server — the sign-in that found
   * nothing. ⚠ The account NUMBER is inside the signed bytes, so nothing can search for it.
   */
  noOpener?: string | undefined;
  /** The `nextStep` for a wallet whose two signatures over one message differed. */
  notRepeatable?: string | undefined;
  /** The `nextStep` for a wallet whose signing scheme cannot be used as an opener. */
  wrongKind?: string | undefined;
  /** The `nextStep` for a wallet that already opens THIS account — there is nothing to do. */
  alreadyAttached?: string | undefined;
  /**
   * The `nextStep` for a wallet that already opens ANOTHER account at this account number.
   *
   * ⚠ The way out is another number now and the SAME number at every later sign-in, which is a
   *   sentence about the caller's own options — so it is one of these rather than a fixed one.
   */
  opensAnother?: string | undefined;
  /** The `nextStep` for an account that is already holding as many openers as it may. */
  full?: string | undefined;
}
