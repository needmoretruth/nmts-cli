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
//    is also not a choice: the code and the identity behind it are derived from the account code,
//    so the same account code produces the same bytes on any device, and the server refuses a
//    bundle whose claimed value is not the fingerprint of its own root. The only way to publish a
//    wrong one is to be holding a different account code. That is worth saying plainly rather than
//    warning vaguely — a warning that cannot be acted on just teaches people to click through.
//
// ⚠ IT IS NOT THE ACCOUNT CODE. That one opens every file in the account and must never be given
//   to anybody; this one is meant to be given away, and on its own it opens nothing.
import { request } from "../api.js";
import { NmtsError } from "../errors.js";
import { isRecord } from "../guards.js";
import { loadCrypto } from "../crypto.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { shareKeysOf } from "../share.js";
function b64(bytes) {
    return Buffer.from(bytes).toString("base64url");
}
export async function publicCode(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const session = await openSession({ server: options.server, network: options.network });
    const crypt = await loadCrypto();
    const keys = shareKeysOf(crypt, session.code);
    const mine = b64(keys.address);
    const shown = keys.display;
    const seen = await request(session.server, "/v1/account/share-identity", {
        token: session.apiKey,
    });
    let published = isRecord(seen) && seen["published"] === true;
    // ⛔ IF THE SERVER ALREADY HOLDS A DIFFERENT ONE, STOP. Publishing is first-writer-wins and the
    //    server would refuse the write anyway, but the useful thing to report is not "the write
    //    failed" — it is that the account code this machine is holding is not the one this account
    //    was made with, which is a much bigger fact than a failed request.
    const held = isRecord(seen) ? seen["share_address"] : null;
    if (typeof held === "string" && held !== mine) {
        throw new NmtsError("This account already publishes a different public code.", {
            exitCode: 4,
            nextStep: "The public code is derived from the account code, so a different one means this machine " +
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
        say(`Give it to whoever is sending. ⛔ It is NOT your account code — that one opens`);
        say(`every file you have and is never given to anybody. This one opens nothing.`);
        return 0;
    }
    say(`             NOT published — nobody can send to it yet`);
    say(``);
    say(`Publishing writes it on the server so a sender can find the key to seal to.`);
    say(`It is permanent: it cannot be withdrawn or changed afterwards. It is also not a`);
    say(`choice — it comes from your account code, so the same account code always gives`);
    say(`the same public code, on this machine or any other.`);
    say(``);
    say(`  ${BINARY_NAME} public-code --publish`);
    return 0;
}
