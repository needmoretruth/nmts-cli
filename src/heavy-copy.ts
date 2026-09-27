// Every sentence NMTS Heavy adds to this tool that a person or an agent reads — in one table.
//
// ⛔ Code never builds a Heavy sentence anywhere else; a new sentence is a new row here.
//
// ⭐ TWO REGISTERS, ON PURPOSE. What `--tier heavy` says with credits or the wallet uses the drive's
//    words — the file is kept whole in two separate places — and names no network, company or token:
//    a person choosing Heavy never has to learn one. The self-paid road (`--pay evm`, `heavy wallet`,
//    `heavy fund`) is the developer's handle on Filecoin itself (what Filecoin allows directly must
//    work here too), so it says Filecoin, USDFC and FIL plainly.
//
// ⚠ Values that take numbers are functions, so the wording can put the number where it reads best.

/** What each runner phase is called on the progress lines. An unknown phase prints as itself. */
const PHASE: Readonly<Record<string, string>> = {
  opened: "order opened",
  sealing: "encrypting",
  hashing: "computing the piece id",
  placing: "choosing where it is kept",
  uploading: "uploading",
  committing: "waiting for both places to confirm",
  stored: "stored",
  paying: "paying from the wallet",
  paid: "paid",
};

/** What a stopped Heavy upload means for the money, by the runner's reason word. */
function failedNextFor(reason: string): string {
  if (reason === "payment_refused") {
    return (
      "The file was stored, but the server did not accept the payment. Look at `nmts wallet activity`: " +
      "if the WAL left the wallet, write to us with `nmts support` and the transaction. Unpaid pieces " +
      "are removed after an hour."
    );
  }
  if (reason === "piece_too_small" || reason === "piece_too_large" || reason === "slot_count" || reason === "sealed_len_mismatch") {
    return "Nothing was stored. This is a fault in this tool, not in the file — please write to us with `nmts support`.";
  }
  return (
    "Credits for anything that was not stored come back within a day, and a wallet pays nothing until " +
    "every part is stored. Running the same command again starts a new upload."
  );
}

