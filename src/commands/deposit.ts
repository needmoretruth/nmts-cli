// `nmts deposit [<n>]` — how many credits this account sets aside on each credit-paid upload,
// when the upload itself does not say.
//
// ⛔ IT IS A DEFAULT, NOT A CHARGE. Nothing here moves a credit: it records the number `nmts put`
//    and `nmts push` will send with the next upload. What the deposit then does is pay the chain
//    fee of a later operation on that file, measured rather than spent whole, with the remainder
//    returned when the storage period ends.
//
// ⛔ IT LIVES IN THE SEALED FILE LIST, NOT ON THIS MACHINE — the same place, and for the same
//    reasons, as `nmts padding`: the server must not learn it (a per-account default is a small
//    fingerprint a server could keep), and it follows the ACCOUNT, so a phone and a laptop set the
//    same amount aside. That is why reading it costs a list read and setting it costs a list write.
//
// ⚠ AND IT APPLIES TO WHAT IS UPLOADED NEXT. A deposit already set aside on a stored file is that
//   file's, and changing this number does not move it.

import {
  depositDefaultOf,
  DEPOSIT_CREDITS_DEFAULT,
  DEPOSIT_CREDITS_MAX,
  parseDeposit,
} from "../deposit.ts";
import { NmtsError } from "../errors.ts";
import { readFileList } from "../manifest.ts";
import { applyManyToList } from "../manifest-write.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";

export interface DepositOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
}

/** What a file with no deposit pays instead, said wherever 0 is on the screen. */
const WHAT_ZERO_COSTS =
  `A file uploaded with no deposit still releases: it pays twice the same chain fee out of your ` +
  `balance at that moment, and is refused when the balance cannot cover it.`;

export async function deposit(wanted: string | undefined, options: DepositOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  // ⛔ BEFORE THE NETWORK. A number outside the range is a command line to fix, not a question to
  //    ask the server, and clamping it would record an amount nobody typed.
  const asked = parseDepositArgument(wanted);

  const session = await openSession({ server: options.server, network: options.network });

  if (asked === undefined) {
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    const held = list.manifest?.settings?.depositDefault;
    const credits = depositDefaultOf(list.manifest?.settings);
    const chosen = held !== undefined && credits === held;
    if (options.json === true) {
      say(JSON.stringify({ deposit: credits, set: chosen }));
      return 0;
    }
    say(chosen ? `${credits}` : `${DEPOSIT_CREDITS_DEFAULT} (not set)`);
    say(
      credits === 0
        ? `Uploads paid for with credits set no deposit aside. ${WHAT_ZERO_COSTS}`
        : `Uploads paid for with credits set ${credits} credit${credits === 1 ? "" : "s"} aside on ` +
            `each file, back when that file's storage period ends. Anything from 0 to ` +
            `${DEPOSIT_CREDITS_MAX} — \`${BINARY_NAME} deposit <n>\`, or --deposit for one upload.`,
    );
    return 0;
  }

  // ⛔ NO LIST, NO SETTING — the same refusal `padding` makes, for the same reason: the default
  //    lives inside the sealed list, and writing an empty one just to hold a setting would make a
  //    first `ls` say "a list exists" about an account nothing was ever put in.
  const before = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  if (before.manifest === null) {
    throw new NmtsError(
      `This account has no file list yet; the setting lives in the list, and there is nothing to write it into.`,
      { exitCode: 4, nextStep: `Upload once (\`${BINARY_NAME} put\`) and set it after.` },
    );
  }
  const result = await applyManyToList(session, () => [], { depositDefault: asked });

  if (options.json === true) {
    say(JSON.stringify({ deposit: asked, set: true }));
    return 0;
  }
  if (!result.changed) {
    say(`Already ${asked}. Nothing changed.`);
    return 0;
  }
  if (asked === 0) {
    say(`Uploads from now on set no deposit aside. ${WHAT_ZERO_COSTS}`);
    return 0;
  }
  say(
    `Set to ${asked}. It applies to what is uploaded next, from every device; deposits already ` +
      `set aside on stored files are not moved.`,
  );
  return 0;
}

/** The operand, refused in this command's own words rather than the upload flag's. */
function parseDepositArgument(wanted: string | undefined): number | undefined {
  if (wanted === undefined || wanted === "") return undefined;
  try {
    return parseDeposit(wanted);
  } catch {
    throw new NmtsError(
      `\`${BINARY_NAME} deposit\` takes a whole number of credits from 0 to ${DEPOSIT_CREDITS_MAX}, not "${wanted}".`,
      {
        exitCode: 2,
        nextStep: `Run \`${BINARY_NAME} deposit\` with no argument to see what this account sets aside.`,
      },
    );
  }
}
