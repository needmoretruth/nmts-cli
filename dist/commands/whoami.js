// `nmts whoami` — which account the code on this machine belongs to.
//
// ⚠ IT ANSWERS OFFLINE, AND IT SAYS WHAT IT DID NOT DO. Everything printed is derived from the
//    code on this machine; nothing is asked of a server. So it proves the code is well-formed and
//    which account it is, and it proves nothing about whether that account exists, has credits, or
//    is signed in. Printing an account id without saying that would read as "connected".
//
// ⛔ AND `--reveal` PUTS THE ACCOUNT CODE ITSELF ON THE SCREEN. Everything else this command
//    prints is public: an account id and a public code give nobody anything. The code is the
//    account — every file key and the wallet derive from it — so the flag exists for one
//    situation, a person copying it out of a machine they are sitting at, and it is refused while
//    a mode is on. There is no MCP tool for it either: an agent driving this tool was handed the
//    code already, so a surface that prints it can only ever move it somewhere new.
import { identityOf } from "../account.js";
import { currentMode } from "../autonomy.js";
import { requireAccountCode } from "../code-access.js";
import { CODE_ENV_VAR, readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME } from "../product.js";
import { resolveNetwork } from "../network.js";
import { resolveServer } from "../server.js";
export async function whoami(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    // ⛔ BEFORE THE CODE IS EVEN OPENED. A sealed store asks for a passphrase, and asking for one in
    //    order to refuse would teach a caller to supply it for a thing it is never going to get.
    if (options.reveal === true && currentMode() !== "off") {
        throw new NmtsError(`An agent does not need the code on screen — this tool already holds it.`, {
            exitCode: 5,
            nextStep: `A person runs \`${BINARY_NAME} whoami --reveal\` outside mode auto and without ` +
                `--skip-permissions.`,
        });
    }
    const resolved = await requireAccountCode();
    const identity = await identityOf(resolved.code);
    if (options.reveal === true) {
        if (options.json === true) {
            say(JSON.stringify({ account_code: identity.displayCode }));
            return 0;
        }
        // ⛔ THE WARNING COMES FIRST AND THE CODE IS ALONE ON ITS OWN LINE. Whoever is about to copy
        //    it reads what it is before they see it, and a line with nothing else on it is one a
        //    person can select without dragging a label into their clipboard.
        say(`The account code is the account: anyone who reads it can open every file and delete the account.`);
        say(identity.displayCode);
        return 0;
    }
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
