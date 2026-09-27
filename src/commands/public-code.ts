// `nmts public-code` — the value other accounts send files to, and publishing it so they can.
//
// ⛔ IT IS CALLED THE PUBLIC CODE HERE BECAUSE THAT IS WHAT THE PRODUCT CALLS IT. The browser's
//    screens say "public code", and this program used to say "address" for the same value — two
//    names for one thing, which is the mistake a locked wording decision exists to stop. It also
//    printed it in a different encoding than the browser shows, so somebody copying from one and
//    pasting into the other had two ways to be wrong about one value. Both are fixed here: one
//    name, and the same grouped form a person sees on the screen.
//
// ⛔ WHY PUBLISHING IS A SEPARATE STEP AND NOT SOMETHING THIS COMMAND JUST DOES. Sending a file
//    already publishes the sender's code as a side effect, because a share cannot exist without
//    one and the person has already decided to hand something over. RECEIVING is the other way
//    round: nothing has been decided yet, and the record is permanent. So the plain command reads,
//    says whether it can be sent to, and names the flag; `--publish` is the deliberate act.
//
// ⛔ WHAT "PERMANENT" DOES AND DOES NOT MEAN HERE. The record cannot be withdrawn or replaced. It
//    is also not a choice: the code and the identity behind it are derived from the NMTS key,
//    so the same NMTS key produces the same bytes on any device, and the server refuses a
//    bundle whose claimed value is not the fingerprint of its own root. The only way to publish a
//    wrong one is to be holding a different NMTS key. That is worth saying plainly rather than
//    warning vaguely — a warning that cannot be acted on just teaches people to click through.
//
// ⚠ IT IS NOT THE NMTS KEY. That one opens every file in the account and must never be given
//   to anybody; this one is meant to be given away, and on its own it opens nothing.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { request } from "../api.ts";
import { requireAccountCode } from "../code-access.ts";
import { publicCodeFileText } from "../handover.ts";
import { publicCodeFileName } from "../shared/lib/share/handover-format.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { loadCrypto } from "../crypto.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";
import { shareKeysOf } from "../share.ts";

export interface PublicCodeOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Publish it, so other accounts can send to it. Permanent. */
  publish?: boolean;
  /** `--save [file]`: write this account's public code file (NCF-3 §5.7). Asks the server nothing. */
  save?: boolean;
  /** The file `--save` writes; by default `nmts-public-code-<code>.nmtscode` here. */
  file?: string | undefined;
  /** Replace that file if it exists. */
  force?: boolean;
  json?: boolean;
  write?: (line: string) => void;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export async function publicCode(options: PublicCodeOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (options.save === true) {
    if (options.publish === true) {
      throw new NmtsError("--save and --publish are two different things; run them one at a time.", { exitCode: 2 });
    }
    return await savePublicCodeFile(options.file, options.force === true, say, options.json === true);
  }
  const session = await openSession({ server: options.server, network: options.network });
  const crypt = await loadCrypto();
  const keys = shareKeysOf(crypt, session.code);
  const mine = b64(keys.address);
  const shown = keys.display;

  const seen: unknown = await request(session.server, "/v1/account/share-identity", {
    token: session.apiKey,
  });
  let published = isRecord(seen) && seen["published"] === true;

  // ⛔ IF THE SERVER ALREADY HOLDS A DIFFERENT ONE, STOP. Publishing is first-writer-wins and the
  //    server would refuse the write anyway, but the useful thing to report is not "the write
  //    failed" — it is that the NMTS key this machine is holding is not the one this account
  //    was made with, which is a much bigger fact than a failed request.
  const held = isRecord(seen) ? seen["share_address"] : null;
  if (typeof held === "string" && held !== mine) {
    throw new NmtsError("This account already publishes a different public code.", {
      exitCode: 4,
      nextStep:
        "The public code is derived from the NMTS key, so a different one means this machine " +
        "is holding a different account's code than the key beside it. Check which account you meant.",
    });
  }

  if (options.publish === true && !published) {
    await request(session.server, "/v1/account/share-identity", {
      token: session.apiKey,
      method: "PUT",
      body: { share_public_key: b64(keys.identity), share_address: mine },
    });
    published = true;
  }

  if (options.json === true) {
    // ⚠ BOTH FORMS. `code` is what a person reads and types; `raw` is what the wire carries.
    //   A reader that has only one of them ends up converting, and that is a second place to be wrong.
    say(JSON.stringify({ code: shown, raw: mine, published }));
    return 0;
  }

  say(`public code  ${shown}`);
  if (published) {
    say(`             published — another account can send files to it`);
    say(``);
    say(`Give it to whoever is sending. ⛔ It is NOT your NMTS key — that one opens`);
    say(`every file you have and is never given to anybody. This one opens nothing.`);
    return 0;
  }
  say(`             NOT published — nobody can send to it yet`);
  say(``);
  say(`Publishing writes it on the server so a sender can find the key to seal to.`);
  say(`It is permanent: it cannot be withdrawn or changed afterwards. It is also not a`);
  say(`choice — it comes from your NMTS key, so the same NMTS key always gives`);
  say(`the same public code, on this machine or any other.`);
  say(``);
  say(`  ${BINARY_NAME} public-code --publish`);
  return 0;
}

/**
 * `nmts public-code --save [file]` — this account's public code file (NCF-3 §5.7).
 *
 * ⛔ NOTHING IN IT IS SECRET and nothing is asked of the server: the identity is derived from the
 *    NMTS key on this machine, exactly the bytes `--publish` would put on the server. Whoever holds
 *    the file can seal a handover to this account without looking the code up — which is the point:
 *    that lookup is the one thing that tells NMTS who is sending to whom.
 */
async function savePublicCodeFile(
  file: string | undefined,
  force: boolean,
  say: (line: string) => void,
  json: boolean,
): Promise<number> {
  const { code } = await requireAccountCode();
  const crypt = await loadCrypto();
  const keys = shareKeysOf(crypt, code);
  const out = resolve(file === undefined || file === "" ? publicCodeFileName(keys.display) : file);
  try {
    writeFileSync(out, publicCodeFileText(keys), { flag: force ? "w" : "wx" });
  } catch {
    throw new NmtsError(`Could not write ${out}.`, {
      exitCode: 4,
      nextStep: "If it already exists, name another file or replace it with --force.",
    });
  } finally {
    keys.wipe();
  }
  if (json) {
    say(JSON.stringify({ code: keys.display, out }));
    return 0;
  }
  say(`public code file  ${out}`);
  say(`                  for public code ${keys.display}`);
  say(``);
  say(`Whoever has this file can hand files over to you without asking NMTS.`);
  return 0;
}
