// `nmts create` with a one-time pass: an agent makes its own account, with no browser.
//
// ⛔ WHY THIS PATH EXISTS (D19g ⑥ · owner 2026-10-01). The other two paths both end at a person:
//    the key path needs an account a person verified, and the link path prints an address a person
//    finishes in a browser. Here the person has ALREADY done their part — they solved the human
//    check on nmts.me/ai and handed the pass to their agent inside a prompt — so this run makes the
//    NMTS key, makes the account with the pass, keeps the key on this machine, makes an API key,
//    and is done.
//
// ⛔ THE PASS COMES FROM THE ENVIRONMENT AND NEVER FROM ARGV. `args.ts` holds that no secret is an
//    option (any process can read another's command line, and the shell records it), and a pass is
//    a live account-making ticket for an hour. `NMTS_AGENT_PASS` is the one way in.
//
// ⛔ THE KEY IS WRITTEN BEFORE THE ACCOUNT IS ASKED FOR — `create.ts`'s rule. A full disk or a
//    folder that cannot be written must fail while there is nothing to lose. A refusal the server
//    ANSWERED means nothing exists, so the file goes again; a request that died on the way back
//    leaves the question open, so the file is KEPT and the doubt is said out loud.
//
// ⛔ IT NEVER REPLACES A KEY THIS MACHINE ALREADY KEEPS. That file may hold the only copy of
//    somebody's account; this run refuses before it spends the pass, and names the folder setting
//    that keeps the new account apart.
//
// ⚠ HOW THE KEY IS KEPT. Sealed under `NMTS_PASSPHRASE` when that is set, the shape `login` uses by
//   default. Without it, in the clear at mode 600 — the same exposure `create --out` has always had
//   for a new key, with no agreement asked, because an unattended agent has nowhere to type a
//   passphrase and a key that is not kept is an account that is lost. Where this filesystem cannot
//   keep the mode, the `unsafe-code-storage` agreement is asked, exactly as `login --plain` asks it.

import { rmSync } from "node:fs";

import { request, ServerError } from "../api.ts";
import { lockCode } from "../code-vault.ts";
import { requireConsent } from "../consent.ts";
import {
  PASSPHRASE_ENV_VAR,
  codeStorageIsPrivate,
  credentialsPath,
  readCredentialsFile,
  writeCredentials,
  type Credentials,
} from "../credentials.ts";
import { AGENT_PASS_ENV_VAR } from "../env-vars.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { BINARY_NAME, HOME_URL } from "../product.ts";
import { newAccountCode, registrationProofOf } from "../registration.ts";

export interface CreatePassOptions {
  server: string;
  network: string;
  /** The pass, as read from `NMTS_AGENT_PASS`. Never from argv. */
  pass: string;
  json?: boolean;
  /** Typed by a PERSON only, as on every create path. A pass usually carries their acceptance. */
  acceptTerms?: string | undefined;
  acceptPrivacy?: string | undefined;
  write?: ((line: string) => void) | undefined;
}

/** read · write · spend — the whole account is the agent's, and so are its credits. */
const KEY_SCOPES = 7;

/**
 * Days asked for. ⚠ The server clamps a request at its own ceiling and answers the date it gave
 * (`api_keys.rs` · `IssueReq::lifetime_days`), so asking for a year is how to get the longest key
 * the server allows without a second copy of its number here.
 */
const KEY_DAYS = 365;

