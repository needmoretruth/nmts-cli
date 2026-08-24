// The four things every command that talks to the server needs, resolved once.
//
// ⛔ IT IS ONE FUNCTION SO THE REFUSALS ARE ONE TEXT. Each command used to resolve the code, the
//    key, the server and the network for itself, which is four chances for one of them to word
//    the "you have no API key" refusal differently — and that refusal is the single most likely
//    thing a new user of this tool will see.
import { requireAccountCode } from "./code-access.js";
import { identityOf } from "./account.js";
import { API_KEY_ENV_VAR, readCredentialsFile, resolveApiKey, } from "./credentials.js";
import { NmtsError } from "./errors.js";
import { resolveNetwork } from "./network.js";
import { BINARY_NAME } from "./product.js";
import { resolveServer } from "./server.js";
/**
 * The API key, or the one refusal for not having one.
 *
 * ⛔ IT IS ITS OWN FUNCTION BECAUSE ONE COMMAND NEEDS THE KEY AND NOT THE CODE. `verify` asks the
 *    server about the account and opens no file, so making it resolve an account code would refuse
 *    a run over a credential it never uses — and wording that refusal a second time is exactly how
 *    two texts for one problem start.
 */
export function requireApiKey() {
    const key = resolveApiKey();
    if (key === null) {
        throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
            exitCode: 3,
            nextStep: `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store ` +
                `it with \`${BINARY_NAME} login\`. The key is what lets a program act without passing the ` +
                `human check that a browser sign-in does.`,
        });
    }
    return key.key;
}
export async function openSession(options) {
    const resolved = await requireAccountCode();
    const apiKey = requireApiKey();
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const identity = await identityOf(resolved.code);
    return {
        code: resolved.code,
        source: resolved.source,
        apiKey,
        server,
        network,
        accountId: identity.accountId,
    };
}
