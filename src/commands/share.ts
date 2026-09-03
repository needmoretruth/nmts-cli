// `nmts share`, `nmts shares`, `nmts unshare` — giving one file to one other account.
//
// ⛔ THE ADDRESS IS TYPED AND NOT LOOKED UP AGAINST A PERSON. There is no directory, no name, no
//    confirmation that whoever holds an address is who the sender thinks. What stops a typo is the
//    check symbol built into the address, and it is checked on this machine before the server is
//    asked anything — a mistyped address must not become a question about somebody who might exist.
//
// ⛔ WITHDRAWING DOES NOT RECALL. It removes the wrapped key and the download path; a copy already
//    fetched is gone from our reach. Nothing printed here may suggest otherwise.
//
// ⛔ THE CLAIMED SENDER IS PRINTED ONLY AFTER THE ENVELOPE OPENED. Opening it IS the proof of who
//    sent it, so a row that did not open is listed with no sender at all rather than with the name
//    it claims.

import { requireConsent } from "../consent.ts";
import { loadCrypto } from "../crypto.ts";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";
import { request, ServerError } from "../api.ts";
import { openSession } from "../session.ts";
import {
  addressFromTyped,
  identityMatches,
  openReceived,
  sealShare,
  shareKeysOf,
  type OpenedShare,
  type ReceivedRow,
} from "../share.ts";
import { AAD, DERIVED } from "../crypto.ts";

export interface ShareOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
}

