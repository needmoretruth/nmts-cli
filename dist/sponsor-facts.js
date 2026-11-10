// The chain facts a sponsored-transaction check needs, read live for one network.
//
// ⛔ WHAT A NODE ANSWERS DOES NOT DECIDE WHAT IS SIGNED BY ITSELF. The system object is this
//    package's own constant (`packageConfig`), so a call on any other object is refused whatever a
//    node says. The Walrus package id is read from that object; a node that lied about it could only
//    point at a call that is still handed coins of written amounts (`sponsor-check.ts`), so the most
//    it could take is the policy's WAL. An operator who wants no node in that answer pins
//    `walrusPackageId` in the policy.
//
// ⚠ THE RELAYS' TIP ADDRESSES COME FROM THE RELAYS THEMSELVES — the relay this tool uploads through
//   and the known ones for the network. A relay that cannot be read adds no address, so a tip to it
//   is refused rather than guessed; pin `relayTipAddresses` to decide them yourself.
import { parseTipConfig } from "./shared/lib/walrus/tip-config.js";
const TIP_READ_TIMEOUT_MS = 8_000;
/** Every relay's tip address that answers now, for `network`. */
export async function readRelayTipAddresses(network, extra = []) {
    const { RELAY_HOSTS, relayHost } = await import("./walrus.js");
    let own = null;
    try {
        own = relayHost(network);
    }
    catch {
        own = null;
    }
    const hosts = [...new Set([...(own === null ? [] : [own]), ...(RELAY_HOSTS[network] ?? []), ...extra])];
    const found = await Promise.all(hosts.map(async (host) => {
        try {
            const res = await fetch(new URL("/v1/tip-config", host), { signal: AbortSignal.timeout(TIP_READ_TIMEOUT_MS) });
            if (!res.ok)
                return null;
            const tip = parseTipConfig(await res.json());
            return tip.kind === "const" || tip.kind === "linear" ? tip.address : null;
        }
        catch {
            return null;
        }
    }));
    return [...new Set(found.filter((a) => a !== null && a !== ""))];
}
/**
 * The live facts for `network`, read once and kept: the package, the system object and the tip
 * addresses do not change between two transactions of one upload. `operator` is the address the
 * encoded-length question is asked as (a read; nothing is signed).
 */
export async function sponsorFacts(network, operator) {
    const [{ packageConfig, payingClient, encodedLength }, { relayHost }, { walrusClient, readBlobLease }] = await Promise.all([
        import("./upload-wallet-chain.js"),
        import("./walrus.js"),
        import("./extend-chain.js"),
    ]);
    const client = payingClient(network, relayHost(network));
    const [system, relayTipAddresses] = await Promise.all([client.walrus.systemObject(), readRelayTipAddresses(network)]);
    const lengths = new Map();
    return {
        walrusPackageId: system.package_id,
        systemObjectId: packageConfig(network).systemObjectId,
        relayTipAddresses,
        async encodedLength(size) {
            const known = lengths.get(size);
            if (known !== undefined)
                return known;
            const n = await encodedLength(client, operator, size);
            lengths.set(size, n);
            return n;
        },
        async blobSize(objectId) {
            try {
                return (await readBlobLease(walrusClient(network), objectId)).size;
            }
            catch {
                return null;
            }
        },
    };
}
