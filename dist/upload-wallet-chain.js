// The chain behind a WALLET-PAID upload: the client that can pay a relay's tip, the register and
// certify transactions, the live reads that price an upload, and the two facts read back after
// the register signature.
//
// ⛔ ONE BUILDER FOR THE FEE AND THE SIGNATURE. `registerTransaction` is what the dry run measures
//    and what `wallet-sign.ts` signs — the same rule `wallet-send-chain.ts` keeps. Two builders
//    would let the review price one transaction and the wallet approve another.
//
// ⛔ THE TIP IS IN THE REGISTER TRANSACTION, exactly as the SDK's own flow orders it: the auth
//    payload and the transfer to the relay first, then the registration. On the credit rail the
//    treasury pays that tip inside its own transaction; here the person does, and the relay checks
//    it in the transaction named when the bytes arrive (`walrus-write.ts`).
//
// ⛔ THE ENCODED SIZE IS THE CHAIN'S ARITHMETIC, NOT A COPY. Registration checks
//    `encoded_size <= storage_size` with `walrus::encoding::encoded_blob_length`, and the SDK keeps
//    its own copy unexported. Cutting a held resource to fit needs that exact number, so it is
//    asked of the chain itself, in a dev-inspect that costs nothing — a copy kept here would be
//    wrong the day the protocol changed it, and the way that surfaces is a refused registration
//    after the split was signed.
import { bcs } from "@mysten/sui/bcs";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { blobIdFromInt, blobIdToInt, MAINNET_WALRUS_PACKAGE_CONFIG, TESTNET_WALRUS_PACKAGE_CONFIG, walrus, } from "@mysten/walrus";
import { NmtsError } from "./errors.js";
import { extendReads, netGasFee, readBlobLease } from "./extend-chain.js";
import { readOwnedStorage, readStorageType } from "./shared/lib/storage-control/chain.js";
import { registerIntoStorage, splitStorageToFit } from "./shared/lib/storage-control/reuse.js";
import { suiRpcTransport } from "./sui-rpc.js";
import { readBalances, walCoinType } from "./wallet.js";
import { chainReader } from "./wallet-chain.js";
/**
 * The most this tool will pay an upload relay as a tip, in MIST, per network.
 *
 * ⚠ A SECOND COPY of the browser's `RELAY_TIP_MAX_MIST`, for the same reason `WAL_COIN_TYPES` is:
 *   this package imports nothing from that tree. It is a CEILING, not the charge — the relay's own
 *   tip configuration sets the amount, which the review prints — and a relay asking for more than
 *   this is refused by the SDK before anything is signed.
 */
export const RELAY_TIP_CEILING_MIST = {
    testnet: 100_000,
    mainnet: 250_000_000,
};
/** The Walrus package addresses of one network. Exported from the SDK; the system object survives upgrades. */
export function packageConfig(network) {
    return network === "mainnet" ? MAINNET_WALRUS_PACKAGE_CONFIG : TESTNET_WALRUS_PACKAGE_CONFIG;
}
function build(network, relayUrl) {
    return new SuiJsonRpcClient({ network, transport: suiRpcTransport(network) }).$extend(walrus({ uploadRelay: { host: relayUrl, sendTip: { max: RELAY_TIP_CEILING_MIST[network] } } }));
}
/** A Walrus client bound to ONE relay, able to pay that relay's tip. */
export function payingClient(network, relayUrl) {
    return build(network, relayUrl);
}
/**
 * The register transaction of ONE part — the tip, then either a purchase or a held resource.
 *
 * ⛔ SENDER FIRST. `coinWithBalance` and the SDK's own coin selection pick WAL and SUI from the
 *    sender's address when the fragments resolve; without it the build fails late.
 */
export async function registerTransaction(client, network, input) {
    const tx = new Transaction();
    tx.setSender(input.sender);
    const { part } = input;
    tx.add(client.walrus.sendUploadRelayTip({ size: part.sealedLen, blobDigest: part.blobDigest, nonce: part.nonce }));
    if (input.storage.kind === "buy") {
        const blob = tx.add(client.walrus.registerBlob({
            size: part.sealedLen,
            epochs: input.epochs,
            blobId: part.blobId,
            rootHash: part.rootHash,
            deletable: true,
        }));
        tx.transferObjects([blob], input.sender);
        return tx;
    }
    const walrusPackageId = (await client.walrus.systemObject()).package_id;
    if (input.storage.cutToBytes !== null) {
        splitStorageToFit({
            walrusPackageId,
            storageObjectId: input.storage.objectId,
            keepBytes: input.storage.cutToBytes,
            owner: input.sender,
        }, tx);
    }
    registerIntoStorage({
        systemObjectId: packageConfig(network).systemObjectId,
        walrusPackageId,
        walType: walCoinType(network),
        storageObjectId: input.storage.objectId,
        blobIdAsInt: blobIdToInt(part.blobId),
        rootHash: part.rootHash,
        rawBytes: part.sealedLen,
        writeCost: input.storage.writeFrost,
        deletable: true,
        owner: input.sender,
    }, tx);
    return tx;
}
/** The certify transaction of ONE part, from the certificate the relay handed back. */
export function certifyTransaction(client, input) {
    return client.walrus.certifyBlobTransaction({
        blobId: input.blobId,
        blobObjectId: input.blobObjectId,
        deletable: true,
        certificate: {
            signers: input.certificate.signers,
            serializedMessage: new Uint8Array(Buffer.from(input.certificate.serialized_message_b64, "base64url")),
            signature: new Uint8Array(Buffer.from(input.certificate.signature_b64, "base64url")),
        },
    });
}
/**
 * The blob object a register transaction created, and when its storage ends.
 *
 * ⛔ THE OBJECT IS FOUND BY ITS TYPE, not by position: the transaction also creates the leftover
 *    resource on a cut, and on a purchase the storage object is created and consumed inside it.
 */
