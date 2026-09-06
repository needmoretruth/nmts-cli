// `nmts key new` — make this machine's API key from the account code it already holds.
//
// ⛔ WHY IT EXISTS. Setting this tool up took TWO secrets and two places: the account code here,
//    and a key made at a browser — because the only door that minted one wanted a signed-in
//    session as well as the code, and signing in goes through a human check no terminal can pass.
//    So every automated setup began with a person at a screen, and a container that had the code
//    still could not talk to the server. The server now has a door that takes the code alone, and
//    this is the command that knocks on it: one secret in, one working machine out.
//
// ⛔ THE ACCOUNT CODE IS NEVER AN ARGUMENT, and there is no option here that could carry one. It
//    comes from where every other command gets it (`code-access.ts`), so a sealed store is opened
//    the same way and an environment variable asks for the same agreement. What travels is the
//    derived proof, which is what a sign-in sends and what `account-proof.ts` says is safe to
//    send — never the code.
//
// ⛔ AND THERE IS NO MCP TOOL FOR THIS, DELIBERATELY. A key that could mint keys makes revoking
//    one meaningless — revoke it and the program has already made three — and the whole reason
//    the server refuses a key at these doors is that the credential which mints credentials must
//    be the one a person holds. A tool here would hand that back through the side of the surface
//    the server closed. Making a key is a person's act, at a command line.
//
// ⚠ THE KEY STRING IS PRINTED IN EXACTLY ONE PLACE. By default it is written into this machine's
//   credentials file and never shown; `--print` puts it on the screen once, for somebody who has
//   to paste it into another machine. Nothing else here — no confirmation, no error, no --json
//   without --print — carries it.

import { identityOf } from "../account.ts";
import { accountProofFor } from "../account-proof.ts";
import { request } from "../api.ts";
import type { ParsedArgs } from "../args.ts";
import { requireAccountCode } from "../code-access.ts";
import {
  API_KEY_ENV_VAR,
  credentialsPath,
  readCredentialsFile,
  writeCredentials,
} from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME, HOME_URL } from "../product.ts";
import { resolveServer } from "../server.ts";

/**
 * The three permissions a key can carry, by the names the account screen uses for them.
 *
 * ⛔ THE BITS ARE THE SERVER'S AND THEY ARE FROZEN. `api/src/domain/api_key.rs` defines 1, 2 and 4
 *    and the browser mirrors the same three numbers; a fourth would be a new scope, which is a
 *    decision rather than an addition here.
 */
const SCOPE_BITS: Readonly<Record<string, number>> = {
  read: 1,
  write: 2,
  spend: 4,
};

/**
 * What a key gets when nobody says.
 *
 * ⛔ THE SAME DEFAULT THE ACCOUNT SCREEN OFFERS — read only. A default that could write or spend
 *    would mean the narrowest thing anybody types is wider than the narrowest thing they could
 *    have asked for, and the screen and this tool would hand out different credentials for the
 *    same words.
 */
const DEFAULT_SCOPES = "read";

/**
 * How long a key lasts when nobody says.
 *
 * ⚠ A SECOND COPY OF THE SERVER'S `API_KEY_DEFAULT_TTL_SECS` (30 days), and it is a copy because
 *   there is nowhere to read the real one from: the route that reports the account's limits needs
 *   a key, and this is the command that does not have one yet. The server still decides the
 *   ceiling — a longer request is clamped, not refused — so the worst a stale number here does is
 *   ask for the wrong lifetime, which the reply then states.
 */
const DEFAULT_DAYS = 30;

export interface KeyOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Comma-separated permission names: read, write, spend. */
  scopes?: string | undefined;
  /** How many days the key should last. The server clamps at its own ceiling. */
  days?: string | undefined;
  /** Put the key string on the screen as well. A person's act — see the header. */
  print?: boolean;
  json?: boolean;
  write?: (line: string) => void;
}

/** One issued key, as the server describes it. */
interface Issued {
  key: string;
  keyId: string;
  scopes: number;
  expiresAt: string;
}

