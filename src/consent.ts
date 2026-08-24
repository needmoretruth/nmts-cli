// What this machine's owner has agreed to, and the few things worth asking about.
//
// ⛔ THE DEFAULT IS SAFE AND NOTHING IS UNREACHABLE. A tool that simply refuses to do a risky
//    thing does not prevent the risky thing — it gets forked, or worked around with a shell
//    script, and then it happens with no warning at all and no record that anybody chose it. So
//    every capability is here; what changes is whether it happens by accident.
//
// ⛔ FIVE KEYS, NOT TWENTY. A tool that asks about everything trains the person to say yes
//    without reading, and then the one question that mattered is the one they clicked through.
//    The bar for a key existing is one of: it cannot be undone · it costs money · it puts the
//    account code somewhere that is not this tool's sealed file. Anything else happens without
//    asking, and the count is written here so that adding a sixth has to be a decision.
//    ⚠ The fifth was added for sharing, which is the first thing this tool can do that hands
//      something to a person who is not the account holder — and the only one whose undo does not
//      undo what already happened.
//
// ⛔ ONCE PER MACHINE, NOT ONCE PER RUN. The record is on disk, so an agent working through fifty
//    files is asked nothing after the first time — which is the whole point of writing it down.
//
// ⚠ WHAT THIS CANNOT DO. Nothing here can tell whether a person or a program typed the grant
//    command; no command-line tool can. What it CAN do is make the risk impossible to miss, put
//    the decision in one obvious place, and keep a dated record of it. The instruction that an
//    agent must not grant these on somebody's behalf is in AGENTS.md, and it is a rule rather
//    than a mechanism. Saying otherwise would be claiming a protection that is not there.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { configDir, modesAreEnforced } from "./credentials.ts";
import { NmtsError } from "./errors.ts";
import { BINARY_NAME, SUPPORT_EMAIL } from "./product.ts";

/** One thing worth stopping for, and everything a person needs to decide about it. */
export interface Consent {
  /** What the tool would do. One line, in the second person. */
  what: string;
  /** What can go wrong. The reason this key exists, said plainly. */
  risk: string;
  /** What is NOT covered, said before it matters rather than after. */
  limit: string;
}

export const CONSENTS = {
  /**
   * Spending the account's credits.
   *
   * Asked once because the price of every single upload is printed anyway — what this covers is
   * the person understanding that this tool can spend at all, which is not obvious from a command
   * called `put`.
   */
  spend: {
    what: "Spend this account's credits on storage.",
    risk:
      "Credits are consumed and are not refundable. Storage is bought on a public network and " +
      "cannot be un-bought. The price of each upload is printed before it happens, and daily " +
      "ceilings apply on the server whatever this machine asks for.",
    limit:
      "This does not cover anything spent from a wallet. That is a separate agreement, and this " +
      "one does not grant it.",
  },
  /**
   * Writing the account code down UNSEALED — in the clear, in this tool's own file.
   *
   * ⛔ THE DEFAULT IS THE SEALED FORM, and this key is what unlocks the other one (owner,
   *    2026-08-23: support storing it, but only behind encryption unless somebody agrees to a
   *    disclaimer). It covers both the ordinary case, where mode 600 is the only protection and
   *    every program running as you can read it, and the worse one, where the filesystem cannot
   *    keep the mode either — a Windows share, some container mounts, a network drive. `login`
   *    prints which of the two this machine is before it asks.
   *
   * ⚠ IT WAS NARROWER UNTIL 2026-08-23, covering only the filesystem case. Nothing had shipped
   *   under the old meaning — the tool is not published — so no grant anywhere means less than
   *   the words above. If it ever does, this needs a new key rather than a wider one: a grant
   *   means what it said on the day it was given.
   */
  "unsafe-code-storage": {
    what: "Store the account code in the clear, unsealed, in this tool's own file.",
    risk:
      "The account code opens every file in this account and derives its wallet. Written in the " +
      "clear it is readable by anything running as you — every agent, every script, every " +
      "backup that copies your home directory, every image layer built from it. Where the " +
      "filesystem cannot keep a file private, it is readable by others as well.",
    limit:
      "There is no recovery from a leaked code: it cannot be changed while it still opens the " +
      "files it opened. The alternatives are the sealed form, which is what `login` does by " +
      "default, and a secret file the code is read from and never copied into.",
  },
  /**
   * Reading the code out of a plain environment variable, or printing one to be set.
   *
   * ⛔ IT IS A DIFFERENT PLACE, NOT A SMALLER VERSION OF THE FILE (owner, 2026-08-23: an agent
   *    must be able to choose this, with the person's agreement). An environment variable leaks
   *    through channels a file does not: `docker inspect` prints the whole environment of a
   *    container, `/proc/<pid>/environ` is readable by the same user for as long as the process
   *    lives, every child process inherits it, and CI systems echo it into logs. A variable that
   *    names a FILE — `NMTS_ACCOUNT_CODE_FILE` — has none of those, which is why it needs no
   *    agreement.
   */
  "plain-env": {
    what: "Use the account code from a plain environment variable, or print one to be set.",
    risk:
      "An environment variable is not private to the program that reads it. `docker inspect` " +
      "prints the entire environment of a container, anything running as you can read " +
      "/proc/<pid>/environ while the process lives, every child process inherits it, and " +
      "continuous-integration systems commonly write it into logs.",
    limit:
      "This covers this tool reading it and printing it. It cannot cover where you put it " +
      "afterwards, and it does not make the variable private. Naming a file instead — " +
      "NMTS_ACCOUNT_CODE_FILE — avoids all of the above and asks for nothing.",
  },
  /**
   * Signing a chain transaction with the wallet the account code derives.
   *
   * Separate from `spend` because it is a different pot of money: credits are a promise this
   * service made, and a wallet holds assets nobody can restore.
   */
  /**
   * Handing a file to another account.
   *
   * ⛔ IT IS HERE BECAUSE THE UNDO DOES NOT UNDO IT. Every other irreversible thing in this tool
   *    costs money or moves the account code; this one gives somebody else a copy of a file, and
   *    taking the share back afterwards stops future downloads and reaches nothing already
   *    fetched. That gap is not a flaw to be fixed later — it is what handing somebody a file
   *    means — so it is said before the first share rather than after it.
   */
  share: {
    what: "Give another account the key to one of this account's files.",
    risk:
      "Whoever holds that address can then download the file. Withdrawing the share stops further " +
      "downloads and cannot reach a copy they already have. The address is typed by you and is " +
      "not checked against a person — a share sent to the wrong address is sent.",
    limit:
      "This does not cover uploading, spending, or anything to do with a wallet. It covers giving " +
      "away files this account already holds.",
  },
  wallet: {
    what: "Use the wallet this account code derives, and sign transactions with it.",
    risk:
      "A signed transaction moves real assets and cannot be reversed by anybody, including NMTS. " +
      "A mistake here is permanent.",
    limit:
      "Only what this tool signs. Handing the account code to another program gives that program " +
      "the same wallet, and nothing here can see that happen.",
  },
} as const satisfies Record<string, Consent>;