function out(options: ShareOptions): (line: string) => void {
  return options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Make sure this account has published the identity other people encrypt to.
 *
 * ⛔ IT IS THE SAME BYTES EVERY TIME. The identity is derived from the account code, so a browser
 *    and this tool publish something identical for one account — which is why publishing from here
 *    cannot claim a different account's place or overwrite anything meaningful.
 */
async function ensurePublished(
  session: { server: string; apiKey: string },
  identity: Uint8Array,
  address: Uint8Array,
  say: (line: string) => void,
  quiet: boolean,
): Promise<void> {
  const seen: unknown = await request(session.server, "/v1/account/share-identity", {
    token: session.apiKey,
  });
  const published =
    typeof seen === "object" && seen !== null && Reflect.get(seen, "published") === true;
  if (published) return;
  if (!quiet) say(`  publishing this account's public code for the first time`);
  await request(session.server, "/v1/account/share-identity", {
    token: session.apiKey,
    method: "PUT",
    body: { share_public_key: b64(identity), share_address: b64(address) },
  });
}

/** `nmts share <path> <address>` — hand one file to one account. */
export async function share(
  target: string | undefined,
  typedAddress: string | undefined,
  options: ShareOptions = {},
): Promise<number> {
  const say = out(options);
  if (target === undefined || target === "" || typedAddress === undefined || typedAddress === "") {
    throw new NmtsError("Say which file, and which public code to share it with.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} share <path> <public-code>\` — the path as \`${BINARY_NAME} ls\` prints it, `
        + `and the code as their \`${BINARY_NAME} public-code\` or account screen prints it.`,
    });
  }
  const crypt = await loadCrypto();
  // ⛔ BEFORE ANYTHING ELSE, AND BEFORE THE NETWORK. A typo caught here costs nothing; a typo sent
  //    to the recipient lookup asks the server a question about an account that is not ours to ask.
  const recipientAddress = addressFromTyped(crypt, typedAddress);

  const session = await openSession({ server: options.server, network: options.network });
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to share.", { exitCode: 4 });
  }
  const index = buildIndex(list.manifest.entries);
  const entry = entryAt(list.manifest.entries, normalisePath(target), {
    nothingHappened: "Nothing was shared.",
  });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`No file at "${fullPathOf(index, entry)}".`, {
      exitCode: 4,
      nextStep: "That is a folder. Nothing was shared — this version shares one file at a time.",
    });
  }
  if (entry.dekWrapped === undefined || entry.contentHashCt === undefined) {
    throw new NmtsError(`The file list holds no ${entry.dekWrapped === undefined ? "key" : "hash"} for "${entry.name}".`, {
      exitCode: 4,
      nextStep:
        "A share carries both — the key that opens the file and the hash the recipient checks the " +
        "bytes against. Nothing was shared.",
    });
  }

  // ⛔ ASKED AFTER THE FILE IS KNOWN AND BEFORE ANYTHING LEAVES, so the question names a real file.
  requireConsent("share");

  const keys = shareKeysOf(crypt, session.code);
  const derived = crypt.kdf_derive(crypt.account_code_parse(session.code));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  let dek: Uint8Array | null = null;
  let digest: Uint8Array | null = null;
  try {
    dek = crypt.envelope_open(
      dataKey,
      new TextEncoder().encode(AAD.dekWrap),
      new Uint8Array(Buffer.from(entry.dekWrapped, "base64url")),
    );
    digest = crypt.envelope_open(
      dataKey,
      new TextEncoder().encode(AAD.contentHash),
      new Uint8Array(Buffer.from(entry.contentHashCt, "base64url")),
    );
    dataKey.fill(0);

    await ensurePublished(session, keys.identity, keys.address, say, options.json === true);

    const answer: unknown = await request(
      session.server,
      `/v1/share-recipients/${encodeURIComponent(b64(recipientAddress))}`,
      { token: session.apiKey },
    );
    const identityB64 =
      typeof answer === "object" && answer !== null ? Reflect.get(answer, "share_public_key") : null;
    if (typeof identityB64 !== "string") {
      throw new NmtsError("That public code has never published an identity to share to.", {
        exitCode: 4,
        nextStep:
          "Nothing was shared. The code may be right and simply unused — somebody has to open " +
          "their account once before anything can be encrypted to them.",
      });
    }
    const recipientIdentity = new Uint8Array(Buffer.from(identityB64, "base64url"));
    // ⛔ CHECKED BEFORE ANYTHING IS ENCRYPTED TO IT. The engine checks it again inside the wrap;
    //    this exists so the refusal names WHICH thing was wrong.
    if (!identityMatches(crypt, recipientIdentity, recipientAddress)) {
      throw new NmtsError("The identity the server returned is not the one that public code names.", {
        exitCode: 1,
        nextStep: "Nothing was shared. Encrypting to it would hand the file to somebody else.",
      });
    }

    const payload = sealShare(crypt, {
      keys,
      recipientIdentity,
      recipientAddress,
      dek,
      itemId: entry.id,
      name: entry.name,
      size: entry.size,
      digest,
    });
    const created: unknown = await request(session.server, "/v1/shares", {
      token: session.apiKey,
      method: "POST",
      body: { item_id: entry.id, recipient_address: b64(recipientAddress), ...payload },
    });
    // ⛔ READ BACK, NOT ECHOED. The server returns the address it actually STORED the share under.
    //    Comparing it is the only way to notice a share that was filed against somebody else.
    const stored =
      typeof created === "object" && created !== null
        ? Reflect.get(created, "recipient_address")
        : null;
    if (typeof stored !== "string" || stored !== b64(recipientAddress)) {
      throw new NmtsError("The server filed this share against a different public code.", {
        exitCode: 1,
        nextStep:
          `Withdraw it now with \`${BINARY_NAME} unshare\` and share it again. The file's key was ` +
          `wrapped for the address you typed, so it is not readable by whoever it was filed under.`,
      });
    }
    const id = typeof created === "object" && created !== null ? Reflect.get(created, "id") : null;
    if (options.json) {
      say(JSON.stringify({ id, name: entry.name, recipient: crypt.share_address_display(recipientAddress) }));
      return 0;
    }
    say(`${entry.name}  →  ${crypt.share_address_display(recipientAddress)}`);
    say(``);
    say(`  They can download it from now on. Withdrawing the share stops further downloads`);
    say(`  and cannot reach a copy they have already taken.`);
    return 0;
  } catch (error) {
    if (error instanceof ServerError && error.status === 403) {
      throw new NmtsError(error.message, {
        exitCode: 3,
        nextStep:
          "This account's key is not allowed to do this. Sharing asks for the strongest evidence " +
          `the server holds that a person was recently here — run \`${BINARY_NAME} verify\` and try again.`,
      });
    }
    throw error;
  } finally {
    dataKey.fill(0);
    dek?.fill(0);
    digest?.fill(0);
    keys.wipe();
  }
}

