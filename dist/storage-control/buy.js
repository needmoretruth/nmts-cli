// Buying a storage resource on its own — a size and a term, with no file — decided, priced, signed
// and handed back rather than printed.
//
// ⛔ WHY (spec 2026-09-20 Deponejo · gap B2 · plan 2026-11-10 §1.2). NMTS bought storage only inside
//    an upload. A business that keeps one large resource and cuts a piece off it for each customer
//    (`split` → `transfer`) had to buy that resource with the Walrus client — a reason to use Walrus
//    directly. This sits beside split, merge and transfer, with the same two callers: `nmts wallet
//    storage buy` and the SDK's `buyStorage`.
//
// ⛔ THE ORDER IS THE SAFETY, the one `reshape.ts` keeps: ① the term is judged against what the
//    network sells ② the price is read fresh ③ both balances are read and a wallet known to be short
//    is refused with both numbers ④ the exact transaction is dry-run, and a refusal there ends the
//    run ⑤ the review is handed out ⑥ `dryRun` stops here ⑦ `agree` is the gate ⑧ only then the
//    signature, and the resource the chain created is read back by its type.
//
// ⚠ THE SIZE IS A RESOURCE'S SIZE — the encoded bytes a storage listing shows and `split` cuts by —
//   not a file's. A file of N bytes needs more once encoded; an upload's dry run says how much.
//
// ⚠ NOTHING HERE WRITES TO A STREAM, ASKS ANYBODY ANYTHING OR REACHES FOR `node:`.
import { NmtsError } from "../errors.js";
import { chooseUploadEpochs } from "../upload-wallet-plan.js";
import { coinAmount } from "../wallet.js";
/** A size worth buying: a positive whole number of bytes. */
function requireSize(sizeBytes) {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        throw new NmtsError(`A storage resource's size is a positive whole number of bytes: ${String(sizeBytes)}.`, {
            exitCode: 2,
            nextStep: "Nothing was signed. The size is encoded bytes, the unit a storage listing shows.",
        });
    }
    return sizeBytes;
}
/** Read, judge, price and — unless somebody stops it — sign one purchase of a storage resource. */
export async function buyStorage(context, ask, seams = {}) {
    const sizeBytes = requireSize(ask.sizeBytes);
    const reads = seams.reads === undefined ? await defaultBuyReads(context.network) : await seams.reads(context.network);
    // ① The term.
    const window = await reads.readWindow();
    if (window === null) {
        throw new NmtsError(`The ${context.network} storage network could not be read.`, {
            exitCode: 1,
            nextStep: "Nothing was signed. Which epoch it is and how far ahead the network sells are facts only the chain has.",
        });
    }
    const epochs = chooseUploadEpochs(ask.epochs, window);
    // ② The price, fresh. ③ The wallet.
    const [priceFrost, purse, walrusPackageId] = await Promise.all([
        reads.price(sizeBytes, epochs),
        reads.readWallet(context.address),
        reads.walrusPackageId(),
    ]);
    const shape = {
        kind: "buy",
        sizeBytes,
        epochs,
        priceFrost,
        walType: reads.walType(),
        systemObjectId: reads.systemObjectId(),
    };
    const walFrost = purse.wal.read ? purse.wal.baseUnits : null;
    const suiMist = purse.sui.read ? purse.sui.baseUnits : null;
    // ④ The dry run — skipped when the wallet is known to hold too little WAL, since the chain would
    //    only say the same thing less clearly.
    const short = walFrost !== null && walFrost < priceFrost;
    const verdict = short ? { feeMist: null, refusal: null } : await reads.dryRun(shape, context.address);
    if (verdict.refusal !== null) {
        throw new NmtsError(`The chain would refuse this: ${verdict.refusal}`, {
            exitCode: 4,
            nextStep: "Nothing was signed and no fee was spent.",
        });
    }
    let shortfall = null;
    if (short) {
        shortfall = `The wallet holds ${coinAmount(walFrost)} WAL and this storage costs ${coinAmount(priceFrost)} WAL.`;
    }
    else if (suiMist !== null && verdict.feeMist !== null && suiMist < verdict.feeMist) {
        shortfall = `The wallet holds ${coinAmount(suiMist)} SUI and the chain fee is about ${coinAmount(verdict.feeMist)} SUI.`;
    }
    // ⑤ The review.
    const review = {
        network: context.network,
        address: context.address,
        sizeBytes,
        epochs,
        startEpoch: window.clock.current,
        endEpoch: window.clock.current + epochs,
        priceFrost,
        feeMist: verdict.feeMist,
        walFrost,
        suiMist,
        shortfall,
    };
    seams.onReview?.(review);
    // ⑥ Stopped here, with nothing signed.
    if (seams.dryRun === true)
        return { kind: "review", review };
    if (shortfall !== null) {
        throw new NmtsError(shortfall, {
            exitCode: 4,
            nextStep: `Nothing was signed and nothing was spent. Send what is missing to ${context.address} and ask again.`,
        });
    }
    // ⑦ The gate.
    seams.agree?.(review);
    // ⑧ The signature, and the resource it made.
    const sign = seams.sign ?? (await import("../wallet-sign.js")).signStorageOp;
    const digest = await sign({ network: context.network, code: context.code, wallet: context.wallet, shape, walrusPackageId });
    const objectId = await reads.createdResource(digest).catch(() => null);
    return { kind: "done", review, digest, objectId };
}
/** The live reads, loaded on first use so nothing here imports a chain client by itself. */
async function defaultBuyReads(network) {
    const [chain, { walrusClient }, { freshWalrus }, { readBalances, walCoinType }, { chainReader }, { packageConfig }, execute] = await Promise.all([
        import("../storage-control-chain.js"),
        import("../extend-chain.js"),
        import("../walrus-fresh.js"),
        import("../wallet.js"),
        import("../wallet-chain.js"),
        import("../upload-wallet-chain.js"),
        import("../sui-execute.js"),
    ]);
    const client = walrusClient(network);
    const ops = chain.storageOpsReads(network);
    return {
        readWindow: async () => (await import("../extend-chain.js")).extendReads(network).readWindow(),
        async price(sizeBytes, epochs) {
            // ⚠ THE PROTOCOL'S UNIT IS ONE MEBIBYTE OF ENCODED SIZE, rounded up, and reserving space
            //   charges storage alone. If this arithmetic ever drifted from the contract's, the dry run
            //   below aborts (`destroy_zero` or `split`) and nothing is signed.
            const state = await freshWalrus(client).systemState();
            const units = BigInt(Math.ceil(sizeBytes / 2 ** 20));
            return units * BigInt(state.storage_price_per_unit_size) * BigInt(epochs);
        },
        readWallet: (address) => readBalances(chainReader(network, address), walCoinType(network)),
        walrusPackageId: () => ops.walrusPackageId(),
        walType: () => walCoinType(network),
        systemObjectId: () => packageConfig(network).systemObjectId,
        dryRun: (shape, sender) => ops.dryRun(shape, sender),
        async createdResource(digest) {
            const answer = await client.core.getTransaction({ digest, include: execute.EXECUTE_INCLUDE });
            const found = execute.readAnswer(answer).created.find((o) => o.type?.endsWith("::storage_resource::Storage") === true);
            return found?.objectId ?? null;
        },
    };
}
