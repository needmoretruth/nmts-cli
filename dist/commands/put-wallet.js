// `nmts put <file> --pay wallet` — one file in, sealed on this machine, its storage bought by the
// PERSON'S OWN WALLET on the storage network instead of by credits.
//
// ⛔ IT PRICES BEFORE IT SIGNS, ALWAYS, in the order `extend` set: the parts are planned, the chain
//    quotes each part in WAL and the relay's tip in SUI, the register transaction is dry-run for
//    its fee, both balances are read — and only then is the review printed, a known shortfall
//    refused, and the `wallet` agreement (scope `storage`) held against the total. `--dry-run`
//    stops at the review and never loads the signing module.
//
// ⛔ THE SERVER IS TOLD THE STORAGE IS THE PERSON'S BY SAYING NOTHING ELSE. `POST /v1/items` forces
//    treasury ownership only on a part that names a certified reservation; a wallet-paid part names
//    none and carries the blob object and the end epoch instead, exactly as the browser's own
//    wallet-paid commit does (`upload-steps.ts`).
//
// ⛔ A HELD RESOURCE IS OFFERED, NEVER CHOSEN FOR THE PERSON — the owner's rule for storage
//    resources: the leftover is shown in bytes and the person decides. The review names how many
//    free resources the wallet holds; `--storage fit|whole|<id>` uses one and the review says in
//    bytes what is cut free or bound with the file.
import { basename, resolve } from "node:path";
import { identityOf } from "../account.js";
import { requireAccountCode } from "../code-access.js";
import { parseAsked } from "../collision.js";
import { DERIVED, loadCrypto } from "../crypto.js";
import { API_KEY_ENV_VAR, readCredentialsFile, resolveApiKey } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { setTrashed } from "../item-trash.js";
import { addEntry } from "../manifest-write.js";
import { readFileList } from "../manifest.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { Progress, silentSink, stderrSink } from "../progress.js";
import { sealedLenFor } from "../seal.js";
import { resolveServer } from "../server.js";
import { statusOf } from "../shared/lib/storage-control/plan.js";
import { createUploadApi } from "../upload-api.js";
import { fileSource, partKeysOf, uploadFile } from "../upload-file.js";
import { CREDIT_BYTES, measureLocal, partSizeFor, planAndPrice } from "../upload-price.js";
import { clearItemRecord, clearReservation } from "../upload-store.js";
import { walletRail } from "../upload-wallet.js";
import { chooseUploadEpochs, daysOf, describeUploadReview, parseStorageAsk, pickResource, uploadBudget, uploadShortfallNextStep, walPrice, } from "../upload-wallet-plan.js";
import { coinAmount, walletAddress } from "../wallet.js";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
import { createBlobProtocol } from "../walrus-write.js";
import { folderIdFor } from "./put.js";
export async function putWithWallet(target, options) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (target === undefined || target === "") {
        throw new NmtsError("Say which file to put.", { exitCode: 2, nextStep: `\`${BINARY_NAME} put <file> --pay wallet\`` });
    }
    const resolved = await requireAccountCode();
    const key = resolveApiKey();
    if (key === null) {
        throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
            exitCode: 3,
            nextStep: `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store it with \`${BINARY_NAME} login\`.`,
        });
    }
    const localPath = resolve(target);
    const size = measureLocal(localPath);
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const identity = await identityOf(resolved.code);
    const crypt = await loadCrypto();
    const asked = parseAsked(options.onCollision);
    const list = await readFileList(server, key.key, resolved.code, identity.accountId);
    const rule = list.manifest?.settings?.paddingMode === "pow2" ? "pow2" : "padme";
    const name = options.name ?? basename(localPath);
    const destination = (options.to ?? "").replace(/^\.?\//, "").replace(/\/$/, "");
    const parentId = folderIdFor(options.to, list.manifest?.entries ?? []);
    const ctx = {
        code: resolved.code,
        apiKey: key.key,
        server,
        network,
        accountId: identity.accountId,
        crypt,
        partSize: partSizeFor(options.partSize),
        rule,
        onCollision: asked,
        settings: list.manifest?.settings,
        progress: new Progress(options.json === true ? silentSink() : stderrSink(), "uploading"),
        say,
        json: options.json === true,
    };
    const done = await uploadOneWithWallet(ctx, { localPath, size, name, parentId, destination }, options);
    if (done === null)
        return 0;
    if (options.json) {
        say(JSON.stringify({ id: done.itemId, name: done.savedAs, ...done.facts, resumed: done.resumed, renamed: done.savedAs !== name, ...(done.replaced ? { replacedIntoTrash: done.replaced } : {}), fileListVersion: done.seq }));
        return 0;
    }
    say(`  saved as ${done.savedAs}`);
    if (done.replaced)
        say(`  A file called ${name} was already there. It is in the trash now — ${BINARY_NAME} restore brings it back for 30 days.`);
    else if (done.savedAs !== name)
        say(`  A file called ${name} was already there, so this one was numbered rather than replacing it.`);
    if (done.resumed)
        say(`  This finished an upload a previous run had already signed for. Nothing was signed now.`);
    return 0;
}
/**
 * Review, agree, upload and record ONE file. Null when `--dry-run` stopped at the review.
 *
 * ⛔ THE SIGNING MODULE IS LOADED AFTER THE AGREEMENT, and only then — a dry run and a refusal
 *    never bring the code that can spend into memory.
 */
