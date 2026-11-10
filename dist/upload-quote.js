// What an upload of N bytes for E epochs costs, asked with no file, no account and no wallet.
//
// ⛔ WHY (spec 2026-09-20 Deponejo · gap C · plan 2026-11-10 §1.1). A business pricing an invoice
//    has to say "N bytes for E epochs is this much WAL, this much SUI, this many credits" before
//    its customer has a funded wallet — often before the customer has an account at all. Until now
//    the price came back only from `put(…, { dryRun: true })`, which needs the file and an opened
//    account. A business that had to call Walrus directly to price an invoice had a reason to build
//    on Walrus rather than on NMTS.
//
// ⛔ THE SAME ARITHMETIC AS THE UPLOAD, NOT A COPY. The part plan, the padding of the last part and
//    the sealed length come from `planAndPrice` — the function `put` prices with — and the WAL and
//    the relay's tip from `walletUploadReads().quoteParts`, the read `walletPut` makes. So the WAL
//    this answers for a sealed size is the WAL the upload's review answers for the same size.
//
// ⚠ THE GAS IS AN ESTIMATE AND SAYS SO. An upload measures its register fee by dry-running the exact
//   transaction with the payer's coins; with no payer there are no coins to dry-run with. The
//   estimate is the gas the two transactions used on testnet (`MEASURED_GAS` below, with the
//   digests it came from), its computation part scaled by the network's reference gas price read
//   now. The field is named `gasEstimateMist` and `gasSource` says where the number came from.
//
// ⚠ NOTHING HERE WRITES TO A STREAM OR REACHES FOR `node:`: the SDK's browser entry runs it.
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { NmtsError } from "./errors.js";
import { DEFAULT_PART_BYTES, sealedLenFor } from "./seal.js";
import { creditsFor, planAndPrice, UPLOAD_EPOCHS } from "./upload-price.js";
import { chooseUploadEpochs } from "./upload-wallet-plan.js";
/**
 * The gas one part's two transactions used, measured on testnet (2026-11-10, this unit's runs).
 *
 * ⛔ COMPUTATION IS IN GAS UNITS, STORAGE IN MIST. Sui charges computation as units × the reference
 *    gas price, which each network sets per epoch, and storage at a fixed price per byte; the
 *    rebate is what deleting the objects later gives back. Keeping the units lets the estimate
 *    follow the network's price instead of freezing testnet's.
 */
export const MEASURED_GAS = {
    source: "measured on testnet 2026-11-10 from one sponsored upload of a 1 MiB file (register " +
        "8XLr5kR7n9pypv5PznrqhUtFc7QAK9k7HbHBts5aF3ds, certify E9JtBWV6ntyWQuaucrkGLrZDrF4JiQV2knFnwJzvLbAN); " +
        "computation scaled by the reference gas price read now",
    // Most of register's storage charge is the shared system object being rewritten, and most of it
    // comes back as the rebate in the same transaction: the net is about 3 million MIST.
    register: { computationUnits: 1000n, storageMist: 115732800n, rebateMist: 112757523n },
    certify: { computationUnits: 1000n, storageMist: 2006400n, rebateMist: 1975802n },
};
/** The relay a quote is for and the reads behind it, for one network. */
async function defaultReads(network) {
    const [{ relayHost }, { walletUploadReads }, { suiClient }] = await Promise.all([
        import("./walrus.js"),
        import("./upload-wallet-chain.js"),
        import("./sui-rpc.js"),
    ]);
    const relay = relayHost(network);
    const upload = walletUploadReads(network, relay);
    return {
        relay,
        reads: {
            readWindow: () => upload.readWindow(),
            quoteParts: (lens, epochs) => upload.quoteParts(lens, epochs),
            // ⚠ A READ WITH NO WALLET: the simulation runs with its checks off, so any sender will do.
            encodedLength: (sealedLen) => upload.encodedLength(normalizeSuiAddress("0x0"), sealedLen),
            async referenceGasPrice() {
                try {
                    const { referenceGasPrice } = await suiClient(network).core.getReferenceGasPrice();
                    return BigInt(referenceGasPrice);
                }
                catch {
                    return null;
                }
            },
        },
    };
}
/** The measured gas of `parts` parts at `price` MIST per unit. */
export function gasEstimate(parts, price) {
    const one = (g) => g.computationUnits * price + g.storageMist - g.rebateMist;
    return BigInt(parts) * (one(MEASURED_GAS.register) + one(MEASURED_GAS.certify));
}
/** The price of an upload of `ask.bytes` for `ask.epochs`, with nothing opened and nothing signed. */
export async function quoteUpload(network, ask, seams = {}) {
    if (!Number.isSafeInteger(ask.bytes) || ask.bytes < 0) {
        throw new NmtsError(`A size is a whole number of bytes, 0 or more: ${String(ask.bytes)}.`, {
            exitCode: 2,
            nextStep: "Nothing was read from the chain. Pass the file's size in bytes.",
        });
    }
    const partSize = ask.partSize ?? DEFAULT_PART_BYTES;
    if (!Number.isSafeInteger(partSize) || partSize <= 0) {
        throw new NmtsError(`A part size is a positive whole number of bytes: ${String(ask.partSize)}.`, { exitCode: 2 });
    }
    const { plan, sealFor } = planAndPrice(ask.bytes, partSize, ask.padding ?? "padme");
    const sealedLens = plan.map((range) => sealedLenFor(sealFor(range)));
    const found = seams.reads === undefined ? await defaultReads(network) : { relay: seams.relay ?? "", reads: seams.reads };
    const window = await found.reads.readWindow();
    if (window === null) {
        throw new NmtsError(`The ${network} storage network could not be read.`, {
            exitCode: 1,
            nextStep: "Nothing was spent. Which epoch it is and how far ahead the network sells are facts only the chain has; ask again.",
        });
    }
    // ⛔ THE SAME REFUSAL AS THE UPLOAD: a term the network will not sell is refused, never clamped.
    const epochs = chooseUploadEpochs(ask.epochs, window);
    const [quotes, price, encoded] = await Promise.all([
        found.reads.quoteParts(sealedLens, epochs),
        found.reads.referenceGasPrice(),
        Promise.all(sealedLens.map((len) => found.reads.encodedLength(len))),
    ]);
    if (price === null) {
        throw new NmtsError(`The ${network} reference gas price could not be read.`, {
            exitCode: 1,
            nextStep: "Nothing was spent. The fee estimate scales with that price, so it is not guessed; ask again.",
        });
    }
    const sum = (pick) => quotes.reduce((total, q) => total + pick(q), 0n);
    const sealedBytes = sealedLens.reduce((total, len) => total + len, 0);
    return {
        network,
        bytes: ask.bytes,
        epochs,
        endEpoch: window.clock.current + epochs,
        parts: quotes.map((q, i) => ({
            sealedBytes: q.sealedLen,
            encodedBytes: encoded[i] ?? 0,
            storageFrost: q.storageFrost.toString(),
            writeFrost: q.writeFrost.toString(),
            tipMist: q.tipMist.toString(),
        })),
        sealedBytes,
        encodedBytes: encoded.reduce((total, n) => total + n, 0),
        walFrost: sum((q) => q.storageFrost + q.writeFrost).toString(),
        tipMist: sum((q) => q.tipMist).toString(),
        gasEstimateMist: gasEstimate(quotes.length, price).toString(),
        gasSource: MEASURED_GAS.source,
        relay: found.relay,
        credits: epochs === UPLOAD_EPOCHS ? sealedLens.reduce((total, len) => total + creditsFor(len), 0) : null,
    };
}
