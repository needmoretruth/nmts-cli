// The certificate from node confirmations, by the rule the chain applies (D51, 2026-11-10).
// ⛔ WHY NOT THE SDK'S. `WalrusClient.certificateFromConfirmations` (1.2.36) refuses unless more than two
//    thirds of the committee's NODES confirmed. The chain counts no nodes: `bls_aggregate::
//    verify_certificate_and_weight` sums the signers' weight (each member's shard count) and asserts
//    `is_quorum`, `3 * weight >= 2 * n_shards + 1`. Members hold uneven shard counts (mainnet and testnet),
//    so a node count waits for confirmations the chain does not need, and on testnet on 2026-11-10 it
//    refused certificates the chain would have taken (63 of 97 nodes confirmed). The writes stop on the
//    same shard rule (node-quorum.ts), so the stop and the certificate cannot disagree.
// ⛔ WHAT IS CHECKED. Each confirmation must carry the exact message the chain will rebuild (intent,
//    epoch, blob id, persistence) and verify under its member's key; one aggregate check covers the honest
//    case, and only when it fails is each signature checked alone to drop the bad ones.
import { bls12_381 } from "@noble/curves/bls12-381.js";
import { bcs } from "@mysten/sui/bcs";
import { fromBase64 } from "@mysten/sui/utils";
import { blobIdToInt, NotEnoughBlobConfirmationsError } from "@mysten/walrus";
/** The chain's quorum (`walrus::bls_aggregate::is_quorum`). */
export const chainQuorum = (weight, nShards) => 3 * weight >= 2 * nShards + 1;
const BLOB_CERT_MSG = 1;
const WALRUS_APP_ID = 3;
const StorageConfirmation = bcs.struct("ProtocolMessage<StorageConfirmationBody>", {
    intent: bcs.struct("Intent", { type: bcs.u8(), version: bcs.u8(), appId: bcs.u8() }),
    epoch: bcs.u32(),
    messageContents: bcs.struct("StorageConfirmationBody", {
        blobId: bcs.u256(),
        blobType: bcs.enum("BlobPersistenceType", { Permanent: null, Deletable: bcs.struct("Deletable", { objectId: bcs.Address }) }),
    }),
});
/** The message every confirming node signs for this blob in this epoch. */
export function confirmationMessage(epoch, blobId, deletable, blobObjectId) {
    return StorageConfirmation.serialize({
        intent: { type: BLOB_CERT_MSG, version: 0, appId: WALRUS_APP_ID },
        epoch,
        messageContents: {
            blobId: blobIdToInt(blobId),
            blobType: deletable ? { Deletable: { objectId: blobObjectId } } : { Permanent: null },
        },
    }).toBytes();
}
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/**
 * Combine the confirmations whose message and signature hold into a certificate, or throw when their
 * shard weight is short of the chain's quorum. `members` is the BLS committee in signer-index order.
 */
export function certificateByShardWeight(confirmations, members, nShards, expected) {
    const sigs = bls12_381.longSignatures;
    const hashed = sigs.hash(expected);
    const signed = confirmations.flatMap((confirmation, index) => {
        const member = members[index];
        if (!confirmation || !member || !sameBytes(fromBase64(confirmation.serializedMessage), expected))
            return [];
        return [{ index, weight: member.weight, key: new Uint8Array(member.public_key.bytes), signature: fromBase64(confirmation.signature) }];
    });
    const aggregateHolds = (set) => set.length > 0 &&
        sigs.verify(sigs.aggregateSignatures(set.map((s) => s.signature)), hashed, sigs.aggregatePublicKeys(set.map((s) => s.key)));
    const valid = aggregateHolds(signed) ? signed : signed.filter((s) => sigs.verify(s.signature, hashed, s.key));
    const weight = valid.reduce((sum, s) => sum + s.weight, 0);
    if (!chainQuorum(weight, nShards)) {
        throw new NotEnoughBlobConfirmationsError(`Too few confirmed shards for blob (${weight} of ${nShards} from ${valid.length} nodes. The chain needs more than two thirds)`);
    }
    return {
        signers: valid.map((s) => s.index),
        serializedMessage: expected,
        signature: sigs.Signature.toBytes(sigs.aggregateSignatures(valid.map((s) => s.signature))),
    };
}
/** Replace the client's node-count certificate with the chain's shard-weight one. */
export function certifyByShardWeight(walrus) {
    walrus.certificateFromConfirmations = async ({ confirmations, blobId, deletable, blobObjectId }) => {
        const { committee } = await walrus.systemState();
        if (confirmations.length !== committee.members.length) {
            throw new NotEnoughBlobConfirmationsError("Invalid number of confirmations. Confirmations array must contain an entry for each node");
        }
        const expected = confirmationMessage(committee.epoch, blobId, deletable, blobObjectId);
        return certificateByShardWeight(confirmations, committee.members, committee.n_shards, expected);
    };
    return walrus;
}