export async function createdBlob(client, objectChanges) {
    const created = Array.isArray(objectChanges)
        ? objectChanges.find((change) => typeof change === "object" &&
            change !== null &&
            Reflect.get(change, "type") === "created" &&
            typeof Reflect.get(change, "objectType") === "string" &&
            String(Reflect.get(change, "objectType")).endsWith("::blob::Blob"))
        : undefined;
    const id = created === undefined ? undefined : Reflect.get(created, "objectId");
    if (typeof id !== "string") {
        throw new NmtsError("The registration executed but the chain did not list the blob object it created.", {
            exitCode: 1,
            nextStep: "The storage is bought. Running the same command again does not pay again: it reads the record and continues.",
        });
    }
    const lease = await readBlobLease(client, id);
    return { blobObjectId: id, endEpoch: lease.endEpoch };
}
/** What this part is once the network has encoded it — the number registration compares a resource against. */
export async function encodedLength(client, sender, sealedLen) {
    const [system, state] = await Promise.all([client.walrus.systemObject(), client.walrus.systemState()]);
    const tx = new Transaction();
    tx.moveCall({
        package: system.package_id,
        module: "encoding",
        function: "encoded_blob_length",
        // 1 = RS2, the encoding every registration in this tool names (`reuse.ts`).
        arguments: [tx.pure.u64(sealedLen), tx.pure.u8(1), tx.pure.u16(state.committee.n_shards)],
    });
    const result = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
    const value = result.results?.[0]?.returnValues?.[0]?.[0];
    if (value === undefined) {
        throw new NmtsError("The chain did not say how large this part is once encoded.", {
            exitCode: 1,
            nextStep: "Nothing was signed. A held resource cannot be cut to fit without that number; buy new storage instead, or try again.",
        });
    }
    return Number(bcs.u64().parse(Uint8Array.from(value)));
}
/** A part shaped like a real one, for measuring the fee of a registration before anything is sealed. */
function placeholderPart(sealedLen) {
    return {
        sealedLen,
        blobId: blobIdFromInt(1n),
        rootHash: new Uint8Array(32),
        nonce: new Uint8Array(32),
        blobDigest: new Uint8Array(32),
    };
}
/** The live reads one wallet-paid upload needs, bound to one network and one relay. */
export function walletUploadReads(network, relayUrl) {
    const client = build(network, relayUrl);
    return {
        readWindow: () => extendReads(network).readWindow(),
        async quoteParts(sealedLens, epochs) {
            return Promise.all(sealedLens.map(async (sealedLen) => {
                const [cost, tip] = await Promise.all([
                    client.walrus.storageCost(sealedLen, epochs),
                    client.walrus.calculateUploadRelayTip({ size: sealedLen }),
                ]);
                return { sealedLen, storageFrost: cost.storageCost, writeFrost: cost.writeCost, tipMist: BigInt(tip) };
            }));
        },
        readWallet: (address) => readBalances(chainReader(network, address), walCoinType(network)),
        async estimateRegisterGas({ sender, sealedLen, epochs, storage }) {
            // ⛔ THE SAME BUILDER THE SIGNATURE USES, with a placeholder blob: the gas of `register_blob`
            //    does not depend on which id is registered, and the real id exists only after sealing.
            try {
                const tx = await registerTransaction(client, network, { sender, epochs, storage, part: placeholderPart(sealedLen) });
                const bytes = await tx.build({ client });
                const { effects } = await client.dryRunTransactionBlock({ transactionBlock: bytes });
                if (effects.status.status !== "success")
                    return null;
                return netGasFee(effects.gasUsed);
            }
            catch {
                return null;
            }
        },
        async readStorage(address) {
            const type = await readStorageType(client, packageConfig(network).systemObjectId);
            return readOwnedStorage(client, address, type);
        },
        encodedLength: (sender, sealedLen) => encodedLength(client, sender, sealedLen),
    };
}
