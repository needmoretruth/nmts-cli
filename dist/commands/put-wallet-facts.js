import { coinAmount } from "../wallet.js";
/** The review as `--json` prints it: base units as strings, with the coin amounts beside them. */
export function factsOf(review) {
    const { budget, storage } = review;
    return {
        bytes: review.bytes,
        sealedBytes: review.sealedBytes,
        parts: review.parts,
        epochs: review.epochs,
        days: review.days,
        endEpoch: review.endEpoch,
        paidFrom: "wallet",
        priceFrost: budget.walNeededFrost.toString(),
        priceWal: coinAmount(budget.walNeededFrost),
        tipMist: review.tipMist.toString(),
        tipSui: coinAmount(review.tipMist),
        feeMist: budget.feeMist === null ? null : budget.feeMist.toString(),
        feeSui: budget.feeMist === null ? null : coinAmount(budget.feeMist),
        wallet: budget.address,
        walletWal: budget.walFrost === null ? null : coinAmount(budget.walFrost),
        walletSui: budget.suiMist === null ? null : coinAmount(budget.suiMist),
        storage: storage.kind === "buy"
            ? { kind: "buy" }
            : { kind: "reuse", objectId: storage.objectId, cutToBytes: storage.cutToBytes, leftoverBytes: storage.leftoverBytes },
    };
}