export async function createWithPass(options: CreatePassOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const { server, network } = options;

  // ── Every refusal that needs no network, first ───────────────────────────────────────────
  if (readCredentialsFile() !== null) throw machineIsTaken();
  const passphrase = process.env[PASSPHRASE_ENV_VAR] ?? "";
  if (passphrase === "" && !codeStorageIsPrivate()) requireConsent("unsafe-code-storage");

  // ── The key, kept before the account is asked for ────────────────────────────────────────
  const code = await newAccountCode();
  const proof = await registrationProofOf(code);
  const kept: Credentials = {
    ...(passphrase === "" ? { accountCode: code } : { lockedCode: lockCode(code, passphrase) }),
    server,
    network,
  };
  writeCredentials(kept);

  // ── The account ──────────────────────────────────────────────────────────────────────────
  let answer: unknown;
  try {
    answer = await request(server, "/v1/accounts", {
      method: "POST",
      body: {
        account_id: proof.accountId,
        auth_secret: proof.authSecret,
        agent_pass: options.pass.trim(),
        ...(options.acceptTerms === undefined ? {} : { terms_version: options.acceptTerms }),
        ...(options.acceptPrivacy === undefined ? {} : { privacy_version: options.acceptPrivacy }),
      },
    });
  } catch (error) {
    if (error instanceof ServerError) {
      rmSync(credentialsPath(), { force: true });
      throw explain(error);
    }
    throw uncertain(error);
  }
  const createdAt = field(isRecord(answer) ? answer["account"] : null, "created_at");

  // ── The API key, from the code alone ─────────────────────────────────────────────────────
  // ⚠ A FAILURE HERE DOES NOT UNDO ANYTHING. The account exists and its key is kept; what is
  //   missing is one credential that `nmts key new` makes at any time from the same key.
  let issued: { key: string; keyId: string; expiresAt: string } | null = null;
  let keyError: string | null = null;
  try {
    const reply: unknown = await request(server, "/v1/account/api-keys/by-code", {
      method: "POST",
      body: {
        account_id: proof.accountId,
        auth_secret: proof.authSecret,
        scopes: KEY_SCOPES,
        lifetime_days: KEY_DAYS,
      },
      // ⛔ NOT REPEATED ON A TIMEOUT — `key.ts` says why: a retry can spend the second live key.
      retryBudgetMs: 0,
    });
    const key = field(reply, "key");
    const keyId = field(reply, "key_id");
    const expiresAt = field(reply, "expires_at");
    if (key !== null && keyId !== null && expiresAt !== null) issued = { key, keyId, expiresAt };
    else keyError = "the server described the key in a shape this version cannot read";
  } catch (error) {
    keyError = error instanceof Error ? error.message : String(error);
  }
  if (issued !== null) writeCredentials({ ...kept, apiKey: issued.key });

  if (options.json === true) {
    // ⛔ NO SECRET IN IT: not the NMTS key, not the API key, not the pass.
    say(
      JSON.stringify({
        account_id: proof.accountId,
        created_at: createdAt,
        credentials: credentialsPath(),
        sealed: passphrase !== "",
        server,
        network,
        api_key:
          issued === null ? null : { key_id: issued.keyId, scopes: ["read", "write", "spend"], expires_at: issued.expiresAt },
      }),
    );
    return 0;
  }

  say(`A new account exists on ${server} (${network}).`);
  say(``);
  say(`  account id  ${proof.accountId}`);
  say(``);
  say(`⛔ ITS NMTS KEY IS KEPT IN ONE FILE ON THIS MACHINE, AND NOWHERE ELSE:`);
  say(`   ${credentialsPath()}`);
  say(
    passphrase === ""
      ? `   In the clear, readable by this user alone (mode 600).`
      : `   Sealed under the passphrase in ${PASSPHRASE_ENV_VAR}; opening it needs that passphrase.`,
  );
  say(`   NMTS keeps a verifier and never the NMTS key. It cannot be reset, resent or replaced.`);
  say(`   A person should keep a copy somewhere else.`);
  say(``);
  if (issued !== null) {
    say(`API key ${issued.keyId} made and stored in the same file (read, write, spend; stops ${issued.expiresAt}).`);
  } else {
    say(`⚠ No API key was made: ${keyError ?? "unknown"}.`);
    say(`  \`${BINARY_NAME} key new --scopes read,write,spend\` makes one from the kept NMTS key.`);
  }
  say(``);
  say(`Next:`);
  say(`  ${BINARY_NAME} trial apply      the free trial's credits, if this week has places left`);
  say(`  ${BINARY_NAME} put <file>       store a file`);
  say(`  ${BINARY_NAME} mcp              serve this account to an MCP client (\`${BINARY_NAME} help mcp\`)`);
  return 0;
}

/** One string field of a JSON object the server sent, or null. */
function field(value: unknown, name: string): string | null {
  if (!isRecord(value)) return null;
  const found: unknown = value[name];
  return typeof found === "string" && found.length > 0 ? found : null;
}

function machineIsTaken(): NmtsError {
  return new NmtsError("This machine already keeps an NMTS key, and a new account will not replace it.", {
    exitCode: 4,
    nextStep:
      `Nothing was created and the pass was not spent. ${credentialsPath()} may hold the only copy ` +
      `of that account's NMTS key. To keep the new account apart, run this again with ` +
      `NMTS_CONFIG_DIR set to a new folder, and set it the same way for every later command.`,
  });
}

/** The refusals a pass run can hear, each with what to do about it. */
function explain(error: ServerError): unknown {
  if (error.code === "AGENT_PASS_INVALID") {
    return new NmtsError("The pass did not open the door: it is mistyped, past its hour, or already used.", {
      exitCode: 4,
      nextStep:
        `Nothing was created and nothing was kept here. A pass works once, for sixty minutes. ` +
        `Ask the person for a new one at ${HOME_URL}/ai and put it in ${AGENT_PASS_ENV_VAR}.`,
    });
  }
  if (error.code === "TERMS_VERSION_MISMATCH") {
    return new NmtsError("The documents in force were not accepted for this account.", {
      // 5 — waiting on a person's agreement, as everywhere else in `create`.
      exitCode: 5,
      nextStep:
        `Nothing was created and the pass was not spent. The person who takes a pass on ${HOME_URL}/ai ` +
        `accepts the Terms and the Privacy Policy for the account it makes; this pass carries no ` +
        `acceptance, or the documents changed since it was taken. Ask the person for a new pass.`,
    });
  }
  if (error.code === "ACCOUNT_EXISTS") {
    return new NmtsError("An account with this id already exists.", {
      exitCode: 1,
      nextStep:
        `Nothing was created, and the pass is spent: one pass answers one question about an ` +
        `account. A freshly drawn NMTS key cannot collide by chance, so ask the person for a new pass.`,
    });
  }
  return error;
}

/**
 * The server never answered, so nobody here knows whether the account exists.
 *
 * ⛔ THE FILE IS KEPT AND THE DOUBT IS SAID OUT LOUD — `create.ts`'s `uncertain`, for this path.
 */
function uncertain(cause: unknown): NmtsError {
  return new NmtsError(`The server did not answer, so whether the account was created is not known here.`, {
    exitCode: 1,
    nextStep: [
      `${credentialsPath()} was KEPT, and it holds the only NMTS key that account would have.`,
      ``,
      `\`${BINARY_NAME} whoami\` asks the server about it once it answers again. If the account was`,
      `not made, the pass may still work: run this again after moving that file away.`,
      ``,
      `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
    ].join("\n"),
  });
}
