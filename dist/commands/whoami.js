// `nmts whoami` — which account the code on this machine belongs to.
//
// ⚠ IT ANSWERS OFFLINE, AND IT SAYS WHAT IT DID NOT DO. Everything printed is derived from the
//    code on this machine; nothing is asked of a server. So it proves the code is well-formed and
//    which account it is, and it proves nothing about whether that account exists, has credits, or
//    is signed in. Printing an account id without saying that would read as "connected".
import { identityOf } from "../account.js";
import { requireAccountCode } from "../code-access.js";
import { CODE_ENV_VAR, readCredentialsFile } from "../credentials.js";
import { BINARY_NAME } from "../product.js";
import { resolveNetwork } from "../network.js";
import { resolveServer } from "../server.js";
export async function whoami(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const resolved = await requireAccountCode();
    const identity = await identityOf(resolved.code);
    // ⛔ BOTH STORED SHAPES, and an adversarial review is why. This read `source === "file"` only,
    //    which was right while the file always held the code in the clear — and became wrong the
    //    day `login` started sealing by default. Somebody who ran `login --server … --network
    //    testnet` was then told, silently, that their account was on the live server and mainnet.
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    say(`Account id   ${identity.accountId}`);
    say(`Public code  ${identity.publicCode}`);
    say(`Code from    ${resolved.source === "env" ? `${CODE_ENV_VAR} (not stored)` : "this machine"}`);
    say(`Server       ${server}`);
    say(`Network      ${network}`);
    say(``);
    say(`  Derived on this machine. Nothing was asked of the server, so this does not say whether`);
    say(`  the account exists there, has credits, or is signed in.`);
    return 0;
}
