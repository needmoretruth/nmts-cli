// `nmts trial` — this week's free trial: what is left of it, and asking for a place.
//
// ⛔ THE RULES ARE THE SERVER'S AND THIS COMMAND ONLY REPORTS THEM. One application per account
//    per ISO week, first come first served against a budget the server decides weekly. There is
//    no flag here that asks for more, no retry loop that waits for a place to open, and no way to
//    name an amount — a place is what the week says it is. Every refusal below is passed on as
//    the server's answer with the remedy named, never worked around.
//
// ⛔ ASKING IS A SEPARATE WORD FROM LOOKING. `nmts trial` reads and takes nothing; `nmts trial
//    apply` spends this account's one chance for the week. A command that applied because it was
//    run would spend that chance for somebody who wanted to know how many places were left.
//
// ⛔ IT NEEDS A PERSON'S CHECK, AND SAYS SO INSTEAD OF REPORTING A BARE REFUSAL. Both routes are
//    open to an API key only while somebody has passed the account's human check inside the last
//    four of the server's weeks. The server decides scope before it looks at that check, so a
//    caller can be told "the key was not given permission" when what is actually missing is a
//    person — which sends an agent to make another key, the one thing that cannot help. So the
//    standing check is asked about first, and the answer names `nmts verify`.
//
// ⛔ AND APPLYING ASKS FOR SOMETHING THIS TOOL CANNOT PRODUCE. `POST /v1/trial/apply` runs a
//    fresh browser check of its own on every application — it is the one request in this API that
//    hands out credits, so the check is made per application rather than once per session. A
//    command line has no browser and no token, so on any deployment configured with that check
//    the application is refused however good the credentials are. That is reported as what it is,
//    with the place a person can apply from, rather than as a credential problem. `nmts verify`
//    is a DIFFERENT check and does not stand in for this one.

import { request, ServerError } from "../api.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { askAPersonToVerify, humanCheck } from "../human-check.ts";
import { BINARY_NAME, HOME_URL } from "../product.ts";
import { resolveServer } from "../server.ts";
import { requireApiKey } from "../session.ts";
import { humanSize } from "../units.ts";
import { CREDIT_BYTES } from "../upload-price.ts";

/** The one word this command takes, and what it costs. */
const APPLY = "apply";

export interface TrialOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
}

/** This week's state, as the server reports it. */
interface Week {
  live: boolean;
  round: string;
  computed: boolean;
  winners: number;
  creditsPerWinner: number;
  slotsLeft: number;
  already: boolean;
  held: boolean;
}

export async function trial(action: string | undefined, options: TrialOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (action !== undefined && action !== "" && action !== APPLY) {
    throw new NmtsError(`\`${BINARY_NAME} trial\` takes nothing, or \`${APPLY}\`.`, {
      exitCode: 2,
      nextStep:
        `\`${BINARY_NAME} trial\` says what is left of this week. \`${BINARY_NAME} trial ${APPLY}\` ` +
        `asks for a place, which an account may do once a week.`,
    });
  }
  const apiKey = requireApiKey();
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);

  const check = await humanCheck(server, apiKey);
  if (!check.live) throw askAPersonToVerify("The free trial cannot be read or applied for");

  const week = readWeek(await request(server, "/v1/trial", { token: apiKey }));

  if (action !== APPLY) {
    if (options.json === true) {
      say(JSON.stringify(asJson(week)));
      return 0;
    }
    sayWeek(say, week);
    sayRules(say);
    if (week.live && !week.already && !week.held && week.slotsLeft > 0) {
      say(``);
      say(`  ${BINARY_NAME} trial ${APPLY}`);
    }
    return 0;
  }

  // ⛔ ALREADY IN IS NOT A FAILURE. The account holds the thing the command asks for, so the run
  //    ends at 0 — and it does not send the application, because the answer is already known and
  //    the server would spend a refusal saying so.
  if (week.already) {
    if (options.json === true) {
      say(JSON.stringify({ event: "already", round: week.round }));
      return 0;
    }
    say(`This account already took its place in week ${week.round}.`);
    say(``);
    say(`  One application per account per week, so there is nothing more to ask for until the`);
    say(`  next one. \`${BINARY_NAME} balance\` says what the credits bought.`);
    return 0;
  }

  const granted = await apply(server, apiKey, week);
  if (options.json === true) {
    say(JSON.stringify({ event: "granted", ...granted }));
    return 0;
  }
  say(`Granted: ${granted.credits} credits, in week ${granted.round}.`);
  say(``);
  say(`  They lapse unused at ${granted.expires_at}. One credit is ${humanSize(CREDIT_BYTES)} held`);
  say(`  for one lease period; \`${BINARY_NAME} balance\` says what is left of them.`);
  return 0;
}