/** `nmts shares` — what was shared with this account, and what it shared. */
export async function shares(options: ShareOptions = {}): Promise<number> {
  const say = out(options);
  const session = await openSession({ server: options.server, network: options.network });
  const crypt = await loadCrypto();
  const keys = shareKeysOf(crypt, session.code);
  try {
    const received = asReceived(
      await request(session.server, "/v1/shares/received", { token: session.apiKey }),
    );
    const opened = received.rows.map((row) => openReceived(crypt, keys, row));
    for (const one of opened) one.dek?.fill(0);

    if (options.json) {
      say(
        JSON.stringify({
          received: opened.map((o) => ({
            id: o.id,
            name: o.name,
            size: o.size,
            sender: o.sender,
            createdAt: o.createdAt,
            problem: o.problem,
          })),
          total: received.total,
        }),
      );
      return 0;
    }
    if (opened.length === 0) {
      say(`Nothing has been shared with this account.`);
    } else {
      say(`Shared with this account:`);
      for (const one of opened) printRow(say, one);
      // ⛔ SAID OUT LOUD. The listing is bounded, and a person who is not told cannot know that
      //    what they are looking at is not everything.
      if (received.total > opened.length) {
        say(``);
        say(`  ${received.total} in total; this shows ${opened.length}.`);
      }
    }
    say(``);
    say(`  \`${BINARY_NAME} receive <id>\` downloads one. \`${BINARY_NAME} unshare <id>\` removes it`);
    say(`  from this list, which does not touch the sender's own file.`);
    return 0;
  } finally {
    keys.wipe();
  }
}

function printRow(say: (line: string) => void, one: OpenedShare): void {
  if (one.problem !== null) {
    say(`  ${one.id}  (will not open: ${one.problem})`);
    return;
  }
  const size = one.size === null ? "" : `  ${one.size} bytes`;
  say(`  ${one.id}  ${one.name ?? ""}${size}`);
  say(`      from ${one.sender ?? ""}`);
}

/**
 * `nmts shares --sent <path>` — who ONE file was shared with.
 *
 * ⛔ IT IS THE OTHER DIRECTION OF `shares`, NOT A FILTER ON IT. The inbox answers "what can I
 *    download"; this answers "who can download this", which is the only question a person asking
 *    whether to withdraw a share is actually asking. The server keeps the two in different tables
 *    and gives them different routes, and joining them here would invent a view neither has.
 *
 * ⛔ THE ADDRESS IS PRINTED AS THE SERVER STORED IT. There is no name, no directory and nothing to
 *    look one up against — the recipient of a share is an address and nothing else — so a line
 *    that dressed it up as anything friendlier would be inventing an identity.
 *
 * ⚠ IT ONLY READS. Nothing here changes a share, and `unshare <id>` is what takes the id printed
 *   at the end of a line and withdraws it.
 */
