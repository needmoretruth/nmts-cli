// The chain transport: which Sui node a command talks to, and what happens when it does not answer.
//
// ⛔ WHY THIS IS ITS OWN FILE AND NOT PART OF walrus.ts. `walrus.ts` holds the host tables, and it
//    is loaded by EVERY invocation including `nmts --help`. Importing the Sui SDK there pulled 150
//    modules into a command that prints text and exits — `deploy/check-cli-startup.mjs` measured it
//    and failed the build, which is exactly what that gate is for. The SDK is imported here, and
//    only the commands that actually reach the chain import this.
//
// ⛔ NOT A RETRIER. Each host is asked once. Anything other than "no answer" — any 4xx that is not
//    429 — is an answer, and asking a different node the same question gets the same one.
import { JsonRpcHTTPTransport } from "@mysten/sui/jsonRpc";
import { suiRpcHosts } from "./walrus.js";
/** HTTP statuses that mean "no answer came", the only ones worth asking a second node about. */
function worthAnotherHost(status) {
    return status >= 500 || status === 429;
}
/**
 * A Sui transport that asks the network's hosts in order.
 *
 * ⭐ 2026-09-01. There used to be one host per network, and on that morning
 * the testnet one was measured dead — `rpc-testnet.suiscan.xyz` completes the TCP handshake in
 * 31 ms and then sends nothing for twelve seconds, three times running. It had been that way for
 * eleven days, so every command that needed the shard count on testnet had simply stopped.
 *
 * ⚠ One transport per client on purpose: the host that answered becomes the one asked first, and
 *   sharing that state across clients would let one command's bad luck redirect every other. The
 *   flip side is that a recovered first host is not noticed until the process restarts — that is
 *   the price of not probing a node nobody asked us to talk to.
 */
export function suiRpcTransport(network) {
    const hosts = suiRpcHosts(network);
    let preferred = 0;
    const fetchWithFailover = async (input, init) => {
        const asked = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        let lastError = null;
        for (let step = 0; step < hosts.length; step += 1) {
            const index = (preferred + step) % hosts.length;
            const host = hosts[index];
            if (host === undefined)
                continue;
            try {
                const res = await fetch(new URL(asked.pathname + asked.search, host), init);
                if (worthAnotherHost(res.status) && step < hosts.length - 1) {
                    lastError = new Error(`${host} answered ${res.status}`);
                    continue;
                }
                preferred = index;
                return res;
            }
            catch (err) {
                lastError = err;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new Error(`no Sui node answered (${hosts.length} tried)`);
    };
    return new JsonRpcHTTPTransport({ url: hosts[0] ?? "", fetch: fetchWithFailover });
}
