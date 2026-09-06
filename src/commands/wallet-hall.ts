// `nmts wallet hall` — who has sent the developer a gift, and the one way to be named in that list.
//
// ⛔ THE LIST IS READ OFF A PUBLIC CHAIN, NOT OUT OF AN ACCOUNT. Every gift is a transfer anybody
//    can see on an explorer; the server only groups them by the address that sent them. So reading
//    the hall asks for no account code and signs nothing, and there is no "hide me" — what can be
//    taken off is the NAME, which puts the entry back to a shortened address.
//
// ⛔ A NAME IS PUBLISHED, AND THAT IS WHY IT IS SIGNED. The proof that an address is yours is a
//    signature by that address, so `--name` signs a short message with the wallet this account
//    code derives (`wallet-sign.ts`) and sends the signature. No session, no API key, no account
//    id goes with it — the server is told an address, a name and a signature, and nothing else.
//
// ⛔ THE MESSAGE IS BUILT IN ONE PLACE, `hallMessage` BELOW, because the server rebuilds the same
//    bytes from the fields it was sent and compares. A space added on either side makes every
//    signature invalid, and the failure would read as a rejected signature rather than as a typo.

import { request, ServerError, HttpError } from "../api.ts";
import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { BINARY_NAME, HOME_URL } from "../product.ts";
import { resolveServer } from "../server.ts";
import { coinAmount, walletAddress } from "../wallet.ts";
import type { SignMessage } from "../wallet-sign.ts";

/** How many rows a terminal gets. The page at the site carries the rest. */
const SHOWN = 10;

export interface WalletHallOptions {
  server?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  /** `--name`: be listed under this. `--remove`: go back to a shortened address. */
  name?: string | undefined;
  remove?: boolean;
  /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. It exists so a test never signs for real. */
  sign?: SignMessage;
}

/** One row of the hall, as this tool needs it. Amounts are base units, exactly as they arrived. */
export interface HallEntry {
  rank: number;
  label: string;
  wal: bigint;
  sui: bigint;
}

export interface Hall {
  developerLabel: string;
  developerAddress: string;
  /** The day the SUI/WAL comparison rate was measured, as the server states it. */
  measuredOn: string;
  entries: HallEntry[];
}

/**
 * The bytes both sides sign and check, spelled once.
 *
 * ⛔ EXPORTED SO A TEST CAN HOLD IT. What makes this right is not that it looks right but that the
 *    server builds the same four lines; a test that rebuilt them from this function would only
 *    prove the function agrees with itself, so the test writes the four lines out by hand.
 */
export function hallMessage(address: string, name: string | null, issuedAt: string): string {
  return `NMTS hall of fame\naddress: ${address}\nname: ${name ?? "(none)"}\nat: ${issuedAt}`;
}

/** Base units as the server sends them: a decimal string, because a JSON number would round it. */
function baseUnits(value: unknown, field: string): bigint {
  if (typeof value === "string" && /^[0-9]+$/u.test(value)) return BigInt(value);
  throw new NmtsError(`The server's hall answer carries a ${field} this version cannot read.`, { exitCode: 1 });
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asHall(value: unknown): Hall {
  if (!isRecord(value)) throw new NmtsError("The server's hall answer is not the shape this version reads.", { exitCode: 1 });
  const developer = value["developer"];
  const rate = value["referenceRate"];
  const rows = value["entries"];
  const entries: HallEntry[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isRecord(row)) continue;
    const rank = row["rank"];
    entries.push({
      rank: typeof rank === "number" ? rank : entries.length + 1,
      label: text(row["label"]),
      wal: baseUnits(row["wal"], "WAL amount"),
      sui: baseUnits(row["sui"], "SUI amount"),
    });
  }
  return {
    developerLabel: isRecord(developer) ? text(developer["label"]) : "",
    developerAddress: isRecord(developer) ? text(developer["address"]) : "",
    measuredOn: isRecord(rate) ? text(rate["measuredOn"]) : "",
    entries,
  };
}

/**
 * What the server refused, in one sentence a person or an agent can act on.
 *
 * ⛔ BY CODE, NEVER BY MESSAGE. The server's own words may be rewritten any day; the codes are the
 *    contract. A code this version does not know falls through to the server's own sentence rather
 *    than to a guess.
 */
const REFUSALS: Readonly<Record<string, { line: string; exitCode: number; nextStep: string | null }>> = {
  gift_not_found: {
    line: "Your gift is not in the list yet. It appears within an hour; try again then.",
    exitCode: 4,
    nextStep: "Nothing was published. The gift itself is on the chain either way.",
  },
  name_invalid: {
    line: "A name is 1 to 24 characters, no links, not an address.",
    exitCode: 2,
    nextStep: "Nothing was published. Choose another name and run the same command again.",
  },
  listing_stale: {
    line: "A newer listing request exists; try again.",
    exitCode: 4,
    nextStep: "Nothing was published. Something else set this address's name after this run started.",
  },
  signature_invalid: {
    line: "The server did not accept the signature.",
    exitCode: 1,
    nextStep: `Nothing was published. \`${BINARY_NAME} wallet address\` shows the wallet this run signs as.`,
  },
};

