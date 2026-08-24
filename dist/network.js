// Which storage network this run uses — and why it is never guessed.
//
// ⛔ THE TRAP THIS EXISTS TO CLOSE. In the web app the network comes from an environment variable
//    read at module load, and an EMPTY value silently means "testnet". A production build refuses
//    to start that way; a Node process does not. So a tool that inherited that default would point
//    a mainnet account at testnet aggregators, testnet relays and a testnet chain check — and
//    would report that everything was fine while looking in a place the files were never in.
//
// ⛔ SO THE RULE HERE IS: the live server implies mainnet, and ANY other server must say which
//    network it is. There is no fallback. A tool that has to guess where somebody's files are
//    should stop instead.
import { NmtsError } from "./errors.js";
import { DEFAULT_SERVER } from "./server.js";
export const NETWORKS = ["mainnet", "testnet"];
export const NETWORK_ENV_VAR = "NMTS_NETWORK";
function isNetwork(value) {
    return NETWORKS.includes(value);
}
/**
 * Decide the network for this run.
 *
 * `explicit` beats the environment, which beats the one inference this function is willing to
 * make: the live server is mainnet. Anything else and it refuses.
 */
export function resolveNetwork(server, explicit) {
    const stated = explicit ?? process.env[NETWORK_ENV_VAR];
    if (stated !== undefined && stated.length > 0) {
        if (!isNetwork(stated)) {
            throw new NmtsError(`Not a network: ${stated}`, {
                exitCode: 2,
                nextStep: `Use one of: ${NETWORKS.join(", ")}.`,
            });
        }
        return stated;
    }
    if (server === DEFAULT_SERVER)
        return "mainnet";
    throw new NmtsError(`Cannot tell which storage network ${server} uses.`, {
        exitCode: 2,
        nextStep: `Set ${NETWORK_ENV_VAR}=mainnet or ${NETWORK_ENV_VAR}=testnet. ` +
            `Guessing would look for your files on a network they were never stored on.`,
    });
}
