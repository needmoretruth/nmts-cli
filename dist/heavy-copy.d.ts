export declare const HEAVY_COPY: {
    /** `put --tier heavy`: the line before the upload starts (credits). */
    readonly creditsPlan: (name: string, bytes: number, credits: number) => string;
    /** `put --tier heavy --pay wallet`: the review line with the order's WAL price and term. */
    readonly walletPlan: (name: string, bytes: number, wal: string, days: number, from: string, to: string) => string;
    /** `put --tier heavy --pay evm`: the review line (copies, paying 0x address). */
    readonly evmPlan: (name: string, bytes: number, copies: number, address: string) => string;
    /** `--dry-run --tier heavy --pay wallet`: the plan line before any order opens (no price yet). */
    readonly walletDryPlan: (name: string, bytes: number, days: number, from: string) => string;
    /** `--dry-run` with `--tier heavy`: the closing line (nothing sent; a wallet price is quoted only when an order opens). */
    readonly dryRunEnd: "  Nothing was sent and nothing was charged. The WAL or USDFC price is set when the upload runs; run the same command without --dry-run to see it before anything is paid.";
    /** Progress, one line per phase of one part. */
    readonly progress: (phase: string, where: string) => string;
    /** Finished: the Filecoin epoch it is kept until. */
    readonly stored: (expiryEpoch: number) => string;
    /** A Heavy upload stopped (`HeavyOrderError`): the reason word and the runner's detail. */
    readonly failed: (reason: string, detail: string) => string;
    readonly failedNext: (reason: string) => string;
    /** POST /v1/items answered without an id (the pieces are stored; a rerun opens a NEW order). */
    readonly commitNoId: "The file was stored, but the server did not say which file it became.";
    readonly commitNoIdNext: "Run `nmts ls` to look for it before trying again: running the same command again is a new upload and is paid again.";
    /** Server refusal advice (`api-advice.ts`): Heavy paid from the wallet is off on this server. */
    readonly adviceWalletPayOff: "Paying for NMTS Heavy from the wallet is switched off on this server. Pay with credits: leave out --pay wallet.";
    /** Server refusal advice: Heavy storage is unavailable right now (chain service down or at its day limit). */
    readonly adviceUnavailable: "NMTS Heavy cannot take uploads on this server right now. Nothing was charged. Try again later, or upload with --tier standard.";
    /** Server refusal advice: the wallet price cannot be set right now (the WAL quotes disagree or are stale). */
    readonly advicePriceUnavailable: "NMTS Heavy cannot set a WAL price right now, so nothing was charged. Pay with credits (leave out --pay wallet), or try again in a few minutes.";
    /** Server refusal advice: this account's unpaid wallet orders reached the day's ceiling (UTC day). */
    readonly adviceUnpaidCap: "Today's limit of unpaid NMTS Heavy wallet uploads is reached, so nothing was charged. Pay with credits (leave out --pay wallet), or upload again after midnight UTC.";
    /** `--tier heavy --pay evm` where no storage company is listed, refused before anything is spent. */
    readonly evmNoProviders: (chain: string) => string;
    /** A flag that only means something with `--pay evm` was given without it. */
    readonly evmOnlyFlag: (flag: string) => string;
    /** `--pay evm` without `--tier heavy`. */
    readonly evmNeedsHeavy: "--pay evm pays Filecoin, so it needs --tier heavy.";
    /** A Standard-only option (`--epochs`, `--storage`, `--from`, `--deposit`, `--part-size`) given with `--tier heavy`. */
    readonly standardOnlyFlag: (flag: string) => string;
    /** A Heavy-only option (`--copies`, `--providers`, `--evm-wallet`, `--days`) given without `--tier heavy`. */
    readonly heavyOnlyFlag: (flag: string) => string;
    /** `--days` given with a Heavy payer other than the wallet (credits keep 28 days; evm lasts as long as the deposit). */
    readonly walletOnlyDays: "--days only applies with --tier heavy --pay wallet: credits keep a file 28 days, and --pay evm keeps it as long as the deposit lasts.";
    /** `--days` out of 1..365. */
    readonly badDays: (raw: string) => string;
    /** The wallet holds less WAL (or SUI for the fee) than the order's price — refused before anything is sealed. */
    readonly walletShort: (needWal: string, haveWal: string, needSui: string, haveSui: string) => string;
    /** `--copies` out of 1..12, or `--providers` not a list of ids. */
    readonly badCopies: (raw: string) => string;
    readonly badProviders: (raw: string) => string;
    /** A self-paid upload stored no copy at all (the SDK answered no copies). */
    readonly evmNoCopy: (detail: string) => string;
    /** `heavy wallet` output labels. */
    readonly walletAddress: "address";
    readonly walletFil: "FIL";
    readonly walletUsdfc: "USDFC";
    readonly walletDeposit: "deposit (available)";
    readonly walletRunway: "lasts to epoch";
    /** `heavy fund`: the review before signing, the `--yes` refusal, and the done line. */
    readonly fundReview: (usdfc: string, address: string) => string;
    readonly fundNeedsYes: "Nothing was signed. Depositing spends from the wallet: run it again with --yes.";
    readonly fundNothing: "The deposit already covers this amount. Nothing was signed.";
    readonly fundDone: (hash: string) => string;
    readonly fundBadAmount: (raw: string) => string;
    /** The SDK's `put(…, { tier })`: an option given on the tier or payer it means nothing to. */
    readonly sdkHeavyOnly: (option: string) => string;
    readonly sdkNotHeavy: (option: string) => string;
    readonly sdkPayerOnly: (option: string, pay: string) => string;
    /** The SDK: `pay: { signer }` on Heavy is an EVM account; on Standard it is a Sui wallet. */
    readonly sdkEvmSigner: "On tier: \"heavy\", pay: { signer } is an EVM account, such as viem's privateKeyToAccount().";
    readonly sdkSuiSigner: "An EVM account pays only with tier: \"heavy\". On tier: \"standard\", pay: { signer } is a Sui wallet.";
    /** `heavy` with no or an unknown verb. */
    readonly heavyVerb: "Use `nmts heavy wallet` or `nmts heavy fund <USDFC>`.";
};
