// Before an operator's wallet signs a transaction somebody else's device built: is it only the
// Walrus work the operator agreed to pay for, inside the limits it set?
//
// ⛔ WHY (spec 2026-09-20 Deponejo · gap B · plan 2026-11-10 §1.3). A business that takes its
//    customers' money however it likes can let its own wallet pay their storage: the device calls
//    `put(file, { pay: { signer } })` and that signer forwards each transaction to the business's
//    server, which signs as the sender. Without a check the server signs whatever bytes arrive —
//    including a transaction that sends the business's coins to the person who built it. Sui's own
//    gas sponsorship was rejected: it pays only the gas, and WAL can come only from the sender.
//
// ⛔ AN ALLOW LIST, READ OFF THE BYTES, NEVER A DENY LIST. What passes is exactly: the sender and the
//    gas owner are the operator; every Move call is `system::reserve_space`, `register_blob`,
//    `certify_blob` or `extend_blob` of the network's Walrus package on the network's own system
//    object, or the coin plumbing the Sui SDK writes for a payment (`coin::redeem_funds`,
//    `coin::destroy_zero`, `coin::zero`, `coin::send_funds` back to the operator); every transfer
//    goes to the operator, except SUI coins of a known amount to an upload relay's tip address; and
//    the size, the term, the WAL and the SUI are within the policy. Anything else is refused with a
//    code and a sentence a log can hold. A new kind of command is refused until somebody decides it
//    here, in the open.
//
// ⛔ EVERY COIN THAT LEAVES IS A COIN OF A KNOWN AMOUNT. The WAL a Walrus call may take is bounded by
//    the coins it is handed: each must be cut by `SplitCoins` to an amount written in the bytes (or
//    drawn from the address balance by a reservation of a written amount), and not grown by a merge
//    since. A whole coin, the gas coin, or a coin of unknown amount handed to any call is refused —
//    so even a lying node that named a wrong package could not take more than the policy's WAL.
//
// ⚠ PURE: no network and no key. The chain facts it needs — the package, the relays' tip addresses,
//   the encoded length of a size, the size of a blob being extended — are handed in
//   (`sponsor-facts.ts` reads them; a test hands in a table).

import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, normalizeSuiAddress } from "@mysten/sui/utils";

import type { Network } from "./network.ts";

/** What the operator agrees to pay for in ONE transaction. Amounts in base units. */
export interface SponsorPolicy {
  network: Network;
  /** The operator's address: the only sender and gas owner signed for. */
  operator: string;
  /** Bytes the blobs registered or extended may hold in total (unencoded, as registered). */
  maxBytes: number;
  /** The longest term one reservation or extension may buy, in epochs. */
  maxEpochs: number;
  /** WAL the Walrus calls may take, in FROST. */
  maxWalFrost: bigint | number | string;
  /** SUI the transaction may spend — its gas budget plus relay tips — in MIST. */
  maxSuiMist: bigint | number | string;
  /** The highest gas budget accepted, in MIST. Default: `maxSuiMist`. */
  maxGasBudgetMist?: bigint | number | string | undefined;
  /** Pin the Walrus package instead of reading it from the chain. */
  walrusPackageId?: string | undefined;
  /** Pin the relays' tip addresses instead of asking the relays. */
  relayTipAddresses?: readonly string[] | undefined;
}

/** The chain facts a judgement needs. */
export interface SponsorFacts {
  walrusPackageId: string;
  systemObjectId: string;
  relayTipAddresses: readonly string[];
  /** What a blob of `size` bytes occupies once encoded — the chain's own number. */
  encodedLength(size: number): Promise<number>;
  /** The unencoded size of a blob object, or null when it could not be read. */
  blobSize(objectId: string): Promise<number | null>;
}

/** What a passing transaction spends, as decimal strings so a log and JSON carry them whole. */
export interface SponsorSpend {
  walFrost: string;
  /** Gas budget plus tips: the most SUI it can take. */
  suiMist: string;
  gasBudgetMist: string;
  tipMist: string;
  /** Bytes registered or extended. */
  bytes: number;
  /** The longest term bought, in epochs. 0 for a certification. */
  epochs: number;
  /** The Walrus calls it makes, in order. */
  calls: string[];
}

export type SponsorVerdict =
  | { ok: true; spends: SponsorSpend }
  | { ok: false; code: SponsorRefusal; reason: string };

