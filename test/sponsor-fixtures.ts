// The three sponsored transactions recorded on testnet, the chain facts read then, and the tools
// the tests use to change one and serialise it again. Shared by the command-line package's check
// tests and the SDK's `sponsor()` tests, so both judge the same real bytes.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bcs } from "@mysten/sui/bcs";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";

import type { SponsorFacts } from "../src/sponsor-check.ts";

const dir = join(import.meta.dirname, "fixtures", "sponsor");
const read = (name: string): string => readFileSync(join(dir, name), "utf8").trim();
export const REGISTER = read("register.b64");
export const CERTIFY = read("certify.b64");
export const EXTEND = read("extend.b64");
export const table: {
  operator: string;
  walrusPackageId: string;
  systemObjectId: string;
  relayTipAddresses: string[];
  encodedLength: Record<string, number>;
  blobSize: Record<string, number>;
} = JSON.parse(read("facts.json"));
export const OPERATOR = table.operator;
export const ATTACKER = `0x${"ad".repeat(32)}`;

export function facts(over: Partial<SponsorFacts> = {}): SponsorFacts {
  return {
    walrusPackageId: table.walrusPackageId,
    systemObjectId: table.systemObjectId,
    relayTipAddresses: table.relayTipAddresses,
    encodedLength: async (size) => {
      const known = table.encodedLength[String(size)];
      if (known === undefined) throw new Error(`no encoded length recorded for ${size}`);
      return known;
    },
    blobSize: async (id) => table.blobSize[id] ?? null,
    ...over,
  };
}

export type Data = ReturnType<Transaction["getData"]>;
export type Command = Data["commands"][number];
export type Argument = NonNullable<Command["TransferObjects"]>["address"];

/** The recorded transaction with `edit` applied to its data, serialised again. Nothing is resolved. */
export async function mutate(b64: string, edit: (data: Data) => void): Promise<Uint8Array> {
  const data = structuredClone(Transaction.from(b64).getData());
  edit(data);
  return TransactionDataBuilder.restore(data).build();
}

/** Every argument a command holds, so an index can be moved when a command is put in before it. */
function argsOf(command: Command): Argument[] {
  const c: Record<string, unknown> = command;
  const out: Argument[] = [];
  const isArgument = (v: object): v is Argument =>
    "$kind" in v && (v.$kind === "Input" || v.$kind === "Result" || v.$kind === "NestedResult" || v.$kind === "GasCoin");
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object" && v !== null) {
      if (isArgument(v)) out.push(v);
      else Object.values(v).forEach(walk);
    }
  };
  walk(c[command.$kind]);
  return out;
}

/** Put `command` at `at`, moving every later result reference along by one. */
export function insert(data: Data, at: number, command: Command): void {
  for (const c of data.commands) {
    for (const a of argsOf(c)) {
      if (a.$kind === "Result" && a.Result >= at) a.Result += 1;
      if (a.$kind === "NestedResult" && a.NestedResult[0] >= at) a.NestedResult[0] += 1;
    }
  }
  data.commands.splice(at, 0, command);
}

export const pureAddress = (address: string): Data["inputs"][number] => ({ $kind: "Pure", Pure: { bytes: toBase64(bcs.Address.serialize(address).toBytes()) } });
export const pureU64 = (n: bigint): Data["inputs"][number] => ({ $kind: "Pure", Pure: { bytes: toBase64(bcs.u64().serialize(n).toBytes()) } });
/** Add an input and return its index. */
export function addInput(data: Data, input: Data["inputs"][number]): number {
  data.inputs.push(input);
  return data.inputs.length - 1;
}
export const moveCall = (data: Data, index: number): NonNullable<Command["MoveCall"]> => {
  const call = data.commands[index]?.MoveCall;
  if (call === undefined || call === null) throw new Error(`command ${index} is not a Move call`);
  return call;
};

/** The recorded transaction with every mention of the recording's operator replaced by `address`. */
export function readdressed(b64: string, address: string): Promise<Uint8Array> {
  const from = bcs.Address.serialize(OPERATOR).toBase64();
  const to = bcs.Address.serialize(address).toBase64();
  return mutate(b64, (d) => {
    d.sender = address;
    d.gasData.owner = address;
    for (const input of d.inputs) if (input.Pure?.bytes === from) input.Pure.bytes = to;
  });
}
