// `nmts credits transfer --to <account-id> <credits>` — move credits to another account of the
// same family.
//
// ⛔ THE FAMILY IS THE WHOLE RANGE, AND THIS COMMAND CANNOT WIDEN IT. A family is the account a
//    person made and every account under it; the server refuses anything else and answers an
//    account that does not exist exactly the same way, so nothing here can be used to find out
//    which account identifiers are real. There is no price, no fee and no third party — this is
//    not a market, and it does not reopen what "credits cannot be transferred" was written for.
//
// ⛔ WHY IT EXISTS. The free trial, the human check and the ceilings belong to the whole family:
//    one week's place for the tree, not one each. Without a way to move credits that place lands
//    on ONE account and the account that needs it cannot be given it.
//
// ⛔ IT ASKS ABOUT THE PERSON'S CHECK FIRST, for the reason `commands/trial.ts` sets out at
//    length: the server decides scope before it looks at the check, so a caller can be told "the
//    key was not given permission" when what is actually missing is a person — which sends an
//    agent off making another key, the one remedy that cannot help.
//
// ⚠ NOTHING IS RETRIED HERE. Every refusal this can meet is decided by the request itself (name
//   another account, send less, send some), and `api.ts` already carries the advice for each.

import { request } from "../api.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { askAPersonToVerify, humanCheck } from "../human-check.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveServer } from "../server.ts";
import { requireApiKey } from "../session.ts";

/** The one word this command takes. */
const TRANSFER = "transfer";

export interface CreditsOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  /** `--to`: which account receives, base64url, as `nmts whoami` prints it for that account. */
  to?: string | undefined;
  write?: (line: string) => void;
}

/** What a completed move answers with — both balances, so neither side has to be read again. */
interface Moved {
  credits: number;
  from_balance: number;
  to_balance: number;
}

export async function credits(
  action: string | undefined,
  amount: string | undefined,
  options: CreditsOptions = {},
): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (action !== TRANSFER) {
    throw new NmtsError(`\`${BINARY_NAME} credits\` takes \`${TRANSFER}\`, and nothing else.`, {
      exitCode: 2,
      nextStep:
        `\`${BINARY_NAME} credits ${TRANSFER} --to <account identifier> <credits>\` moves credits ` +
        `to another account of your own. \`${BINARY_NAME} balance\` is what reads them.`,
    });
  }

  // ⛔ BOTH OPERANDS ARE CHECKED BEFORE THE NETWORK. A missing recipient and an amount nobody
  //    could have meant are command lines to fix, not questions to ask the server — and an amount
  //    clamped into range here would move a number nobody typed.
  const to = (options.to ?? "").trim();
  if (to === "") throw needsTo();
  const moving = parseAmount(amount);

  const apiKey = requireApiKey();
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);

  const check = await humanCheck(server, apiKey);
  if (!check.live) throw askAPersonToVerify("Credits cannot be moved");

  const moved = read(
    await request(server, "/v1/credits/transfer", {
      method: "POST",
      token: apiKey,
      body: { to, credits: moving },
    }),
  );

  if (options.json === true) {
    // The server's own spelling for its three numbers, plus the recipient this run named — so a
    // reader that has seen the wire and then this is not converting between two sets of names.
    say(JSON.stringify({ to, ...moved }));
    return 0;
  }
  say(`Sent ${plural(moved.credits)} to ${to}.`);
  say(``);
  say(`  this account   ${plural(moved.from_balance)}`);
  say(`  that account   ${plural(moved.to_balance)}`);
  say(``);
  say(`  They keep the date they were already going to lapse on: moving credits does not renew`);
  say(`  them. \`${BINARY_NAME} balance\` reads the ledger of whichever account holds the key.`);
  return 0;
}

function plural(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

/** The amount, refused in this command's own words. ⚠ Whole and above zero: the server has its own
 *  code for a transfer of nothing, and this end can say so without spending a request on it. */
function parseAmount(raw: string | undefined): number {
  const n = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new NmtsError(
      `\`${BINARY_NAME} credits ${TRANSFER}\` takes a whole number of credits above zero, not ` +
        `"${raw ?? ""}".`,
      {
        exitCode: 2,
        nextStep:
          `\`${BINARY_NAME} credits ${TRANSFER} --to <account identifier> 5\` moves five. ` +
          `\`${BINARY_NAME} balance\` says how many this account can spend.`,
      },
    );
  }
  return n;
}

function needsTo(): NmtsError {
  return new NmtsError(`\`--to\` is required: it names the account that receives.`, {
    exitCode: 2,
    nextStep:
      `It takes an account identifier — what \`${BINARY_NAME} whoami\` prints for that account, ` +
      `and what the account screen lists for an AI account. It has to be an account of your own ` +
      `family: your account, or one made under it.`,
  });
}

function read(answer: unknown): Moved {
  const credits = isRecord(answer) ? answer["credits"] : null;
  const from = isRecord(answer) ? answer["from_balance"] : null;
  const to = isRecord(answer) ? answer["to_balance"] : null;
  if (typeof credits !== "number" || typeof from !== "number" || typeof to !== "number") {
    throw new NmtsError("The server moved the credits and described it in a shape this version cannot read.", {
      exitCode: 1,
      nextStep:
        `The move happened whatever this printed — \`${BINARY_NAME} balance\` reads the ledger. ` +
        `Update this tool.`,
    });
  }
  return { credits, from_balance: from, to_balance: to };
}