/**
 * `nmts key <verb>`.
 *
 * ⛔ A VERB AND NOT A BARE COMMAND, because the other verbs a person will look for here — listing
 *    the account's keys, revoking one — are things the server refuses to a key on purpose and
 *    would need the account code re-entered besides. `key` with no verb says which one exists
 *    rather than doing the only one it has, so `nmts key` never turns out to have made something.
 */
export async function key(verb: string | undefined, args: ParsedArgs): Promise<number> {
  if (verb !== "new") {
    throw new NmtsError(
      verb === undefined ? `\`${BINARY_NAME} key\` needs a verb.` : `\`${verb}\` is not a key verb.`,
      {
        exitCode: 2,
        nextStep:
          `The one verb is \`${BINARY_NAME} key new\`, which makes an API key for this machine ` +
          `from the account code it already holds. Listing and revoking keys are done at ` +
          `${HOME_URL}: a key cannot cut another key off, and that is what makes revoking mean ` +
          `something.`,
      },
    );
  }
  return await keyNew({
    server: args.server,
    network: args.network,
    scopes: args.scopes,
    days: args.days,
    print: args.print,
    json: args.json,
  });
}

/** Turn `read,write` into the bitmask the server takes, refusing anything it does not define. */
export function scopeMask(spelled: string): number {
  const names = spelled
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  if (names.length === 0) {
    throw new NmtsError(`--scopes was given nothing to read.`, {
      exitCode: 2,
      nextStep: `Name one or more of: ${Object.keys(SCOPE_BITS).join(", ")}.`,
    });
  }
  let mask = 0;
  for (const name of names) {
    const bit = SCOPE_BITS[name];
    if (bit === undefined) {
      // ⛔ REFUSED, NOT IGNORED. A misspelt permission that was quietly dropped would make a key
      //    narrower than the person believes, and they would find out from a refusal days later
      //    on a machine nobody is watching.
      throw new NmtsError(`\`${name}\` is not a permission a key can carry.`, {
        exitCode: 2,
        nextStep:
          `The three are: read (see what is stored), write (add and remove files), spend ` +
          `(spend credits on storage). A program that uploads needs all three.`,
      });
    }
    mask |= bit;
  }
  return mask;
}

/** The permission names a bitmask stands for, in the order they are defined. */
function scopeNames(mask: number): string[] {
  return Object.entries(SCOPE_BITS)
    .filter(([, bit]) => (mask & bit) !== 0)
    .map(([name]) => name);
}

function wholeDays(given: string | undefined): number {
  if (given === undefined) return DEFAULT_DAYS;
  if (!/^[0-9]+$/u.test(given.trim())) {
    throw new NmtsError(`--days takes a whole number of days.`, { exitCode: 2 });
  }
  const days = Number(given.trim());
  if (days < 1) throw new NmtsError(`--days must be at least 1.`, { exitCode: 2 });
  return days;
}

function asIssued(value: unknown): Issued {
  if (!isRecord(value)) throw new NmtsError("The server's answer was not an object.");
  const key = value["key"];
  const keyId = value["key_id"];
  const scopes = value["scopes"];
  const expiresAt = value["expires_at"];
  if (
    typeof key !== "string" ||
    typeof keyId !== "string" ||
    typeof scopes !== "number" ||
    typeof expiresAt !== "string"
  ) {
    throw new NmtsError("The server described the new key in a shape this version cannot read.", {
      // ⛔ IT NAMES NO PART OF THE ANSWER. Whatever came back may contain the key.
      nextStep:
        `A key may have been made even though this could not read the reply. Check the account ` +
        `screen at ${HOME_URL} and revoke anything you did not mean to keep, then update this ` +
        `tool — \`npm install -g ${BINARY_NAME}\`.`,
    });
  }
  return { key, keyId, scopes, expiresAt };
}

