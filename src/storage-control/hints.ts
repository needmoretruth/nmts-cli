// The words a caller puts in a refusal, where the neutral sentence is not the one to say.
//
// ⛔ A TERMINAL NAMES ITS OWN COMMANDS AND A LIBRARY NAMES NONE. "`nmts env` says which network was
//    asked" is the right next step for somebody at a prompt and the wrong one inside somebody
//    else's server, where that program may not exist. So the JUDGEMENT is written once, here, and
//    the sentence that follows it belongs to whoever asked — the same division this whole folder
//    keeps between what is decided and what is printed.
//
// ⚠ EVERY FIELD IS OPTIONAL, and what is left out is answered with a sentence that names nothing
//   outside the caller's own program. The SDK passes none of them.

import type { NmtsError } from "../errors.ts";

export interface StorageHints {
  /**
   * The `nextStep` for a chain that did not answer. The chain's own cause is added after it, so
   * this is the part before `Cause: …` and nothing else.
   */
  cannotRead?: string | undefined;
  /** The `nextStep` for a resource this wallet does not hold free. */
  notHeld?: string | undefined;
  /**
   * The whole refusal for a cut that would keep nothing or everything.
   *
   * ⚠ A FUNCTION BECAUSE THE NUMBER IS THE CHAIN'S: `limit` is the resource's own size, already in
   *   the units a person reads, or its own number of epochs. What the refusal calls the thing that
   *   was too big — a flag, a field — is the caller's to say.
   */
  cut?: ((what: "size" | "period", limit: string) => NmtsError) | undefined;
  /** The `nextStep` for a storage term that has already ended. */
  lapsed?: string | undefined;
}
