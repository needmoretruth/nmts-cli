// `nmts wallet storage split|merge|transfer` — reshaping the storage resources the wallet holds,
// and handing one over. ⛔ EACH SIGNS. The storage-control half a terminal can do: the browser's
// rules (`shared/lib/storage-control/plan.ts`, copied byte-for-byte) say what the contract allows;
// the dry run is the final judge; the review comes before the signature; `--yes` is the answer.
//
// ⛔ THE ORDER IS THE SAFETY, as in `wallet-send.ts`: ① the resources are READ from the chain and
//    the named ones must be this wallet's ② the rules judge the request and say why not ③ the
//    exact transaction is dry-run for its fee, and a refusal there is printed and ends the run
//    ④ the review ⑤ without `--yes` that is the end ⑥ the wallet unlock is held against the fee —
//    scope `storage` for cutting and joining, scope `all` for handing over ⑦ only then the signature.
//
// ⛔ HANDING OVER MOVES NO FILE. The owner's sentence for the browser holds here: what goes is size
//    and remaining time; a file's bytes are sealed with keys the NMTS key derives and stay
//    unreadable to whoever receives the resource. It cannot be undone and NMTS cannot recall it.
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { canFuse, statusOf } from "../shared/lib/storage-control/plan.js";
import { explorerTxUrl } from "../shared/lib/wallet/activity.js";
import { isValidSuiAddress } from "../shared/lib/wallet/send-rules.js";
import { storageOpsReads } from "../storage-control-chain.js";
import { coinAmount, walletAddress } from "../wallet.js";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
import { formatBytes } from "./wallet-storage.js";
const FUSE_WHY = {
    same: "those are the same resource.",
    differentSize: "their periods differ and so do their sizes — the contract joins sizes only over an identical period, and periods only at an identical size.",
    differentPeriod: "their periods differ.",
    notAdjacent: "their sizes are equal but their periods do not touch — one has to end where the other starts.",
};
export async function walletStorageOps(op, rest, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const resolved = await requireAccountCode();
    const address = await walletAddress(resolved.code);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const reads = (options.storageReads ?? storageOpsReads)(network);
    // ① The resources, and which epoch it is.
    let read;
    try {
        read = await reads.readStorage(address);
    }
    catch (error) {
        throw new NmtsError("The storage resources could not be read from the chain.", {
            exitCode: 1,
            nextStep: `Nothing was signed. Cause: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
    const held = (id) => {
        const found = read.items.find((r) => r.objectId === id);
        if (found === undefined) {
            throw new NmtsError(`This wallet holds no free storage resource ${id}.`, {
                exitCode: 4,
                nextStep: `\`${BINARY_NAME} wallet storage\` lists the ones it holds. A resource bound inside a file is not free.`,
            });
        }
        return found;
    };
    // ② The request, judged.
    const { shape, action, lines, command } = plan(op, rest, options, held);
    const walrusPackageId = await reads.walrusPackageId();
    // ③ The dry run: the fee, or the contract's own refusal.
    const verdict = await reads.dryRun(shape, address);
    if (verdict.refusal !== null) {
        throw new NmtsError(`The chain would refuse this: ${verdict.refusal}`, {
            exitCode: 4,
            nextStep: "Nothing was signed and no fee was spent.",
        });
    }
    const feeMist = verdict.feeMist;
    const facts = { op, network, address, shape, feeSui: feeMist === null ? null : coinAmount(feeMist), currentEpoch: read.currentEpoch };
    // ④ The review.
    if (!options.json) {
        say(`Would ${lines.what}`);
        for (const l of lines.detail)
            say(`  ${l}`);
        say(feeMist === null
            ? `  Chain fee (SUI): could not be measured just now; it is charged with the signature.`
            : `  Chain fee about ${facts.feeSui} SUI, measured by a dry run just now.`);
        if (op === "transfer") {
            say(`  ⛔ No file goes with it. What goes is size and remaining time; the files stay sealed with this`);
            say(`     account's keys. It cannot be undone, and NMTS cannot recall it. Check the address once more.`);
        }
    }
    // ⑤ Without --yes, that is the end.
    if (options.dryRun === true || options.yes !== true) {
        if (options.json) {
            say(JSON.stringify({ ...facts, signed: false, dryRun: options.dryRun === true }));
            return options.dryRun === true ? 0 : 4;
        }
        say(``);
        if (options.dryRun === true) {
            say(`  Nothing was signed. Run the same command with --yes to do it.`);
            return 0;
        }
        throw new NmtsError(`Nothing was signed: this needs --yes.`, {
            exitCode: 4,
            nextStep: `Read the review above, then: \`${command} --yes\``,
        });
    }
    // ⑥ The unlock, held against the fee. ⑦ The signature.
    const spend = { walFrost: 0n, suiMist: feeMist ?? 0n };
    requireWalletGrant(action, spend, new Date(options.now ?? Date.now()));
    const sign = options.signStorage ?? (await import("../wallet-sign.js")).signStorageOp;
    const digest = await sign({ network, code: resolved.code, shape, walrusPackageId });
    recordWalletSpend(spend);
    if (options.json) {
        say(JSON.stringify({ ...facts, signed: true, digest, explorerUrl: explorerTxUrl(digest, network) }));
        return 0;
    }
    say(``);
    say(`  Done. Transaction ${digest}`);
    say(`  ${explorerTxUrl(digest, network)}`);
    say(`  \`${BINARY_NAME} wallet storage\` lists what the wallet holds now.`);
    return 0;
}
/** The shape one request is, the unlock action it needs, and the review's words. */
function plan(op, rest, options, held) {
    const [a, b] = rest;
    const resource = (r) => `${formatBytes(r.sizeBytes)} · epoch ${r.startEpoch} to ${r.endEpoch} (${r.objectId})`;
    if (op === "split") {
        if (a === undefined)
            throw usage("split <resource id> --size <bytes> | --epochs <n>");
        const r = held(a);
        if (options.size !== undefined && options.epochs !== undefined)
            throw usage("split takes --size OR --epochs, not both");
        if (options.size !== undefined) {
            const keep = parseBytes(options.size);
            if (keep <= 0 || keep >= r.sizeBytes) {
                throw new NmtsError(`--size must be above 0 and below the resource's ${formatBytes(r.sizeBytes)}.`, { exitCode: 2 });
            }
            return {
                shape: { kind: "splitSize", objectId: a, keepBytes: keep },
                action: "reshape",
                lines: {
                    what: `cut ${resource(r)} by size.`,
                    detail: [`It keeps ${formatBytes(keep)}; a new resource of ${formatBytes(r.sizeBytes - keep)} over the same period appears in this wallet.`],
                },
                command: `${BINARY_NAME} wallet storage split ${a} --size ${options.size}`,
            };
        }
        if (options.epochs !== undefined) {
            const n = Number(options.epochs);
            const span = r.endEpoch - r.startEpoch;
            if (!Number.isSafeInteger(n) || n <= 0 || n >= span) {
                throw new NmtsError(`--epochs must be a whole number above 0 and below the resource's ${span} epochs.`, { exitCode: 2 });
            }
            const at = r.startEpoch + n;
            return {
                shape: { kind: "splitEpoch", objectId: a, splitEpoch: at },
                action: "reshape",
                lines: {
                    what: `cut ${resource(r)} by period.`,
                    detail: [`It keeps epoch ${r.startEpoch} to ${at}; a new resource of the same size over epoch ${at} to ${r.endEpoch} appears in this wallet.`],
                },
                command: `${BINARY_NAME} wallet storage split ${a} --epochs ${options.epochs}`,
            };
        }
        throw usage("split <resource id> --size <bytes> | --epochs <n>");
    }
    if (op === "merge") {
        if (a === undefined || b === undefined)
            throw usage("merge <resource id> <resource id>");
        const first = held(a);
        const second = held(b);
        const verdict = canFuse(first, second);
        if (!verdict.can) {
            throw new NmtsError(`These two cannot be joined: ${FUSE_WHY[verdict.why]}`, {
                exitCode: 4,
                nextStep: `Nothing was signed. \`${BINARY_NAME} wallet storage\` shows each one's size and period.`,
            });
        }
        return {
            shape: { kind: "fuse", first: a, second: b, how: verdict.kind },
            action: "reshape",
            lines: {
                what: `join ${resource(second)} into ${resource(first)}.`,
                detail: [
                    verdict.kind === "amount"
                        ? `Same period, so the sizes add: the first becomes ${formatBytes(first.sizeBytes + second.sizeBytes)} and the second is gone.`
                        : `Same size and touching periods, so the periods join: the first spans epoch ${Math.min(first.startEpoch, second.startEpoch)} to ${Math.max(first.endEpoch, second.endEpoch)} and the second is gone.`,
                ],
            },
            command: `${BINARY_NAME} wallet storage merge ${a} ${b}`,
        };
    }
    if (a === undefined || b === undefined)
        throw usage("transfer <resource id> <address>");
    const r = held(a);
    if (!isValidSuiAddress(b)) {
        throw new NmtsError("That is not a Sui address: it is 0x followed by 64 hexadecimal characters.", { exitCode: 2 });
    }
    return {
        shape: { kind: "transfer", objectId: a, to: b },
        action: "give",
        lines: { what: `hand ${resource(r)} to ${b}.`, detail: [`Afterwards this wallet no longer holds it.`] },
        command: `${BINARY_NAME} wallet storage transfer ${a} ${b}`,
    };
}
function usage(form) {
    return new NmtsError(`\`${BINARY_NAME} wallet storage ${form}\``, { exitCode: 2 });
}
/** "500MiB", "1GiB", "4096" — bytes, in binary units, the way the listing prints them. */
export function parseBytes(text) {
    const m = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB)?$/i.exec(text.trim());
    if (m === null || m[1] === undefined)
        throw new NmtsError("--size is a number of bytes, or one with KiB, MiB or GiB.", { exitCode: 2 });
    const unit = (m[2] ?? "B").toLowerCase();
    const scale = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }[unit] ?? 1;
    return Math.floor(Number(m[1]) * scale);
}