export async function uploadOneWithWallet(ctx, file, options) {
    const { say } = ctx;
    const { plan, sealedBytes, sealFor } = planAndPrice(file.size, ctx.partSize, ctx.rule);
    const sealedLens = plan.map((range) => sealedLenFor(sealFor(range)));
    const storageAsk = parseStorageAsk(options.storage);
    if (storageAsk !== null && plan.length > 1) {
        throw new NmtsError(`A held storage resource holds one blob, and this file is ${plan.length} parts.`, {
            exitCode: 4,
            nextStep: `Nothing was signed. Leave --storage off, or raise --part-size so the file is one part.`,
        });
    }
    const protocol = (options.protocol ?? createBlobProtocol)(ctx.network, sealedBytes, (sent, total) => ctx.progress.update(sent, total));
    const reads = await (options.readChain ?? defaultReads)(ctx.network, protocol.relayUrl);
    const window = await reads.readWindow();
    if (window === null) {
        throw new NmtsError(`The ${ctx.network} storage network could not be read.`, {
            exitCode: 1,
            nextStep: `Nothing was signed and nothing was sent. Which epoch the network is in, and how far ahead it will sell, are facts only the chain has — this tool will not spend against a guess.`,
        });
    }
    const epochs = chooseUploadEpochs(options.epochs, window);
    const endEpoch = window.clock.current + epochs;
    const quotes = await reads.quoteParts(sealedLens, epochs);
    const address = await walletAddress(ctx.code);
    let storage = { kind: "buy" };
    let heldResources = null;
    if (storageAsk !== null) {
        const firstQuote = quotes[0];
        const firstLen = sealedLens[0];
        if (firstQuote === undefined || firstLen === undefined)
            throw new NmtsError("unreachable: a plan with no part");
        let resources;
        try {
            resources = await reads.readStorage(address);
        }
        catch (error) {
            throw new NmtsError("The storage resources this wallet holds could not be read.", {
                exitCode: 1,
                nextStep: `Nothing was signed. That is not the same as holding none. Cause: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
        const encoded = await reads.encodedLength(address, firstLen);
        storage = pickResource(storageAsk, resources, encoded, window.clock.current, endEpoch, firstQuote.writeFrost);
    }
    else {
        heldResources = await reads.readStorage(address).then((rows) => rows.filter((r) => statusOf(r, window.clock.current) === "usable").length, () => null);
    }
    const [purse, feeMist] = await Promise.all([
        reads.readWallet(address),
        reads.estimateRegisterGas({
            sender: address,
            sealedLen: Math.max(...sealedLens),
            epochs,
            storage: storage.kind === "buy" ? storage : { kind: "reuse", objectId: storage.objectId, cutToBytes: storage.cutToBytes, writeFrost: storage.writeFrost },
        }),
    ]);
    const budget = uploadBudget({ address, purse, feeMist, quotes, storage });
    const tipMist = quotes.reduce((sum, q) => sum + q.tipMist, 0n);
    const facts = {
        bytes: file.size,
        sealedBytes,
        parts: plan.length,
        epochs,
        days: daysOf(window, epochs),
        endEpoch,
        paidFrom: "wallet",
        priceFrost: budget.walNeededFrost.toString(),
        priceWal: coinAmount(budget.walNeededFrost),
        tipMist: tipMist.toString(),
        tipSui: coinAmount(tipMist),
        feeMist: feeMist === null ? null : feeMist.toString(),
        feeSui: feeMist === null ? null : coinAmount(feeMist),
        wallet: address,
        walletWal: budget.walFrost === null ? null : coinAmount(budget.walFrost),
        walletSui: budget.suiMist === null ? null : coinAmount(budget.suiMist),
        storage: storage.kind === "buy"
            ? { kind: "buy" }
            : { kind: "reuse", objectId: storage.objectId, cutToBytes: storage.cutToBytes, leftoverBytes: storage.leftoverBytes },
    };
    if (!ctx.json) {
        describeUploadReview(say, { name: file.name, bytes: file.size, parts: plan.length, epochs, days: daysOf(window, epochs), endEpoch, walNeeded: walPrice(quotes, storage), tipMist, storage, heldResources }, budget);
    }
    if (options.dryRun === true) {
        if (ctx.json)
            say(JSON.stringify({ dryRun: true, name: file.name, ...facts, signed: false }));
        else {
            say(``);
            if (budget.shortfall !== null)
                say(`  ⚠ ${budget.shortfall} As it stands, it would be refused.`);
            say(`  Nothing was signed and nothing was sent. Run the same command without --dry-run to upload it.`);
        }
        return null;
    }
    // ⛔ A WALLET KNOWN TO BE SHORT IS REFUSED BEFORE THE AGREEMENT IS ASKED FOR (`extend-budget.ts`).
    if (budget.shortfall !== null) {
        throw new NmtsError(budget.shortfall, { exitCode: 4, nextStep: uploadShortfallNextStep(budget) });
    }
    // ⛔ THE ONE GATE BETWEEN A PROGRAM AND SOMEBODY'S WALLET. Everything above is a read.
    requireWalletGrant("seal", { walFrost: budget.walNeededFrost, suiMist: budget.suiNeededMist }, new Date(options.now ?? Date.now()));
    const sign = options.sign ?? (await signers());
    const derived = ctx.crypt.kdf_derive(ctx.crypt.account_code_parse(ctx.code));
    const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
    derived.fill(0);
    let result;
    try {
        result = await uploadFile({
            api: options.api ?? createUploadApi(ctx.server, ctx.apiKey),
            protocol,
            crypt: ctx.crypt,
            dataKey,
            source: fileSource(file.localPath, file.size),
            name: file.name,
            parentId: file.parentId,
            destination: file.destination,
            relayUrl: protocol.relayUrl,
            epochs,
            currentEpoch: window.clock.current,
            partSize: ctx.partSize,
            padding: { rule: ctx.rule, unitBytes: CREDIT_BYTES },
            onStep: (step) => tell(ctx, file.size, step),
            buy: walletRail({
                network: ctx.network,
                code: ctx.code,
                relayUrl: protocol.relayUrl,
                epochs,
                storage,
                quotes,
                feeMist,
                signRegister: sign.register,
                signCertify: sign.certify,
                onSpend: recordWalletSpend,
            }),
        });
    }
    finally {
        ctx.progress.done();
        dataKey.fill(0);
    }
    const now = Date.now();
    const added = await addEntry({
        server: ctx.server,
        apiKey: ctx.apiKey,
        code: ctx.code,
        accountId: ctx.accountId,
        ...(ctx.onCollision !== undefined ? { onCollision: ctx.onCollision } : {}),
        entry: {
            id: result.itemId,
            parentId: file.parentId,
            kind: 1,
            name: result.entry.name,
            size: result.entry.plaintextLen,
            createdAt: now,
            updatedAt: now,
            dekWrapped: result.entry.dekWrapped,
            contentHashCt: result.entry.contentHashCt,
        },
    });
    // ⛔ ONLY NOW, AND EVERY PART — the same order `put.ts` keeps and for the same reason.
    clearItemRecord(result.fileKey);
    for (const record of partKeysOf(result.fileKey, result.parts))
        clearReservation(record);
    if (added.replaced)
        await setTrashed(ctx.server, ctx.apiKey, added.replaced.id, true);
    // ⛔ THE STANDING SHARE, AFTER THE PAYMENT AND NEVER INSIDE IT: a gift that fails must not fail
    //    the upload. A resumed run paid nothing now, so it owes nothing now. In --json the tip speaks
    //    on stderr — stdout carries the machine's one answer and nothing else.
    await (await import("../standing-tip.js")).standingTipAfter({
        server: ctx.server,
        network: ctx.network,
        code: ctx.code,
        settings: ctx.settings,
        paidWalFrost: result.resumed ? 0n : budget.walNeededFrost,
        say: ctx.json ? (line) => void process.stderr.write(`${line}\n`) : say,
        ...(options.tip ?? {}),
    });
    return { itemId: result.itemId, savedAs: added.name, replaced: added.replaced?.id ?? null, seq: added.seq, resumed: result.resumed, facts };
}
/** Each step, for a person watching. The signatures are named as what they are. */
function tell(ctx, size, step) {
    if (ctx.json || step.step === "planning")
        return;
    const { say } = ctx;
    if (step.step === "hashing")
        return say(`  reading ${size} bytes`);
    const where = step.parts > 1 ? `  [${step.partIndex + 1}/${step.parts}]` : "";
    if (step.step === "sealing")
        say(`  sealing${where} ${step.bytes} bytes`);
    if (step.step === "resuming")
        say(`  picking up a part already ${step.state}${where}`);
    if (step.step === "encoding")
        say(`  preparing${where} ${step.bytes} sealed bytes`);
    if (step.step === "reserving")
        say(`  signing the registration${where} — WAL and the relay tip leave the wallet`);
    if (step.step === "uploading")
        say(`  uploading${where} ${step.bytes} bytes to ${step.relayUrl}`);
    if (step.step === "certifying") {
        ctx.progress.done();
        say(`  signing the certification${where} — gas only`);
    }
    if (step.step === "committing")
        say(`  saving to the drive`);
}
async function defaultReads(network, relayUrl) {
    return (await import("../upload-wallet-chain.js")).walletUploadReads(network, relayUrl);
}
async function signers() {
    const signing = await import("../wallet-sign.js");
    return { register: signing.signBlobRegister, certify: signing.signBlobCertify };
}