export type SponsorRefusal =
  | "SPONSOR_NOT_A_TRANSACTION"
  | "SPONSOR_SENDER"
  | "SPONSOR_GAS_OWNER"
  | "SPONSOR_GAS_BUDGET"
  | "SPONSOR_INPUT"
  | "SPONSOR_COMMAND"
  | "SPONSOR_CALL"
  | "SPONSOR_NETWORK"
  | "SPONSOR_TRANSFER"
  | "SPONSOR_UNBOUNDED"
  | "SPONSOR_STORAGE"
  | "SPONSOR_SIZE"
  | "SPONSOR_EPOCHS"
  | "SPONSOR_WAL"
  | "SPONSOR_SUI"
  | "SPONSOR_EMPTY";

const WALRUS_CALLS = new Set(["reserve_space", "register_blob", "certify_blob", "extend_blob"]);
const SUI_TYPE = "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI";
const FRAMEWORK = normalizeSuiAddress("0x2");

type Arg = { $kind?: string; GasCoin?: true; Input?: number; Result?: number; NestedResult?: [number, number] };
/** A coin this judgement can vouch for: its type when known, its amount when bounded. */
interface Coin {
  sui: boolean | null;
  amount: bigint | null;
}

class Refused extends Error {
  readonly code: SponsorRefusal;
  constructor(code: SponsorRefusal, reason: string) {
    super(reason);
    this.code = code;
  }
}

function amountOf(value: bigint | number | string, name: string): bigint {
  try {
    const n = BigInt(value);
    if (n >= 0n) return n;
  } catch {
    // Refused below with the field's name.
  }
  throw new Refused("SPONSOR_NOT_A_TRANSACTION", `the policy's ${name} is not a whole number of base units`);
}

function typeIsSui(type: string): boolean {
  const [address, ...rest] = type.split("::");
  return address !== undefined && `${normalizeSuiAddress(address)}::${rest.join("::")}` === SUI_TYPE;
}

/** Judge one transaction against a policy. Never throws for a refusal: the verdict says it. */
export async function judgeSponsored(bytes: Uint8Array | string, policy: SponsorPolicy, facts: SponsorFacts): Promise<SponsorVerdict> {
  try {
    return { ok: true, spends: await judge(bytes, policy, facts) };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, code: error.code, reason: error.message };
    throw error;
  }
}

