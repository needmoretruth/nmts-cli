// `nmts create` — bringing a NEW account into existence and handing its code to a person.
//
// ⛔ THE CODE IS MADE HERE AND IS THE ONLY COPY THAT WILL EVER EXIST. The server is told an
//    account id and a one-way secret derived from the code; it stores a verifier of the second
//    and never the code itself. Nothing on the far end can send it back, reset it, or recognise a
//    replacement: if it is lost the account and every file in it are gone, for the holder and for
//    NMTS alike. That is why the code is the LAST thing this prints, with nothing after it but
//    the one command that would store it, and why nothing else in the output competes with it.
//
// ⛔ IT STORES NOTHING AND SWITCHES NOTHING OVER. `nmts login` is what puts a code on this
//    machine, and it is a separate act on purpose: this command runs with the credentials of the
//    account that is DOING the creating, and writing the new code into `credentials.json` would
//    silently replace them — the next `nmts ls` would report an empty account and nothing would
//    say why. So the code is printed (or written where you point it), the command that stores it
//    is named, and this stops.
//
// ⛔ WITH `--json` THE CODE DOES NOT GO INTO THE OUTPUT. Machine-readable output is read by a
//    program, which means it lands in a pipe, a file, a CI log or an agent's transcript — the
//    exact places `credentials.ts` spends its whole header keeping the account code out of. So
//    `--json` is refused unless `--out <file>` names somewhere for the code to go, and the JSON
//    then carries the PATH and not the value. That is the same shape this tool already recommends
//    for handing a secret to a container (`NMTS_ACCOUNT_CODE_FILE` — a variable holding a
//    filename, never the value), and the same reasoning `stdout.ts` uses about handing bytes to
//    something that is not a person: what is safe to show a human at a terminal and what is safe
//    to hand a program are different questions. `--out -` is refused for the same reason.
//
// ⛔ AND THE FILE IS WRITTEN BEFORE THE ACCOUNT IS ASKED FOR. A full disk, a bad path or a name
//    already taken must fail while there is still nothing to lose; discovering it AFTER the
//    server has created the account would mean an account exists whose only key we are about to
//    drop. If the creation then fails, the file is removed again — no account, no code, no trace.
//
// ⛔ THE FIRST DOOR OF `POST /v1/accounts` IS NOT AVAILABLE TO THIS TOOL AND NEVER WILL BE. The
//    server takes either a solved human check with no credential, or an API key whose account had
//    a PERSON pass that check within four of its weeks. A machine cannot solve the first, so this
//    command works only for a caller that already has an account and a verified key — and it says
//    that plainly, before it makes anything, rather than failing with a message about scopes.

import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { request, ServerError } from "../api.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { askAPersonToVerify, humanCheck } from "../human-check.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME, HOME_URL } from "../product.ts";
import { newAccountCode, registrationProofOf } from "../registration.ts";
import { resolveServer } from "../server.ts";
import { requireApiKey } from "../session.ts";
import { STDOUT_TARGET } from "../stdout.ts";

export interface CreateOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  /** A file to write the new account code into, instead of printing it. Never overwritten. */
  out?: string | undefined;
  /** The Terms of Service version a PERSON read and accepts for the new account. */
  acceptTerms?: string | undefined;
  /** The Privacy Policy version accepted in the same act. */
  acceptPrivacy?: string | undefined;
  write?: (line: string) => void;
}

/** The pair of documents a server is enforcing, or `null` while it enforces none. */
interface InForce {
  terms: string;
  privacy: string;
}