export async function sharesSent(
  target: string | undefined,
  options: ShareOptions = {},
): Promise<number> {
  const say = out(options);
  if (target === undefined || target === "") {
    throw new NmtsError("Say which file to look up.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} shares --sent <path>\` — the path as \`${BINARY_NAME} ls\` prints it.`,
    });
  }
  const session = await openSession({ server: options.server, network: options.network });
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to look up.", {
      exitCode: 4,
    });
  }
  const index = buildIndex(list.manifest.entries);
  const entry = entryAt(list.manifest.entries, normalisePath(target), {
    nothingHappened: "Nothing was changed.",
  });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`No file at "${fullPathOf(index, entry)}".`, {
      exitCode: 4,
      nextStep: "That is a folder, and a share is of one file.",
    });
  }
  const path = fullPathOf(index, entry);

  const answer: unknown = await request(
    session.server,
    `/v1/shares/sent?item_id=${encodeURIComponent(entry.id)}`,
    { token: session.apiKey },
  );
  const rows: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, "shares") : null;
  if (!Array.isArray(rows)) {
    throw new NmtsError("The server's answer did not carry a list of shares.", {
      nextStep: "Nothing was changed. Report it rather than retrying — the shape, not the network, is wrong.",
    });
  }

  if (options.json) {
    // ⛔ THE SERVER'S ROWS, UNCHANGED. A reader of this arm is reading the route, and a shape
    //    rewritten here would be a second wire to keep in step with the first.
    say(JSON.stringify({ path, item_id: entry.id, shares: rows }));
    return 0;
  }
  if (rows.length === 0) {
    say(`${path} has not been shared with anyone.`);
    return 0;
  }
  say(`${path} is shared with:`);
  for (const row of rows) say(sentLine(row));
  return 0;
}

/** One row of `GET /v1/shares/sent`, as a person reads it. */
function sentLine(row: unknown): string {
  const at = (name: string): string => {
    const value: unknown = typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined;
    if (typeof value !== "string") {
      throw new NmtsError("The server listed a share this version cannot read.", {
        nextStep: "Nothing was changed. A newer version of this tool may understand it.",
      });
    }
    return value;
  };
  return `${at("recipient_address")}  since ${utcDay(at("created_at"))}  share ${at("id")}`;
}

/** The UTC day of an RFC 3339 instant, `YYYY-MM-DD`. */
function utcDay(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) {
    throw new NmtsError("The server dated a share with something that is not a time.", {
      nextStep: "Nothing was changed. Report it rather than retrying.",
    });
  }
  return at.toISOString().slice(0, 10);
}

/** `nmts unshare <id>` — withdraw a share you sent, or remove one you were sent. */
export async function unshare(id: string | undefined, options: ShareOptions = {}): Promise<number> {
  const say = out(options);
  if (id === undefined || id === "") {
    throw new NmtsError("Say which share to remove.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} unshare <id>\` — the id \`${BINARY_NAME} shares\` prints.`,
    });
  }
  const session = await openSession({ server: options.server, network: options.network });
  await request(session.server, `/v1/shares/${encodeURIComponent(id)}`, {
    token: session.apiKey,
    method: "DELETE",
  });
  if (options.json) {
    say(JSON.stringify({ id, removed: true }));
    return 0;
  }
  say(`Removed ${id}.`);
  say(``);
  say(`  If you sent it, they can no longer download the file — and any copy they already`);
  say(`  took is still theirs. If you received it, the sender's own file is untouched.`);
  return 0;
}

function asReceived(value: unknown): { rows: ReceivedRow[]; total: number } {
  if (typeof value !== "object" || value === null) {
    throw new NmtsError("The server's answer was not an object.");
  }
  const rows: unknown = Reflect.get(value, "shares");
  if (!Array.isArray(rows)) throw new NmtsError("The server did not list any shares.");
  const total: unknown = Reflect.get(value, "total");
  return {
    rows: rows.filter(isRow),
    total: typeof total === "number" ? total : rows.length,
  };
}

function isRow(value: unknown): value is ReceivedRow {
  if (typeof value !== "object" || value === null) return false;
  for (const name of ["id", "item_id", "dek_share_ct", "name_share_ct", "content_hash_share_ct"]) {
    if (typeof Reflect.get(value, name) !== "string") return false;
  }
  return true;
}
