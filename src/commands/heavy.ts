// `nmts heavy wallet` and `nmts heavy fund <USDFC>` — the EVM wallet this NMTS key derives for NMTS
// Heavy's self-paid road (developer mode): what it holds, and filling its Filecoin Pay deposit.
//
// ⛔ `wallet` READS AND NEVER SIGNS. The address is computed offline from the key (`heavy-evm.ts`);
//    the balances are read from the chain with the address alone, so no key is even derived.
//
// ⛔ `fund` SIGNS AND SPENDS, with `wallet send`'s rules: the review first, nothing without `--yes`,
//    the wallet agreement at scope `all`, and Calibration only — refused before anything is read
//    where no storage company is listed. The deposit and the operator approval are one call of the
//    Synapse SDK (`payments.fundSync`, which is what `storage.prepare(…).transaction.execute` runs),
//    given the amount that was typed instead of one it works out from piece sizes.

import type { ParsedArgs } from "../args.ts";
import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { HEAVY_COPY } from "../heavy-copy.ts";
import { evmAddressFor, evmIndexOf, evmKeyOf, hexKey } from "../heavy-evm.ts";
import { selfPayChain, synapseFor } from "../heavy-self-pay.ts";
import { resolveNetwork } from "../network.ts";
import { resolveServer } from "../server.ts";
import { FILECOIN_CHAIN_FOR_NETWORK, type FilecoinChain } from "../shared/lib/filecoin/providers.ts";
import { requireWalletGrant } from "../wallet-grant.ts";

/** USDFC and FIL both count in 18 decimals. */
const DECIMALS = 18;

interface HeavyIo {
  write?: ((line: string) => void) | undefined;
  now?: number;
}

export async function heavy(verb: string | undefined, args: ParsedArgs, io: HeavyIo = {}): Promise<number> {
  if (verb === "wallet") return heavyWallet(args, io);
  if (verb === "fund") return heavyFund(args.operands[1], args, io);
  throw new NmtsError(HEAVY_COPY.heavyVerb, { exitCode: 2 });
}

async function where(args: ParsedArgs): Promise<{ code: string; chain: FilecoinChain; network: "mainnet" | "testnet" }> {
  const resolved = await requireAccountCode();
  const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
  const server = resolveServer(args.server ?? stored?.server);
  const network = resolveNetwork(server, args.network ?? stored?.network);
  return { code: resolved.code, chain: FILECOIN_CHAIN_FOR_NETWORK[network], network };
}

async function readPurse(address: `0x${string}`, chain: FilecoinChain) {
  const synapse = await synapseFor(address, chain);
  const [fil, usdfc, summary] = await Promise.all([
    synapse.payments.walletBalance(),
    synapse.payments.walletBalance({ token: "USDFC" }),
    synapse.payments.accountSummary(),
  ]);
  return { fil, usdfc, summary };
}

async function heavyWallet(args: ParsedArgs, io: HeavyIo): Promise<number> {
  const say = io.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const index = evmIndexOf(args.index);
  const { code, chain } = await where(args);
  const address = await evmAddressFor(code, index);
  const { formatUnits } = await import("viem");
  const purse = await readPurse(address, chain);
  const coins = (value: bigint): string => formatUnits(value, DECIMALS);
  const facts = {
    index,
    address,
    chain,
    fil: coins(purse.fil),
    usdfc: coins(purse.usdfc),
    deposit: coins(purse.summary.funds),
    available: coins(purse.summary.availableFunds),
    lockupPerEpoch: coins(purse.summary.lockupRatePerEpoch),
    epoch: purse.summary.epoch.toString(),
    runwayEpochs: purse.summary.runwayInEpochs.toString(),
  };
  if (args.json) {
    say(JSON.stringify(facts));
    return 0;
  }
  say(`${HEAVY_COPY.walletAddress}  ${address}`);
  say(`${HEAVY_COPY.walletFil}  ${facts.fil}`);
  say(`${HEAVY_COPY.walletUsdfc}  ${facts.usdfc}`);
  say(`${HEAVY_COPY.walletDeposit}  ${facts.deposit} (${facts.available})`);
  say(`${HEAVY_COPY.walletRunway}  ${facts.epoch} + ${facts.runwayEpochs}`);
  return 0;
}

async function heavyFund(amountRaw: string | undefined, args: ParsedArgs, io: HeavyIo): Promise<number> {
  const say = io.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const index = evmIndexOf(args.index);
  const { code, network } = await where(args);
  // ⛔ BEFORE ANYTHING IS READ: no listed company on this chain means nothing to fund for.
  const chain = selfPayChain(network);
  const { formatUnits, parseUnits } = await import("viem");
  let amount: bigint;
  try {
    amount = parseUnits((amountRaw ?? "").trim(), DECIMALS);
  } catch {
    // viem refuses what is not a decimal number; the words are this tool's.
    amount = 0n;
  }
  if (amountRaw === undefined || amount <= 0n) throw new NmtsError(HEAVY_COPY.fundBadAmount(amountRaw ?? ""), { exitCode: 2 });
  const address = await evmAddressFor(code, index);
  const purse = await readPurse(address, chain);
  const facts = { index, address, chain, amount: formatUnits(amount, DECIMALS), usdfc: formatUnits(purse.usdfc, DECIMALS), deposit: formatUnits(purse.summary.funds, DECIMALS) };
  if (!args.json) {
    say(HEAVY_COPY.fundReview(facts.amount, address));
    say(`${HEAVY_COPY.walletUsdfc}  ${facts.usdfc}`);
    say(`${HEAVY_COPY.walletDeposit}  ${facts.deposit}`);
  }
  if (args.dryRun || !args.yes) {
    if (args.json) say(JSON.stringify({ ...facts, signed: false, dryRun: args.dryRun }));
    if (args.dryRun) return 0;
    throw new NmtsError(HEAVY_COPY.fundNeedsYes, { exitCode: 4 });
  }
  requireWalletGrant("send", { walFrost: 0n, suiMist: 0n }, new Date(io.now ?? Date.now()));
  const key = await evmKeyOf(code, index);
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(hexKey(key));
  key.fill(0);
  const synapse = await synapseFor(account, chain);
  const done = await synapse.payments.fundSync({ amount });
  if (args.json) {
    say(JSON.stringify({ ...facts, signed: true, hash: done.hash }));
    return 0;
  }
  say(HEAVY_COPY.fundDone(done.hash));
  return 0;
}