async function judge(raw: Uint8Array | string, policy: SponsorPolicy, facts: SponsorFacts): Promise<SponsorSpend> {
  let data: ReturnType<Transaction["getData"]>;
  try {
    data = Transaction.from(typeof raw === "string" ? fromBase64(raw) : raw).getData();
  } catch (error) {
    throw new Refused("SPONSOR_NOT_A_TRANSACTION", `the bytes are not a Sui transaction (${error instanceof Error ? error.message : String(error)})`);
  }
  const operator = normalizeSuiAddress(policy.operator);
  const maxWal = amountOf(policy.maxWalFrost, "maxWalFrost");
  const maxSui = amountOf(policy.maxSuiMist, "maxSuiMist");
  const maxBudget = policy.maxGasBudgetMist === undefined ? maxSui : amountOf(policy.maxGasBudgetMist, "maxGasBudgetMist");
  const walrus = normalizeSuiAddress(policy.walrusPackageId ?? facts.walrusPackageId);
  const system = normalizeSuiAddress(facts.systemObjectId);
  const tipTo = new Set((policy.relayTipAddresses ?? facts.relayTipAddresses).map((a) => normalizeSuiAddress(a)));

  // ① Who signs and who pays the gas.
  if (data.sender === null || data.sender === undefined || normalizeSuiAddress(data.sender) !== operator) {
    throw new Refused("SPONSOR_SENDER", `the sender is ${data.sender ?? "missing"}, not the operator ${operator}`);
  }
  const gasOwner = data.gasData.owner ?? data.sender;
  if (normalizeSuiAddress(gasOwner) !== operator) {
    throw new Refused("SPONSOR_GAS_OWNER", `the gas is paid by ${gasOwner}, not the operator ${operator}`);
  }
  if (data.gasData.budget === null || data.gasData.budget === undefined) {
    throw new Refused("SPONSOR_GAS_BUDGET", "the transaction names no gas budget");
  }
  const budget = BigInt(data.gasData.budget);
  if (budget > maxBudget) throw new Refused("SPONSOR_GAS_BUDGET", `the gas budget ${budget} MIST is over the cap ${maxBudget} MIST`);

  // ② The inputs: plain values, objects, and withdrawals from the operator's own balance only.
  const inputs = data.inputs;
  const pure = (arg: Arg | undefined, what: string): Uint8Array => {
    const input = arg?.Input === undefined ? undefined : inputs[arg.Input];
    if (input?.Pure === undefined) throw new Refused("SPONSOR_INPUT", `${what} is not a plain value written in the transaction`);
    return fromBase64(input.Pure.bytes);
  };
  const u64 = (arg: Arg | undefined, what: string): bigint => BigInt(bcs.u64().parse(pure(arg, what)));
  const u32 = (arg: Arg | undefined, what: string): number => bcs.u32().parse(pure(arg, what));
  const address = (arg: Arg | undefined, what: string): string => normalizeSuiAddress(bcs.Address.parse(pure(arg, what)));
  for (const [i, input] of inputs.entries()) {
    if (input.Object?.Receiving !== undefined) throw new Refused("SPONSOR_INPUT", `input ${i} receives an object sent to another object`);
    const w = input.FundsWithdrawal;
    if (w !== undefined && w.withdrawFrom.Sender !== true && w.withdrawFrom.Sponsor !== true) {
      throw new Refused("SPONSOR_INPUT", `input ${i} withdraws from an allowance, not from the operator's own balance`);
    }
  }

  // ③ The commands, one by one, with every coin followed from where it was made.
  const coins = new Map<string, Coin>();
  const keyOf = (arg: Arg): string | null =>
    arg.Result !== undefined ? `${arg.Result}` : arg.NestedResult !== undefined ? `${arg.NestedResult[0]}:${arg.NestedResult[1]}` : null;
  const reserves = new Map<string, { amount: bigint; epochs: number; used: boolean }>();
  const payments = new Map<string, bigint>();
  const extended: string[] = [];
  const registered: { size: number; reserve: { amount: bigint } }[] = [];
  const calls: string[] = [];
  let tips = 0n;
  let epochs = 0;
  const payment = (arg: Arg | undefined, call: string): void => {
    const key = arg === undefined ? null : keyOf(arg);
    const coin = key === null ? undefined : coins.get(key);
    if (key === null || coin === undefined || coin.amount === null) {
      throw new Refused("SPONSOR_UNBOUNDED", `${call} is paid from a coin whose amount the transaction does not bound`);
    }
    payments.set(key, coin.amount);
  };

  for (const [index, command] of data.commands.entries()) {
    if (command.SplitCoins !== undefined) {
      const source: Arg = command.SplitCoins.coin;
      const from: Coin =
        source.GasCoin === true ? { sui: true, amount: null } : (coins.get(keyOf(source) ?? "") ?? { sui: null, amount: null });
      command.SplitCoins.amounts.forEach((amount: Arg, j: number) => {
        const input = amount.Input === undefined ? undefined : inputs[amount.Input];
        coins.set(`${index}:${j}`, { sui: from.sui, amount: input?.Pure === undefined ? null : u64(amount, "a split amount") });
      });
    } else if (command.MergeCoins !== undefined) {
      // ⛔ A MERGED-INTO COIN NO LONGER HAS THE AMOUNT IT WAS CUT TO: anything could have joined it.
      const key = keyOf(command.MergeCoins.destination);
      const coin = key === null ? undefined : coins.get(key);
      if (key !== null && coin !== undefined) coins.set(key, { sui: coin.sui, amount: null });
    } else if (command.TransferObjects !== undefined) {
      const to = address(command.TransferObjects.address, "a transfer's recipient");
      if (to === operator) continue;
      if (!tipTo.has(to)) throw new Refused("SPONSOR_TRANSFER", `command ${index} sends to ${to}, which is neither the operator nor an upload relay's tip address`);
      for (const object of command.TransferObjects.objects) {
        const coin = coins.get(keyOf(object) ?? "");
        if (coin === undefined || coin.sui !== true || coin.amount === null) {
          throw new Refused("SPONSOR_TRANSFER", `command ${index} sends the relay something other than a SUI coin of a written amount`);
        }
        tips += coin.amount;
      }
    } else if (command.MoveCall !== undefined) {
      const call = command.MoveCall;
      const args: Arg[] = call.arguments;
      const name = `${call.package}::${call.module}::${call.function}`;
      if (args.some((a) => a.GasCoin === true)) throw new Refused("SPONSOR_CALL", `${name} is handed the gas coin`);
      const pkg = normalizeSuiAddress(call.package);
      if (pkg === FRAMEWORK && call.module === "coin") {
        if (call.function === "redeem_funds") {
          const input = args[0]?.Input === undefined ? undefined : inputs[args[0].Input];
          const w = input?.FundsWithdrawal;
          if (w === undefined) throw new Refused("SPONSOR_CALL", `${name} redeems something other than a withdrawal`);
          coins.set(`${index}`, { sui: typeIsSui(w.typeArg.Balance), amount: BigInt(w.reservation.MaxAmountU64) });
        } else if (call.function === "send_funds") {
          const to = address(args[1], "send_funds's recipient");
          if (to !== operator) throw new Refused("SPONSOR_TRANSFER", `command ${index} sends funds to ${to}, not back to the operator`);
        } else if (call.function !== "destroy_zero" && call.function !== "zero") {
          throw new Refused("SPONSOR_CALL", `${name} is not part of paying for Walrus storage`);
        }
        continue;
      }
      if (pkg !== walrus || call.module !== "system" || !WALRUS_CALLS.has(call.function)) {
        throw new Refused("SPONSOR_CALL", `${name} is not a Walrus reservation, registration, certification or extension`);
      }
      // ⛔ THE NETWORK'S OWN SYSTEM OBJECT, which is what proves the network named is the network signed for.
      const self = args[0]?.Input === undefined ? undefined : inputs[args[0].Input]?.Object?.SharedObject;
      if (self === undefined || normalizeSuiAddress(self.objectId) !== system) {
        throw new Refused("SPONSOR_NETWORK", `${call.function} is not called on the ${policy.network} Walrus system object`);
      }
      calls.push(call.function);
      if (call.function === "reserve_space") {
        const term = u32(args[2], "a reservation's term");
        payment(args[3], call.function);
        reserves.set(`${index}`, { amount: u64(args[1], "a reservation's size"), epochs: term, used: false });
        epochs = Math.max(epochs, term);
      } else if (call.function === "register_blob") {
        const reserve = reserves.get(keyOf(args[1] ?? {}) ?? "");
        if (reserve === undefined || reserve.used) {
          throw new Refused("SPONSOR_STORAGE", "a registration binds storage the operator already holds instead of storage bought in this transaction");
        }
        reserve.used = true;
        const size = u64(args[4], "a registration's size");
        if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Refused("SPONSOR_SIZE", `a registration of ${size} bytes`);
        registered.push({ size: Number(size), reserve });
        payment(args[7], call.function);
      } else if (call.function === "extend_blob") {
        const blob = args[1]?.Input === undefined ? undefined : inputs[args[1].Input]?.Object?.ImmOrOwnedObject;
        if (blob === undefined) throw new Refused("SPONSOR_INPUT", "an extension names no blob object");
        extended.push(blob.objectId);
        const term = u32(args[2], "an extension's term");
        epochs = Math.max(epochs, term);
        payment(args[3], call.function);
      }
    } else {
      throw new Refused("SPONSOR_COMMAND", `command ${index} is a ${command.$kind ?? "command"}, which a sponsored upload never needs`);
    }
  }

  // ④ What it all adds up to, against the policy.
  if (calls.length === 0) throw new Refused("SPONSOR_EMPTY", "the transaction does no Walrus work");
  if ([...reserves.values()].some((r) => !r.used)) {
    throw new Refused("SPONSOR_STORAGE", "storage is reserved and not written into: that is buying storage, not an upload");
  }
  let bytes = 0;
  for (const { size, reserve } of registered) {
    bytes += size;
    const most = await facts.encodedLength(size);
    if (reserve.amount > BigInt(most)) {
      throw new Refused("SPONSOR_SIZE", `${reserve.amount} bytes are reserved for a blob of ${size}, which needs ${most} once encoded`);
    }
  }
  for (const id of extended) {
    const size = await facts.blobSize(id);
    if (size === null) throw new Refused("SPONSOR_SIZE", `the size of blob ${id} could not be read, so the extension is not bounded`);
    bytes += size;
  }
  if (bytes > policy.maxBytes) throw new Refused("SPONSOR_SIZE", `${bytes} bytes are over the policy's ${policy.maxBytes}`);
  if (epochs > policy.maxEpochs) throw new Refused("SPONSOR_EPOCHS", `${epochs} epochs are over the policy's ${policy.maxEpochs}`);
  const wal = [...payments.values()].reduce((sum, n) => sum + n, 0n);
  if (wal > maxWal) throw new Refused("SPONSOR_WAL", `${wal} FROST of WAL is over the policy's ${maxWal}`);
  const sui = budget + tips;
  if (sui > maxSui) throw new Refused("SPONSOR_SUI", `${sui} MIST of SUI (gas budget ${budget} + tips ${tips}) is over the policy's ${maxSui}`);
  return {
    walFrost: wal.toString(),
    suiMist: sui.toString(),
    gasBudgetMist: budget.toString(),
    tipMist: tips.toString(),
    bytes,
    epochs,
    calls,
  };
}