export const HEAVY_COPY = {
  /** `put --tier heavy`: the line before the upload starts (credits). */
  creditsPlan: (name: string, bytes: number, credits: number) =>
    `${name}  ${bytes} bytes  →  ${credits} credit${credits === 1 ? "" : "s"}  ·  NMTS Heavy: kept whole in two separate places for 28 days`,
  /** `put --tier heavy --pay wallet`: the review line with the order's WAL price and term. */
  walletPlan: (name: string, bytes: number, wal: string, days: number, from: string, to: string) =>
    `${name}  ${bytes} bytes  →  ${wal} WAL for ${days} day${days === 1 ? "" : "s"}, paid once it is stored, from ${from} to ${to}  ·  NMTS Heavy`,
  /** `put --tier heavy --pay evm`: the review line (copies, paying 0x address). */
  evmPlan: (name: string, bytes: number, copies: number, address: string) =>
    `${name}  ${bytes} bytes  →  ${copies} cop${copies === 1 ? "y" : "ies"} on Filecoin, paid in USDFC by ${address}`,
  /** `--dry-run --tier heavy --pay wallet`: the plan line before any order opens (no price yet). */
  walletDryPlan: (name: string, bytes: number, days: number, from: string) =>
    `${name}  ${bytes} bytes  →  NMTS Heavy for ${days} day${days === 1 ? "" : "s"}, paid from ${from} once it is stored`,
  /** `--dry-run` with `--tier heavy`: the closing line (nothing sent; a wallet price is quoted only when an order opens). */
  dryRunEnd:
    "  Nothing was sent and nothing was charged. The WAL or USDFC price is set when the upload runs; run the same command without --dry-run to see it before anything is paid.",
  /** Progress, one line per phase of one part. */
  progress: (phase: string, where: string) => `  ${PHASE[phase] ?? phase}${where}`,
  /** Finished: the Filecoin epoch it is kept until. */
  stored: (expiryEpoch: number) => `  kept until Filecoin epoch ${expiryEpoch}`,
  /** A Heavy upload stopped (`HeavyOrderError`): the reason word and the runner's detail. */
  failed: (reason: string, detail: string) => `The NMTS Heavy upload stopped (${reason}): ${detail}`,
  failedNext: (reason: string) => failedNextFor(reason),
  /** POST /v1/items answered without an id (the pieces are stored; a rerun opens a NEW order). */
  commitNoId: "The file was stored, but the server did not say which file it became.",
  commitNoIdNext: "Run `nmts ls` to look for it before trying again: running the same command again is a new upload and is paid again.",
  /** Server refusal advice (`api-advice.ts`): Heavy paid from the wallet is off on this server. */
  adviceWalletPayOff: "Paying for NMTS Heavy from the wallet is switched off on this server. Pay with credits: leave out --pay wallet.",
  /** Server refusal advice: Heavy storage is unavailable right now (chain service down or at its day limit). */
  adviceUnavailable: "NMTS Heavy cannot take uploads on this server right now. Nothing was charged. Try again later, or upload with --tier standard.",
  /** Server refusal advice: the wallet price cannot be set right now (the WAL quotes disagree or are stale). */
  advicePriceUnavailable:
    "NMTS Heavy cannot set a WAL price right now, so nothing was charged. Pay with credits (leave out --pay wallet), or try again in a few minutes.",
  /** Server refusal advice: this account's unpaid wallet orders reached the day's ceiling (UTC day). */
  adviceUnpaidCap:
    "Today's limit of unpaid NMTS Heavy wallet uploads is reached, so nothing was charged. Pay with credits (leave out --pay wallet), or upload again after midnight UTC.",
  /** `--tier heavy --pay evm` where no storage company is listed, refused before anything is spent. */
  evmNoProviders: (chain: string) => `Paying Filecoin yourself is not available on ${chain} in this version. Nothing was spent.`,
  /** A flag that only means something with `--pay evm` was given without it. */
  evmOnlyFlag: (flag: string) => `${flag} only applies with --tier heavy --pay evm: it chooses where your own payment stores the file.`,
  /** `--pay evm` without `--tier heavy`. */
  evmNeedsHeavy: "--pay evm pays Filecoin, so it needs --tier heavy.",
  /** A Standard-only option (`--epochs`, `--storage`, `--from`, `--deposit`, `--part-size`) given with `--tier heavy`. */
  standardOnlyFlag: (flag: string) => `${flag} does not apply to --tier heavy.`,
  /** A Heavy-only option (`--copies`, `--providers`, `--evm-wallet`, `--days`) given without `--tier heavy`. */
  heavyOnlyFlag: (flag: string) => `${flag} only applies with --tier heavy.`,
  /** `--days` given with a Heavy payer other than the wallet (credits keep 28 days; evm lasts as long as the deposit). */
  walletOnlyDays: "--days only applies with --tier heavy --pay wallet: credits keep a file 28 days, and --pay evm keeps it as long as the deposit lasts.",
  /** `--days` out of 1..365. */
  badDays: (raw: string) => `--days takes a whole number from 1 to 365, not "${raw}".`,
  /** The wallet holds less WAL (or SUI for the fee) than the order's price — refused before anything is sealed. */
  walletShort: (needWal: string, haveWal: string, needSui: string, haveSui: string) =>
    `The wallet is short: this upload needs ${needWal} WAL and about ${needSui} SUI for the fee, and the wallet holds ${haveWal} WAL and ${haveSui} SUI. Nothing was stored or paid.`,
  /** `--copies` out of 1..12, or `--providers` not a list of ids. */
  badCopies: (raw: string) => `--copies takes a whole number from 1 to 12, not "${raw}".`,
  badProviders: (raw: string) => `--providers takes storage provider ids separated by commas, such as 4,9 — not "${raw}".`,
  /** A self-paid upload stored no copy at all (the SDK answered no copies). */
  evmNoCopy: (detail: string) => `No storage provider kept the piece: ${detail}`,
  /** `heavy wallet` output labels. */
  walletAddress: "address",
  walletFil: "FIL",
  walletUsdfc: "USDFC",
  walletDeposit: "deposit (available)",
  walletRunway: "lasts to epoch",
  /** `heavy fund`: the review before signing, the `--yes` refusal, and the done line. */
  fundReview: (usdfc: string, address: string) => `Deposit ${usdfc} USDFC from ${address} into Filecoin Pay, for --pay evm uploads.`,
  fundNeedsYes: "Nothing was signed. Depositing spends from the wallet: run it again with --yes.",
  fundNothing: "The deposit already covers this amount. Nothing was signed.",
  fundDone: (hash: string) => `  deposited — transaction ${hash}`,
  fundBadAmount: (raw: string) => `heavy fund takes an amount of USDFC above zero, such as 5 or 2.5 — not "${raw}".`,
  /** The SDK's `put(…, { tier })`: an option given on the tier or payer it means nothing to. */
  sdkHeavyOnly: (option: string) => `\`${option}\` only applies with tier: "heavy".`,
  sdkNotHeavy: (option: string) => `\`${option}\` does not apply to tier: "heavy".`,
  sdkPayerOnly: (option: string, pay: string) => `\`${option}\` only applies with tier: "heavy" and pay: ${pay}.`,
  /** The SDK: `pay: { signer }` on Heavy is an EVM account; on Standard it is a Sui wallet. */
  sdkEvmSigner: `On tier: "heavy", pay: { signer } is an EVM account, such as viem's privateKeyToAccount().`,
  sdkSuiSigner: `An EVM account pays only with tier: "heavy". On tier: "standard", pay: { signer } is a Sui wallet.`,
  /** `heavy` with no or an unknown verb. */
  heavyVerb: "Use `nmts heavy wallet` or `nmts heavy fund <USDFC>`.",
} as const;
