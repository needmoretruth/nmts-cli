// The one thing this tool says before it keeps an account code on a machine.
//
// ⛔ WHY IT EXISTS. Handing an agent your account code is handing it the vault: in NMTS every key
//    is derived from that one code — the file keys and the wallet both — so an agent that leaks it
//    has leaked everything at once, and the account cannot be re-keyed because the account IS the
//    code. The owner asked for this to be said out loud (2026-08-23).
//
// ⛔ WHY IT SAYS FACTS AND NOT "WE ARE NOT LIABLE". A disclaimer is a contract term, and the Terms
//    of Service in force today do not carry one for this. Printing a term we have not published
//    would be claiming an agreement that does not exist. A clause covering this is drafted for the
//    next version of the published Terms; until that version is in force, this text states only
//    what is verifiably true, which is the part that actually helps somebody decide anyway.
//    ⛔ When that version ships, the term belongs in the Terms — not here. This stays facts.
//
// ⛔ WHY IT IS SHOWN ONCE AND NOT EVERY RUN. A warning printed on every command is a warning
//    nobody reads, and it would land in the middle of an agent's output forever. It is shown at
//    the moment the decision is made — when the code is first written to this machine.

import { PRODUCT_NAME } from "./product.ts";

/**
 * The text shown before an account code is stored on this machine.
 *
 * Every sentence here is a measured fact about how NMTS works, not a prediction and not a
 * comparison. If any of it stops being true, this text is wrong and must change with the code.
 */
export function firstRunNotice(): string {
  return [
    `${PRODUCT_NAME} is about to keep your account code on this machine.`,
    ``,
    `  Your account code is the only key to your account. The keys that encrypt`,
    `  your files and the keys to your wallet are all derived from it.`,
    ``,
    `  Keeping it here is what lets this tool work while you are away. It also`,
    `  means any program that can read your files can read it, including any`,
    `  agent you run on this machine.`,
    ``,
    `  If it leaves this machine — in a log line, in a prompt, in a repository —`,
    `  whoever holds it can read every file in the account and spend from the`,
    `  wallet. NMTS cannot undo that: requests made with your code cannot be`,
    `  told apart from your own, and the code cannot be changed while keeping`,
    `  the account.`,
    ``,
    `  Give an agent an account you would be willing to lose.`,
    ``,
  ].join("\n");
}