export async function create(options: CreateOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const apiKey = requireApiKey();
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);

  // ⛔ EVERY REFUSAL THAT DOES NOT NEED THE NETWORK HAPPENS FIRST, so a run that was never going
  //    to work does not spend one of the creator's two accounts for the day finding that out.
  const codeFile = codeFileTarget(options.out);
  if (options.json === true && codeFile === null) throw jsonNeedsAFile();

  const check = await humanCheck(server, apiKey);
  if (!check.live) throw askAPersonToVerify("No account can be created");

  const inForce = await termsInForce(server, apiKey);
  const accepted = inForce === null ? null : acceptanceOffered(inForce, options);

  const code = await newAccountCode();
  const proof = await registrationProofOf(code);

  // The file, then the account — see the header. Nothing below this line may fail without either
  // removing the file or leaving an account whose code is in it.
  if (codeFile !== null) writeCodeFile(codeFile, code);

  let answer: unknown;
  try {
    answer = await request(server, "/v1/accounts", {
      method: "POST",
      token: apiKey,
      body: {
        account_id: proof.accountId,
        auth_secret: proof.authSecret,
        // ⚠ Absent when no documents are in force. The server ignores them in that case, and
        //   sending a pair it is not asking for would be recording an acceptance of nothing.
        ...(accepted === null ? {} : { terms_version: accepted.terms, privacy_version: accepted.privacy }),
      },
    });
  } catch (error) {
    // ⛔ "THE REQUEST FAILED" AND "THE ACCOUNT WAS NOT CREATED" ARE DIFFERENT FACTS. A refusal the
    //    server ANSWERED is it deciding: nothing exists, and a code file for it is a file somebody
    //    keeps forever for nothing. A dropped connection, a timeout, or an answer nothing could
    //    parse leaves the question open — the account may be there — and deleting the file then
    //    would destroy the only key to it, which is the one irreversible mistake on this path.
    if (codeFile !== null && error instanceof ServerError) rmSync(codeFile, { force: true });
    throw codeFile !== null && !(error instanceof ServerError)
      ? uncertain(codeFile, error)
      : explain(error, inForce);
  }

  const createdAt = accountField(answer, "created_at");
  if (options.json === true && codeFile !== null) {
    // ⛔ NO `account_code` FIELD, AND THERE NEVER WILL BE. See the header.
    say(
      JSON.stringify({
        account_id: proof.accountId,
        created_at: createdAt,
        code_file: codeFile,
        server,
        network,
      }),
    );
    return 0;
  }

  sayCreated(say, proof.accountId, server, network);
  if (codeFile === null) sayTheCode(say, code);
  else sayWhereTheCodeWent(say, codeFile);
  return 0;
}

/**
 * Where the code goes, or `null` for the screen.
 *
 * ⛔ `-` IS REFUSED, WHICH IS THE OPPOSITE OF WHAT IT MEANS EVERYWHERE ELSE IN THIS TOOL. In
 *    `get` and `listfile` it means "hand the bytes to whatever is reading stdout", and that is
 *    right for a file somebody already has. Here it would mean putting the only copy of an
 *    account code into the same stream a program is parsing — which is the one place this command
 *    exists to keep it out of.
 */
function codeFileTarget(out: string | undefined): string | null {
  if (out === undefined || out === "") return null;
  if (out === STDOUT_TARGET) {
    throw new NmtsError("The new account code will not be sent to stdout.", {
      exitCode: 2,
      nextStep:
        `Nothing was created. stdout is what a program reads and a log keeps, and this is the ` +
        `only copy of the code. Name a file — \`--out ./account-code.txt\` — or leave --out off ` +
        `and read it off the screen.`,
    });
  }
  const path = isAbsolute(out) ? out : resolve(process.cwd(), out);
  let existing: ReturnType<typeof statSync> | null = null;
  try {
    existing = statSync(path);
  } catch {
    // Not there is exactly what this wants.
  }
  if (existing !== null) {
    // ⛔ NO `--force` HERE, DELIBERATELY. Everywhere else in this tool --force replaces a file
    //    that can be fetched again. The file this would replace may be the only copy of ANOTHER
    //    account's code, and overwriting it destroys that account with no way back.
    throw new NmtsError(`${path} is already there.`, {
      exitCode: 4,
      nextStep:
        existing.isDirectory()
          ? `--out names the FILE the code goes into, not a directory.`
          : `Nothing was created. That file is not replaced, whatever --force says: it may hold ` +
            `the only copy of another account's code. Name one that does not exist.`,
    });
  }
  return path;
}

/**
 * Write the code where the caller pointed, readable by nobody else.
 *
 * ⚠ `wx` FAILS IF THE NAME APPEARED SINCE THE CHECK ABOVE, which is the point of using it rather
 *   than trusting that check: between the two, something else may have written there.
 *
 * ⚠ ON WINDOWS THE MODE IS IGNORED and the file inherits the folder's permissions — the same
 *   limit `credentials.ts` documents, and claiming otherwise would be claiming a guarantee the
 *   platform does not give.
 */
