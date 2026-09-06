// `nmts key list` and `nmts key revoke <id|all>` — the account's keys, seen and cut from a
// terminal that holds the account code.
//
// ⛔ THE CODE, NEVER THE KEY. Both doors here are sessionless and take the account code's derived
//    proof, exactly as `key new` does (`key.ts`). A key is refused by the server on purpose: a key
//    that could list keys hands whoever stole it the owner's whole automation inventory, and a
//    key that could revoke keys could switch every other program off while staying alive. So the
//    credential this command presents is the one thing a key cannot forge, and the server judges
//    it the way it judges a sign-in — same lockout, same cost to guess.
//
// ⛔ REVOKING IS A MEDIUM ACT (`risk.ts` "key.revoke"): the tier gate asks a person once in mode
//    default and lets an auto mode through with --yes, because whatever used that key stops the
//    moment it is cut and there is no way to bring it back — only to make another.

import { identityOf } from "../account.ts";
import { accountProofFor } from "../account-proof.ts";
import { request, ServerError } from "../api.ts";
import type { ParsedArgs } from "../args.ts";
import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { gate } from "../gate.ts";
import { isRecord } from "../guards.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveServer } from "../server.ts";
import { scopeNames } from "./key.ts";

export interface KeyManageOptions {
  server?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  /** Injected in tests: answers the tier gate's y/N. */
  readLine?: ((question: string) => Promise<string>) | undefined;
}

/** One key, as the server lists it. Only what the screen shows is read. */
interface ListedKey {
  key_id: string;
  scopes: number;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  uses: number;
}

function asKeys(value: unknown): ListedKey[] {
  if (!isRecord(value) || !Array.isArray(value["keys"])) {
    throw new NmtsError("The server listed the keys in a shape this version cannot read.", {
      nextStep: `Update this tool — \`npm install -g ${BINARY_NAME}\` — or read them in a browser.`,
    });
  }
  const out: ListedKey[] = [];
  for (const row of value["keys"]) {
    if (!isRecord(row)) continue;
    const id = row["key_id"];
    const scopes = row["scopes"];
    const created = row["created_at"];
    const expires = row["expires_at"];
    if (typeof id !== "string" || typeof scopes !== "number" || typeof created !== "string") continue;
    out.push({
      key_id: id,
      scopes,
      created_at: created,
      expires_at: typeof expires === "string" ? expires : created,
      last_used_at: typeof row["last_used_at"] === "string" ? row["last_used_at"] : null,
      revoked_at: typeof row["revoked_at"] === "string" ? row["revoked_at"] : null,
      uses: typeof row["uses"] === "number" ? row["uses"] : 0,
    });
  }
  return out;
}

/** The account named and proven, the way `key new` names and proves it. */
async function provenAccount(): Promise<{ account_id: string; auth_secret: string }> {
  const held = await requireAccountCode();
  const identity = await identityOf(held.code);
  const authSecret = await accountProofFor({ code: held.code, source: held.source });
  return { account_id: identity.accountId, auth_secret: authSecret };
}

export async function keyList(options: KeyManageOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  const proof = await provenAccount();
  const keys = asKeys(
    await request(server, "/v1/account/api-keys/list-by-code", {
      method: "POST",
      body: proof,
      retryBudgetMs: 0,
    }),
  );
  // The key string on this machine carries its id after the prefix (`nmts_ak1_<id>_<secret>`),
  // so the row that is "this one" is known without the secret ever being compared or printed.
  const mine = stored?.apiKey ?? "";

  if (options.json === true) {
    say(
      JSON.stringify({
        keys: keys.map((k) => ({
          key_id: k.key_id,
          scopes: scopeNames(k.scopes),
          created_at: k.created_at,
          expires_at: k.expires_at,
          last_used_at: k.last_used_at,
          revoked_at: k.revoked_at,
          uses: k.uses,
          this_machine: mine.includes(k.key_id),
        })),
      }),
    );
    return 0;
  }
  if (keys.length === 0) {
    say(`This account has no API keys.`);
    say(``);
    say(`  \`${BINARY_NAME} key new\` makes one for this machine from the account code it holds.`);
    return 0;
  }
  const live = keys.filter((k) => k.revoked_at === null);
  for (const k of keys) {
    say(`${k.key_id}${mine.includes(k.key_id) ? "  ← this machine" : ""}`);
    say(`  may         ${scopeNames(k.scopes).join(", ")}`);
    say(`  made        ${k.created_at}`);
    if (k.revoked_at !== null) {
      say(`  revoked     ${k.revoked_at}`);
    } else {
      say(`  stops       ${k.expires_at}`);
    }
    say(`  last used   ${k.last_used_at ?? "never"}  (${k.uses} ${k.uses === 1 ? "use" : "uses"})`);
  }
  say(``);
  say(`  ${live.length} live of ${keys.length}. The key strings are not here: NMTS keeps no copy of them.`);
  say(`  \`${BINARY_NAME} key revoke <id>\` (or \`all\`) cuts one — whatever uses it stops at once.`);
  return 0;
}

/** `nmts key revoke <id|all>`: the refusals, the tier gate's question, then the proof and the cut. */
export async function keyRevoke(target: string | undefined, args: ParsedArgs, options: KeyManageOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const wanted = (target ?? "").trim();
  if (wanted === "") {
    throw new NmtsError(`\`${BINARY_NAME} key revoke\` needs a key id, or \`all\`.`, {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} key list\` shows the ids.`,
    });
  }
  await gate("key.revoke", args, { write: say, readLine: options.readLine });

  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  const proof = await provenAccount();
  const all = wanted === "all";
  let answered: unknown;
  try {
    answered = await request(server, "/v1/account/api-keys/revoke-by-code", {
      method: "POST",
      body: all ? proof : { ...proof, key_id: wanted },
      retryBudgetMs: 0,
    });
  } catch (error) {
    if (error instanceof ServerError && error.status === 404) {
      throw new NmtsError(`No live key ${wanted} on this account.`, {
        exitCode: 1,
        nextStep: `\`${BINARY_NAME} key list\` shows the ids that exist and which are already revoked.`,
      });
    }
    throw error;
  }
  const revoked = isRecord(answered) && typeof answered["revoked"] === "number" ? answered["revoked"] : null;
  if (options.json === true) {
    say(JSON.stringify({ revoked: revoked ?? (all ? null : 1) }));
    return 0;
  }
  if (all) {
    say(revoked === null ? `Revoked every key.` : `Revoked ${revoked} key${revoked === 1 ? "" : "s"}.`);
  } else {
    say(`Revoked key ${wanted}.`);
  }
  const mine = stored?.apiKey ?? "";
  if (all || mine.includes(wanted)) {
    say(``);
    say(`  The key stored on this machine was among them, so commands that need a key will be`);
    say(`  refused until \`${BINARY_NAME} key new\` makes another.`);
  }
  return 0;
}
