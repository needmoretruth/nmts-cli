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

import { ServerError } from "../api.ts";
import { requireConsent } from "../consent.ts";
import { loadCrypto } from "../crypto.ts";
import { NmtsError } from "../errors.ts";
import { BINARY_NAME } from "../product.ts";
import { codeNumber, publicCodeRefusal } from "../public-code-refusals.ts";
import { openSession, type Session } from "../session.ts";
import { addressFromTyped } from "../share.ts";
import { receivedShares, removeShare, sendShare, shareableFileAt, type ReceivedShare, type ShareAccount } from "../sharing.ts";

export interface ShareOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  /** `--yes`: the per-attempt answer `share` needs in normal mode (see `share`). */
  yes?: boolean;
  /** `--as <n>`: which live public code sends. Absent = the lowest-numbered live one. */
  as?: string | undefined;
  write?: (line: string) => void;
}

export function out(options: ShareOptions): (line: string) => void {
  return options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
}

/**
 * The session as the share doors take it. ⛔ No account proof: an API key is asked for a live
 * human check on the sending doors, and the commands send exactly what they sent before.
 */
export function shareAccountOf(session: Session, network = session.network): ShareAccount {
  return { server: session.server, bearer: session.apiKey, code: session.code, accountId: session.accountId, network };
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
  const sendAs = options.as === undefined ? undefined : codeNumber(options.as, "--as");
  const crypt = await loadCrypto();
  // ⛔ BEFORE ANYTHING ELSE, AND BEFORE THE NETWORK. A typo caught here costs nothing; a typo sent
  //    to the recipient lookup asks the server a question about an account that is not ours to ask.
  const recipientAddress = addressFromTyped(crypt, typedAddress);

  const session = await openSession({ server: options.server, network: options.network });
  const account = shareAccountOf(session);
  const file = await shareableFileAt(account, target);

  // ⛔ ASKED AFTER THE FILE IS KNOWN AND BEFORE ANYTHING LEAVES, so the question names a real file.
  requireConsent("share");
  // ⭐ AND ASKED EVERY TIME (2026-09-05): the once-per-machine unlock above says sharing is
  //    allowed at all; `--yes` says THIS file to THIS address. A high act, so the tier gate
  //    takes the yes in every mode but skip-permissions, where it hands `--yes` in.
  if (options.yes !== true) {
    const from = sendAs === undefined ? "" : `, from public code #${sendAs}`;
    say(`Would share "${file.path}" with ${typedAddress}${from}.`);
    say(``);
    say(`⛔ Withdrawing later does not recall it — once the recipient has opened it, they have it.`);
    const as = sendAs === undefined ? "" : ` --as ${sendAs}`;
    say(`Nothing was shared. To go ahead:  ${BINARY_NAME} share ${JSON.stringify(target)} ${typedAddress}${as} --yes`);
    say(`⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`);
    return 5;
  }

  try {
    // ⛔ A SHARE NEEDS A LIVE CODE TO COME FROM. The first one publishes the next number; a
    //    later one sends from the lowest-numbered live code unless `--as` names another.
    const quiet = options.json === true;
    const sent = await sendShare(account, file, recipientAddress, {
      as: sendAs,
      onFirstCode: () => {
        if (!quiet) say(`  publishing this account's public code for the first time`);
      },
    });
    if (options.json) {
      say(JSON.stringify({ id: sent.id, name: sent.name, recipient: sent.recipient, fromIndex: sent.fromIndex }));
      return 0;
    }
    say(`${sent.name}  →  ${sent.recipient}`);
    say(``);
    say(`  They can download it from now on. Withdrawing the share stops further downloads`);
    say(`  and cannot reach a copy they have already taken.`);
    return 0;
  } catch (error) {
    if (error instanceof ServerError && error.code === "PUBLIC_CODE_REVOKED") throw publicCodeRefusal(error);
    if (error instanceof ServerError && error.status === 403) {
      throw new NmtsError(error.message, {
        exitCode: 3,
        nextStep:
          "This account's key is not allowed to do this. Sharing asks for the strongest evidence " +
          `the server holds that a person was recently here — run \`${BINARY_NAME} verify\` and try again.`,
      });
    }
    throw error;
  }
}

/** `nmts shares` — what was shared with this account, and what it shared. */
export async function shares(options: ShareOptions = {}): Promise<number> {
  const say = out(options);
  const session = await openSession({ server: options.server, network: options.network });
  const received = await receivedShares(shareAccountOf(session));
  const opened = received.shares;
  // ⚠ WHICH CODE IT CAME TO is said once any row came to a code other than 0: for an account
  //   that has only ever received with one, the line would say nothing.
  const toCode = opened.some((o) => o.toIndex !== 0) ? (o: ReceivedShare) => `#${o.toIndex}  ${o.toCode}` : null;

  if (options.json) {
    say(
      JSON.stringify({
        received: opened.map((o) => ({
          id: o.id,
          name: o.name,
          size: o.size,
          sender: o.sender,
          senderRevoked: o.senderRevoked,
          toIndex: o.toIndex,
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
    for (const one of opened) printRow(say, one, toCode);
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
}

function printRow(say: (line: string) => void, one: ReceivedShare, toCode: ((o: ReceivedShare) => string) | null): void {
  if (one.problem !== null) {
    say(`  ${one.id}  (will not open: ${one.problem})`);
    return;
  }
  const size = one.size === null ? "" : `  ${one.size} bytes`;
  say(`  ${one.id}  ${one.name ?? ""}${size}`);
  say(`      from ${one.sender ?? ""}${one.senderRevoked ? "  · the sender has revoked this code" : ""}`);
  if (toCode !== null) say(`      to ${toCode(one)}`);
}

export async function unshare(id: string | undefined, options: ShareOptions = {}): Promise<number> {
  const say = out(options);
  if (id === undefined || id === "") {
    throw new NmtsError("Say which share to remove.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} unshare <id>\` — the id \`${BINARY_NAME} shares\` prints.`,
    });
  }
  const session = await openSession({ server: options.server, network: options.network });
  await removeShare(shareAccountOf(session), id);
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