/** The server the sealed sign-in points at, when there is one this run can read. */
function storedServer(): string | undefined {
  try {
    return readCredentialsFile()?.server;
  } catch {
    // A sign-in file this run cannot open is no reason to refuse a public listing: the default
    // server answers it. Every command that actually needs that file still reports what is wrong.
    return undefined;
  }
}

export async function walletHall(options: WalletHallOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const server = resolveServer(options.server ?? storedServer());
  if (options.name !== undefined && options.remove === true) {
    throw new NmtsError("Say one of --name and --remove, not both.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} wallet hall --name <name>\` lists a name; \`--remove\` takes it off.`,
    });
  }
  if (options.name === undefined && options.remove !== true) return await show(server, say, options);
  return await setName(server, say, options);
}

/** `nmts wallet hall` — the developer, the top rows, and where the rest of them are. */
async function show(server: string, say: (line: string) => void, options: WalletHallOptions): Promise<number> {
  const answer = await readHall(server);
  if (!answer.mounted) {
    if (options.json === true) say(JSON.stringify({ entries: [] }));
    else say(`No gift has arrived yet.`);
    return 0;
  }
  if (options.json === true) {
    say(JSON.stringify(answer.body));
    return 0;
  }
  const hall = asHall(answer.body);
  say(`Hall of fame — everyone who sent the developer a gift`);
  say(`  ${hall.developerLabel} — builds NMTS`);
  say(`  ${hall.developerAddress}`);
  say(``);
  if (hall.entries.length === 0) {
    say(`  No gift has arrived yet.`);
    return 0;
  }
  const shown = hall.entries.slice(0, SHOWN).map((row) => ({ ...row, walText: coinAmount(row.wal), suiText: coinAmount(row.sui) }));
  // ⛔ THE AMOUNTS ARE RIGHT-ALIGNED AND NEVER SHORTENED. `coinAmount` prints the exact value, so
  //    the columns are as wide as the widest row rather than rounded to fit.
  const label = Math.max(...shown.map((row) => row.label.length));
  const wal = Math.max(...shown.map((row) => row.walText.length));
  const sui = Math.max(...shown.map((row) => row.suiText.length));
  for (const row of shown) {
    say(`  ${String(row.rank).padStart(3)}. ${row.label.padEnd(label)}  ${row.walText.padStart(wal)} WAL  ${row.suiText.padStart(sui)} SUI`);
  }
  const rest = hall.entries.length - shown.length;
  say(``);
  if (rest > 0) say(`  ${rest} more ${rest === 1 ? "entry is" : "entries are"} in the list at ${HOME_URL}/hall.`);
  say(`  Ranked by cumulative amount; SUI and WAL are compared at a reference rate measured on ${hall.measuredOn}.`);
  return 0;
}

/**
 * The read itself.
 *
 * ⛔ A 404 IS "NOTHING TO SHOW", NOT A BREAKAGE. The routes are mounted only where the server holds
 *    a gift address, so a server that takes no gifts answers 404 — the same answer the browser
 *    page draws its empty state from. Every other failure is reported as itself.
 */
async function readHall(server: string): Promise<{ mounted: boolean; body: unknown }> {
  try {
    return { mounted: true, body: await request(server, "/v1/gifts/hall") };
  } catch (error) {
    const status = error instanceof HttpError || error instanceof ServerError ? error.status : 0;
    if (status === 404) return { mounted: false, body: null };
    throw error;
  }
}

/** `--name` and `--remove`: sign the message, send it, and say what the hall shows now. */
async function setName(server: string, say: (line: string) => void, options: WalletHallOptions): Promise<number> {
  const resolved = await requireAccountCode();
  // ⛔ The address is derived here rather than taken from a flag: a signature only proves ownership
  //    of the address it was made by, so the two must come from the same account code.
  const address = await walletAddress(resolved.code);
  const name = options.remove === true ? null : (options.name ?? null);
  const issuedAt = new Date(Date.now()).toISOString();
  const message = hallMessage(address, name, issuedAt);
  const sign = options.sign ?? (await import("../wallet-sign.ts")).signMessage;
  const signature = await sign({ code: resolved.code, message });

  let answer: unknown;
  try {
    answer = await request(server, "/v1/gifts/listing", {
      method: "POST",
      body: { address, name, issuedAt, signature },
    });
  } catch (error) {
    const known = error instanceof ServerError ? REFUSALS[error.code] : undefined;
    if (known === undefined) throw error;
    throw new NmtsError(known.line, { exitCode: known.exitCode, nextStep: known.nextStep });
  }

  if (options.json === true) {
    say(JSON.stringify(answer));
    return 0;
  }
  const label = isRecord(answer) ? text(answer["label"]) : "";
  say(`Listed as ${label}`);
  say(``);
  say(`  The hall of fame is at ${HOME_URL}/hall. Run \`${BINARY_NAME} wallet hall --remove\` to go`);
  say(`  back to a shortened address; the gifts themselves stay on the chain either way.`);
  return 0;
}
