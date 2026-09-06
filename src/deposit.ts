// How many credits an upload sets aside on the file it uploads — the rule, in one place.
//
// ⛔ IT IS A CHOICE, AND THE TOOL ALWAYS SENDS IT. A credit-paid upload holds a deposit against
//    the chain fee of any later operation on that file (releasing its storage early, or reshaping
//    it): the fee is converted to credits and taken from that deposit, at least one credit, and
//    whatever is left comes back when the storage period ends. The number is chosen per upload,
//    from 0 to `DEPOSIT_CREDITS_MAX`, and an account's own default lives in the sealed file list.
//
// ⚠ ZERO IS A REAL ANSWER, NOT A MISTAKE. A file with no deposit still releases — it just pays
//   twice the same fee out of the balance at that moment, and is refused when the balance cannot
//   cover that. Withholding the option would be safety that shackles; the cost is said instead,
//   at the moment it is chosen and again in the price the upload prints.
//
// ⛔ THE REFUSAL HAPPENS BEFORE ANYTHING IS SENT. A number outside the range is a command line to
//    fix, not a request to make: rounding it into range would spend money on an amount nobody
//    typed, and asking the server would cost a round trip to learn about a typo.

import { NmtsError } from "./errors.ts";
import { BINARY_NAME } from "./product.ts";
import type { AccountSettings } from "./shared/lib/drive/manifest-settings.ts";
import {
  DEPOSIT_DEFAULT_CREDITS,
  DEPOSIT_MAX_CREDITS,
} from "./shared/lib/drive/manifest-settings.ts";

// The shared module (generated from the browser's source) names the two numbers the other way
// round; the CLI's own vocabulary is kept so the commands and their tests read as written.
export const DEPOSIT_CREDITS_MAX = DEPOSIT_MAX_CREDITS;
export const DEPOSIT_CREDITS_DEFAULT = DEPOSIT_DEFAULT_CREDITS;

/**
 * What `--deposit <n>` asked for, or undefined when it was not given.
 *
 * ⛔ WHOLE CREDITS ONLY. A deposit is a number of credits the ledger moves, and there is no such
 *    thing as half of one; `--deposit 1.5` is refused rather than rounded, because rounding picks
 *    an amount for somebody who was already being specific.
 */
export function parseDeposit(asked: string | number | undefined): number | undefined {
  if (asked === undefined || asked === "") return undefined;
  const credits = typeof asked === "number" ? asked : Number(asked.trim());
  if (!Number.isInteger(credits) || credits < 0 || credits > DEPOSIT_CREDITS_MAX) {
    throw new NmtsError(
      `--deposit takes a whole number of credits from 0 to ${DEPOSIT_CREDITS_MAX}, not "${String(asked)}".`,
      {
        exitCode: 2,
        nextStep:
          `Nothing was sent and nothing was charged. Leave --deposit off to use this account's ` +
          `default (\`${BINARY_NAME} deposit\` prints it).`,
      },
    );
  }
  return credits;
}

/** The account's own default: what the sealed list holds, or `DEPOSIT_CREDITS_DEFAULT`. */
export function depositDefaultOf(settings: AccountSettings | undefined): number {
  const held = settings?.depositDefault;
  return typeof held === "number" && Number.isInteger(held) && held >= 0 && held <= DEPOSIT_CREDITS_MAX
    ? held
    : DEPOSIT_CREDITS_DEFAULT;
}

/** ⛔ The wallet buys its own storage, so there is no treasury deposit to set aside against it. */
export function refuseDepositWithWallet(asked: string | number | undefined): void {
  if (asked === undefined || asked === "") return;
  throw new NmtsError("--deposit only applies when credits pay: the wallet buys its own storage.", {
    exitCode: 2,
    nextStep: `Nothing was sent. Leave --pay wallet off to pay with credits and set a deposit aside.`,
  });
}

/**
 * What the price says about the deposit, under the line that names the credits.
 *
 * ⚠ ONE SENTENCE FOR 0 AND NONE OF THE USUAL HEDGING. It is the one answer whose cost lands later
 *   and somewhere else — on a release, out of the balance — so it is said where the choice shows.
 *
 * `files` is how many files this run puts the deposit on: absent for one file, a count for a
 * directory, where the number set aside is per file and the total is what the balance must cover.
 */
export function depositLines(credits: number, files?: number): string[] {
  if (credits === 0) {
    return [`  no deposit — a release costs twice the fee from your balance`];
  }
  const each = `${credits} credit${credits === 1 ? "" : "s"}`;
  const set =
    files === undefined || files === 1
      ? `  ${each} set aside as a deposit`
      : `  ${each} set aside as a deposit on each of them (${credits * files} in all)`;
  return [`${set}, back when the storage period ends`];
}