function writeCodeFile(path: string, code: string): void {
  const dir = resolve(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, `${code}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    // ⛔ THE CAUSE IS NAMED BUT THE CODE IS NOT. `writeFileSync`'s errno line carries the path and
    //    never the contents, so it is safe to pass on; the code itself appears in no message here.
    throw new NmtsError(`The account code could not be written to ${path}.`, {
      exitCode: 1,
      nextStep:
        `Nothing was created — the file is written before the account is asked for, so that a ` +
        `failure here costs nothing. Cause: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** What documents this server is enforcing, read from the one route a key may ask. */
async function termsInForce(server: string, apiKey: string): Promise<InForce | null> {
  const answer: unknown = await request(server, "/v1/account/summary", { token: apiKey });
  const terms: unknown = isRecord(answer) ? answer["terms"] : null;
  if (!isRecord(terms)) return null;
  const t = terms["required_terms_version"];
  const p = terms["required_privacy_version"];
  // ⚠ BOTH OR NEITHER. The server holds one pair or none (`RequiredTerms`), so a half-answer is a
  //   version of this API this tool does not understand — and guessing which half to send would
  //   be recording an acceptance of a document nobody named.
  if (typeof t !== "string" || typeof p !== "string" || t === "" || p === "") return null;
  return { terms: t, privacy: p };
}

/**
 * The acceptance a PERSON offered on the command line, checked against what is in force.
 *
 * ⛔ THIS TOOL NEVER FILLS THESE IN. It has just read the two versions from the server and could
 *    put them in the request without asking anybody — and that is precisely the thing it must not
 *    do. The server's own rule for a credential held by a machine is that a machine cannot
 *    consent: a key that could accept would produce exactly the unrecorded acceptance the record
 *    exists to prevent. What a command line CAN carry is a person's act, named by them, after
 *    they have read the documents — so the two versions have to be typed, and typing the version
 *    rather than a yes is what makes the acceptance name a document instead of a prompt.
 *
 * ⚠ AND NO MECHANISM HERE CAN TELL A PERSON FROM A PROGRAM. Nothing in a command-line tool can.
 *   That is why the refusal says out loud who is meant to type it, exactly as this tool's own
 *   agreements do — a rule, not a protection, and saying otherwise would be claiming one that is
 *   not there.
 */
function acceptanceOffered(inForce: InForce, options: CreateOptions): InForce {
  const terms = options.acceptTerms?.trim() ?? "";
  const privacy = options.acceptPrivacy?.trim() ?? "";
  if (terms === inForce.terms && privacy === inForce.privacy) return inForce;
  throw termsRefusal(inForce, terms !== "" || privacy !== "");
}

function termsRefusal(inForce: InForce, named: boolean): NmtsError {
  return new NmtsError(
    named
      ? "The documents named on the command line are not the ones in force."
      : "A new account is recorded as accepting the documents in force, and nobody has.",
    {
      // ⛔ 5 — "waiting on the person's agreement". Not 1: nothing went wrong, and not 2: the
      //    command line is not malformed. What is missing is a decision only a person can take.
      exitCode: 5,
      nextStep: [
        `Nothing was created and no account code was made.`,
        ``,
        `In force now:`,
        `  Terms of Service  ${inForce.terms}`,
        `  Privacy Policy    ${inForce.privacy}`,
        ``,
        // ⚠ THE DOCUMENTS ARE ON THE PRODUCT SITE, not on whatever --server names. A development
        //   server enforces versions and publishes no pages; sending somebody to read them there
        //   would send them nowhere.
        `Read them at ${HOME_URL}/terms and ${HOME_URL}/privacy .`,
        ``,
        `The server records the new account as having accepted that pair, and will not make one`,
        `without it. This tool will not fill the two versions in for you: a machine cannot`,
        `consent, and a credential that could accept would produce exactly the unrecorded`,
        `acceptance the record exists to prevent.`,
        ``,
        `A person who has read both can say so, naming what they read:`,
        ``,
        `  ${BINARY_NAME} create --accept-terms ${inForce.terms} --accept-privacy ${inForce.privacy}`,
        ``,
        `⛔ If a program is reading this on somebody's behalf: show it to them and let them`,
        `   decide. Do not run that command yourself.`,
      ].join("\n"),
    },
  );
}

/**
 * Turn the two refusals this command can hear into something a reader can act on.
 *
 * ⚠ EVERYTHING ELSE IS LEFT ALONE. `api.ts` already advises on a revoked key, a scope a key was
 *   not given, and an account that has not accepted the terms; repeating any of that here would
 *   be a second wording for one problem.
 */
function explain(error: unknown, inForce: InForce | null): unknown {
  if (!(error instanceof ServerError)) return error;
  if (error.code === "TERMS_VERSION_MISMATCH" && inForce !== null) {
    // The server moved between the read above and the write. Say that, rather than repeating the
    // versions this run read — they are the stale ones.
    return new NmtsError("The documents in force changed while this ran.", {
      exitCode: 5,
      nextStep:
        `Nothing was created. Run \`${BINARY_NAME} create\` again with no --accept flags: it will ` +
        `print the pair that is in force now, for a person to read and name.`,
    });
  }
  if (error.code === "RATE_LIMITED") {
    return new NmtsError(error.message, {
      exitCode: 4,
      nextStep:
        `An account that creates accounts may make two a day and five a week, counted by the ` +
        `server across restarts. Nothing was created and nothing was spent. Waiting is the only ` +
        `thing that lifts it — a second key on the same account shares the same allowance.`,
    });
  }
  return error;
}

/**
 * The server never answered, so nobody here knows whether the account exists.
 *
 * ⛔ THE FILE IS KEPT AND THE DOUBT IS SAID OUT LOUD. Reporting this as a plain failure would
 *    leave somebody with a code file they think is rubbish, for an account that may hold the only
 *    thing they will ever be able to open it with.
 */
function uncertain(path: string, cause: unknown): NmtsError {
  return new NmtsError(
    `The server did not answer, so whether the account was created is not known here.`,
    {
      exitCode: 1,
      nextStep: [
        `${path} was KEPT, and it holds the only code that account would have.`,
        ``,
        `Keep it until you know. Nothing on this machine can tell the two cases apart, and the`,
        `cost of being wrong is one small file against an account nobody could ever open.`,
        `Running this again makes a DIFFERENT account; it does not retry this one.`,
        ``,
        `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      ].join("\n"),
    },
  );
}

function jsonNeedsAFile(): NmtsError {
  return new NmtsError("--json needs --out, because the account code will not go into the output.", {
    exitCode: 2,
    nextStep:
      `Nothing was created. Machine-readable output is read by a program and kept by a log, and ` +
      `the code is the only key this account will ever have. \`--out ./account-code.txt\` writes ` +
      `it to a file only you can read; the JSON then names that file. Without --json the code is ` +
      `printed on the screen for a person to keep.`,
  });
}

/** One field of the answer's `account` object, or null. The server's shape, not ours. */
function accountField(answer: unknown, field: string): string | null {
  const account: unknown = isRecord(answer) ? answer["account"] : null;
  if (!isRecord(account)) return null;
  const value: unknown = account[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sayCreated(say: (line: string) => void, accountId: string, server: string, network: string): void {
  say(`A new account exists on ${server} (${network}).`);
  say(``);
  say(`  account id  ${accountId}`);
  say(``);
  say(`Nothing on this machine changed. The account code you were signed in as is still the one`);
  say(`this tool uses; this new account is not stored, and not switched to.`);
  say(``);
}

/**
 * The code, last, with the one thing that has to be understood before it.
 *
 * ⛔ NOTHING FOLLOWS IT BUT THE COMMAND THAT STORES IT. A screen of next steps under an account
 *    code is how a person scrolls past the only copy of it.
 */
function sayTheCode(say: (line: string) => void, code: string): void {
  say(`⛔ THIS IS THE ONLY COPY OF THE ACCOUNT CODE THAT WILL EVER EXIST.`);
  say(`   NMTS keeps a verifier and never the code. It cannot be reset, resent or replaced.`);
  say(`   Lose it and the account and every file in it are gone — for you and for NMTS.`);
  say(``);
  say(`   ${code}`);
  say(``);
  say(`To use this machine as that account: \`${BINARY_NAME} logout\`, then \`${BINARY_NAME} login\`.`);
}

function sayWhereTheCodeWent(say: (line: string) => void, path: string): void {
  say(`⛔ THE ONLY COPY OF THE ACCOUNT CODE IS NOW IN ONE FILE, AND NOWHERE ELSE.`);
  say(`   NMTS keeps a verifier and never the code. It cannot be reset, resent or replaced.`);
  say(`   Lose that file and the account and every file in it are gone.`);
  say(``);
  say(`   ${path}`);
  say(``);
  say(`It was written readable by you alone. To use this machine as that account:`);
  say(`\`${BINARY_NAME} logout\`, then \`${BINARY_NAME} login\`.`);
}