/** What a granted application answers with. */
interface Granted {
  credits: number;
  expires_at: string;
  round: string;
}

async function apply(server: string, apiKey: string, week: Week): Promise<Granted> {
  let answer: unknown;
  try {
    // ⚠ AN EMPTY BODY, AND NOT A MISSING ONE. The route reads one field — the browser check's
    //   token — and treats absent and blank alike; sending `{}` is what a tool that always sends
    //   JSON sends, and there is nothing else this end could put in it.
    answer = await request(server, "/v1/trial/apply", { method: "POST", token: apiKey, body: {} });
  } catch (error) {
    throw explain(error, week);
  }
  const credits: unknown = isRecord(answer) ? answer["credits"] : null;
  const expires: unknown = isRecord(answer) ? answer["expires_at"] : null;
  const round: unknown = isRecord(answer) ? answer["round"] : null;
  if (
    typeof credits !== "number" ||
    !Number.isFinite(credits) ||
    typeof expires !== "string" ||
    typeof round !== "string"
  ) {
    throw new NmtsError("The server granted a place and described it in a shape this version cannot read.", {
      exitCode: 1,
      nextStep:
        `The credits are on the account whatever this printed — \`${BINARY_NAME} balance\` reads ` +
        `the ledger. Update this tool.`,
    });
  }
  return { credits, expires_at: expires, round };
}

/**
 * Say what each refusal actually means, and what — if anything — changes it.
 *
 * ⛔ NONE OF THESE IS RETRIED HERE. Two of them (a full week, a lost race) are decided by other
 *    people's applications and a loop would only take the next place from whoever asked next; the
 *    rest are decided by a person or by the operator. An agent that reads "try again" retries;
 *    every message below says what would have to change instead.
 */
function explain(error: unknown, week: Week): unknown {
  if (!(error instanceof ServerError)) return error;
  switch (error.code) {
    // ⚠ ONLY THE REFUSAL, NOT THE OUTAGE. `TURNSTILE_UNAVAILABLE` means the check's verifier
    //   could not be reached, which is a passing condition on the server's side and keeps
    //   `api.ts`'s ordinary handling — telling somebody to go to a browser would send them to a
    //   screen that is refusing for the same reason.
    case "TURNSTILE_FAILED":
      // ⛔ THE ADVICE `api.ts` CARRIES FOR THIS CODE IS THE WRONG ONE HERE, and that is why this
      //    case exists. It says an API key is what waives the check — true for signing in, and
      //    false for this route, which runs its own check on every application no matter what
      //    credential arrived. A caller told to go and make a key would make one and be refused
      //    again.
      return new NmtsError("This server asks every application for a browser check, and a command line has none.", {
        exitCode: 4,
        nextStep:
          `Nothing was taken and this account's place for week ${week.round} is untouched. The ` +
          `check is a puzzle solved in a browser, and it is asked for on every application ` +
          `rather than once, because this is the one request that hands out credits. Apply on ` +
          `the account screen at ` +
          `${HOME_URL} instead. \`${BINARY_NAME} verify\` is a different check and does not stand ` +
          `in for this one.`,
      });
    case "TRIAL_FULL":
      return new NmtsError("Every place in this week is taken.", {
        exitCode: 4,
        nextStep:
          `Places are first come, first served, and the week's budget is decided by the server. ` +
          `Nothing was taken. The next week's places appear when it turns.`,
      });
    case "TRIAL_ALREADY":
      return new NmtsError(`This account already took its place in week ${week.round}.`, {
        exitCode: 4,
        nextStep: `One application per account per week. Nothing was taken.`,
      });
    case "TRIAL_CLOSED":
      return new NmtsError("The free trial is not open on this server.", {
        exitCode: 4,
        nextStep: `Nothing was taken. Whether it runs at all is the operator's decision, not a setting here.`,
      });
    case "TRIAL_HELD":
      return new NmtsError("Applications are paused.", {
        exitCode: 4,
        nextStep:
          `An unusually large wave of applications is being looked at, and they stay paused until ` +
          `that is done. Nothing was taken, and this account's place for the week is untouched.`,
      });
    case "TRIAL_LINE_CAPPED":
      return new NmtsError("This internet connection has taken all the places it can today.", {
        exitCode: 4,
        nextStep:
          `Nothing was taken. A day's share per connection is what stops one line sweeping a ` +
          `week. Tomorrow it resets — though this week's places may be gone by then.`,
      });
    default:
      return error;
  }
}