export async function keyNew(options: KeyOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const mask = scopeMask(options.scopes ?? DEFAULT_SCOPES);
  const days = wholeDays(options.days);

  const held = await requireAccountCode();
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  // ⛔ RESOLVED ONLY WHEN THERE IS SOMEWHERE TO WRITE IT. The network is a property of the stored
  //    credential and nothing in this request touches the storage network, so demanding to be
  //    told which one a development server uses — which `resolveNetwork` rightly does — would
  //    refuse a run that was never going to record the answer.
  const network = stored === null ? null : resolveNetwork(server, options.network ?? stored.network);
  const identity = await identityOf(held.code);
  // ⛔ THE PROOF IS BUILT FOR THIS ONE REQUEST AND NOTHING KEEPS IT. `accountProofFor` also asks
  //    for the agreement that covers sending it when the code came from an environment variable.
  const authSecret = await accountProofFor({ code: held.code, source: held.source });

  const issued = asIssued(
    await request(server, "/v1/account/api-keys/by-code", {
      method: "POST",
      body: {
        account_id: identity.accountId,
        auth_secret: authSecret,
        scopes: mask,
        lifetime_days: days,
      },
      // ⛔ NOT REPEATED ON A TIMEOUT. A request that reached the server and died on the way back
      //    has already spent one of the two live keys this account may hold, and a retry would
      //    spend the other — leaving somebody at the cap with two keys they never received.
      retryBudgetMs: 0,
    }),
  );

  // ⛔ THE STORE IS THE ONE THIS TOOL ALREADY HAS, WRITTEN THE ONE WAY IT IS WRITTEN. Whatever
  //    shape the account code is in — sealed or in the clear — is carried through untouched:
  //    this command is about the key, and re-deciding how somebody's code is stored on the way
  //    past is exactly what `login` refuses to do with a key.
  const canStore = stored !== null;
  if (stored !== null && network !== null) {
    writeCredentials({ ...stored, server, network, apiKey: issued.key });
  }

  if (options.json === true) {
    // ⛔ THE KEY IS IN THE JSON ONLY WHEN IT WAS ASKED FOR ON THE SCREEN. A machine-readable
    //    answer goes into logs and into whatever is driving this; the default must not put a
    //    credential there because a caller happened to want a parseable reply.
    const showKey = options.print === true || !canStore;
    say(
      JSON.stringify({
        key_id: issued.keyId,
        scopes: scopeNames(issued.scopes),
        expires_at: issued.expiresAt,
        stored: canStore,
        ...(showKey ? { key: issued.key } : {}),
      }),
    );
    return 0;
  }

  say(`Key ${issued.keyId} made for ${server}${network === null ? "" : ` (${network})`}.`);
  say(`  may       ${scopeNames(issued.scopes).join(", ")}`);
  say(`  stops     ${issued.expiresAt}`);
  say(``);
  if (canStore) {
    say(`  Stored in ${credentialsPath()}, so every command on this machine now uses it.`);
    say(`  Whatever key was there before is no longer used; revoke it at ${HOME_URL} if it is`);
    say(`  running somewhere else.`);
  } else {
    say(`  ⛔ NOTHING WAS STORED. This machine keeps no account code file — the code came from`);
    say(`     the environment — so there is nowhere to put the key. It is printed below because`);
    say(`     this is the only time it exists outside the server's memory.`);
  }
  if (options.print === true || !canStore) {
    say(``);
    say(`  ⚠ The key is the account's credential. Anyone who reads it can do what it may do,`);
    say(`    until it is revoked or it stops. It is about to be on this screen and in this`);
    say(`    terminal's scrollback.`);
    say(``);
    // ⛔ ALONE ON ITS OWN LINE, for the reason `whoami --reveal` says: a line with nothing else
    //    on it is one a person can select without dragging a label into their clipboard.
    say(issued.key);
    say(``);
    say(`  Put it in ${API_KEY_ENV_VAR}, or in a file named by ${API_KEY_ENV_VAR}_FILE — the`);
    say(`  shape a container cannot leak. NMTS keeps no copy: lose it and the way back is to`);
    say(`  revoke it and make another.`);
  }
  return 0;
}