export type ConsentKey = keyof typeof CONSENTS;

/**
 * ⛔ DERIVED FROM THE TABLE, so a key added above cannot be missing from the checks below.
 *    Written as `Object.keys` of the table rather than a hand-kept array: a hand-kept one goes
 *    stale silently, and the failure is a capability nobody is ever asked about.
 */
export const CONSENT_KEYS = Object.keys(CONSENTS) as ConsentKey[];

interface Record_ {
  grantedAt: string;
  byVersion: string;
}

function path(): string {
  return join(configDir(), "consent.json");
}

function read(): Partial<Record<ConsentKey, Record_>> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Partial<Record<ConsentKey, Record_>>;
  } catch {
    // ⛔ Unreadable counts as NOT granted. The fail-safe direction for "I do not know" is to ask
    //    again — a consent record that switches itself on when it cannot be read is not a record.
    return {};
  }
}

/** When this key was agreed to on this machine, or null. */
export function grantedAt(key: ConsentKey): string | null {
  return read()[key]?.grantedAt ?? null;
}

export function isGranted(key: ConsentKey): boolean {
  return grantedAt(key) !== null;
}

/** Write the grant down, with the date and the version that asked. */
export function grant(key: ConsentKey, version: string, now: Date): void {
  const all = read();
  all[key] = { grantedAt: now.toISOString(), byVersion: version };
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(path(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  if (modesAreEnforced()) chmodSync(path(), 0o600);
}

export function revoke(key: ConsentKey): void {
  const all = read();
  delete all[key];
  if (!existsSync(path()) && Object.keys(all).length === 0) return;
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(path(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Stop unless this has been agreed to, and say exactly what agreeing would mean.
 *
 * ⛔ THE MESSAGE IS THE PRODUCT HERE. It is the only thing standing between somebody and a
 *    decision they cannot take back, so it says what happens, what can go wrong, what is not
 *    covered, and the one command that agrees — in that order, every time.
 */
export function requireConsent(key: ConsentKey): void {
  if (isGranted(key)) return;
  const consent = CONSENTS[key];
  throw new NmtsError(consent.what, {
    exitCode: 5,
    nextStep: [
      consent.risk,
      "",
      consent.limit,
      "",
      `NMTS is not responsible for what is done with this account by any program running on this`,
      `machine, including an AI agent. The published Terms are what govern the service; this is a`,
      `warning, not a substitute for them.`,
      "",
      `To agree, on this machine, once:  ${BINARY_NAME} consent grant ${key}`,
      `To see what has been agreed to:   ${BINARY_NAME} consent`,
      "",
      `⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`,
      `   Do not run the grant command yourself.`,
      "",
      `Something wrong or confusing here? ${SUPPORT_EMAIL}`,
    ].join("\n"),
  });
}