function readWeek(answer: unknown): Week {
  if (!isRecord(answer)) throw brokenAnswer();
  const live = answer["live"];
  const round = answer["round"];
  if (typeof live !== "boolean" || typeof round !== "string") throw brokenAnswer();
  return {
    live,
    round,
    computed: answer["computed"] === true,
    winners: whole(answer["winners"]),
    creditsPerWinner: whole(answer["credits_per_winner"]),
    slotsLeft: whole(answer["slots_left"]),
    already: answer["already"] === true,
    held: answer["held"] === true,
  };
}

/** A count the server sent, or 0. ⚠ 0 and "not decided" are told apart by `computed`, not by this. */
function whole(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function brokenAnswer(): NmtsError {
  return new NmtsError("The server did not describe this week's trial in a shape this version can read.", {
    exitCode: 1,
    nextStep: `Update this tool, or read the account screen at ${HOME_URL}.`,
  });
}

function asJson(week: Week): Record<string, unknown> {
  // The server's own spelling, so a reader that has seen one and then the other is not converting
  // between two names for one number.
  return {
    live: week.live,
    round: week.round,
    computed: week.computed,
    winners: week.winners,
    credits_per_winner: week.creditsPerWinner,
    slots_left: week.slotsLeft,
    already: week.already,
    held: week.held,
  };
}

/**
 * The week, one fact per line.
 *
 * ⛔ "NOT DECIDED YET" IS NOT "NO PLACES". A week with no computed budget row answers zero for
 *    everything, and printing that as "0 places" would be this tool deciding something the server
 *    has not.
 */
function sayWeek(say: (line: string) => void, week: Week): void {
  say(`Free trial · week ${week.round}`);
  say(``);
  if (!week.live) {
    say(`  The trial is not running on this server.`);
    return;
  }
  if (!week.computed) {
    say(`  This week's places have not been decided yet. That is not the same as none.`);
    return;
  }
  say(`  places left        ${week.slotsLeft} of ${week.winners}`);
  say(
    `  one place gives    ${week.creditsPerWinner} credits — ` +
      `${humanSize(week.creditsPerWinner * CREDIT_BYTES)} for one lease period`,
  );
  say(`  this account       ${week.already ? `took its place this week` : `has not applied this week`}`);
  if (week.held) {
    say(``);
    say(`  ⛔ Applications are paused while an unusually large wave of them is looked at.`);
    say(`     A paused week is not a closed one: nothing here is decided against this account.`);
  }
  say(``);
}

/**
 * The rules, printed every time and not only when one bites.
 *
 * ⛔ THEY ARE NOT THIS TOOL'S TO CHANGE, so they are stated where somebody reads them before
 *    applying rather than quoted back as an error afterwards.
 */
function sayRules(say: (line: string) => void): void {
  say(`The rules, which this tool does not set and cannot bend:`);
  say(`  · one application per account per week, on the server's own week boundaries`);
  say(`  · first come, first served — a place goes to whoever asks while one is open`);
  say(`  · the week's budget is decided by the server; there is no way to ask for more`);
}
