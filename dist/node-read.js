/**
 * Reading straight from the Walrus storage nodes: the last road for a download (D51, 2026-11-09).
 *
 * ⛔ WHY. Every read went through an aggregator, a company's server that asks the nodes for you. On
 *    the day none of them answers, a file is still on the nodes; this asks them itself, through the
 *    same SDK the uploads use, and decodes the blob here. It is slower and asks many hosts (one per
 *    shard holder), so it runs only after every aggregator failed for a reason other than "not found".
 *
 * ⛔ IN ITS OWN FILE, LOADED ONLY WHEN NEEDED. The SDK and its encoder are large; a `get` that an
 *    aggregator served never loads them.
 */
import { walrus } from "@mysten/walrus";
import { reachFetch } from "./reach.js";
import { suiClient } from "./sui-rpc.js";
/** One blob, or one file inside a quilt, read and decoded from the storage nodes. */
export async function readFromNodes(network, kind, id) {
    const client = suiClient(network === "mainnet" ? "mainnet" : "testnet").$extend(walrus({ storageNodeClientOptions: { fetch: reachFetch } }));
    if (kind === "blob")
        return client.walrus.readBlob({ blobId: id });
    const [file] = await client.walrus.getFiles({ ids: [id] });
    if (file === undefined)
        throw new Error(`the storage nodes returned nothing for ${id}`);
    return file.bytes();
}
