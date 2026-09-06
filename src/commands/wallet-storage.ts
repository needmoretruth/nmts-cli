// `nmts wallet storage` — the storage resources the wallet holds: size × time, bought and not
// bound inside a file.
//
// ⛔ IT READS. What the storage network sells is size and time, not a file; deleting a file from the
//    network returns the remaining time to this wallet, and that is what is listed. Splitting,
//    fusing and spending a resource need a signature and are not here.
//
// ⛔ "NONE" AND "COULD NOT READ" ARE DIFFERENT SENTENCES — holding no resource is normal; failing to
//    read is a reason to look again. The reader (`shared/lib/storage-control/chain.ts`, the
//    browser's own, copied byte-for-byte) throws rather than answering an empty list.

import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { resolveNetwork, type Network } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveServer } from "../server.ts";
import type { StorageResource } from "../shared/lib/storage-control/chain.ts";
import { statusOf, totalUsableBytes, usableFirst } from "../shared/lib/storage-control/plan.ts";
import { walletAddress } from "../wallet.ts";

/** What the chain said: the resources, and which epoch it is (null when the clock could not be read). */
export interface StorageRead {
  items: readonly StorageResource[];
  currentEpoch: number | null;
}

export interface WalletStorageOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. Rejects when the chain could not be read. */
  readStorage?: (network: Network, address: string) => Promise<StorageRead>;
}

export async function walletStorage(options: WalletStorageOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const resolved = await requireAccountCode();
  const address = await walletAddress(resolved.code);
  const stored =
    resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);

  const read =
    options.readStorage ??
    (async (net: Network, addr: string) => (await import("../wallet-storage-chain.ts")).readWalletStorage(net, addr));
  let got: StorageRead;
  try {
    got = await read(network, address);
  } catch (error) {
    throw new NmtsError("The storage resources could not be read from the chain.", {
      exitCode: 1,
      nextStep:
        `That is not the same as holding none. \`${BINARY_NAME} env\` says which network was asked. ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const epoch = got.currentEpoch;
  const items = epoch === null ? [...got.items] : usableFirst(got.items, epoch);

  if (options.json) {
    say(
      JSON.stringify({
        address,
        network,
        currentEpoch: epoch,
        usableBytes: epoch === null ? null : totalUsableBytes(items, epoch),
        resources: items.map((r) => ({
          objectId: r.objectId,
          sizeBytes: r.sizeBytes,
          startEpoch: r.startEpoch,
          endEpoch: r.endEpoch,
          status: epoch === null ? null : statusOf(r, epoch),
        })),
      }),
    );
    return 0;
  }
  say(`Address  ${address}`);
  say(`Network  ${network}`);
  say(``);
  if (items.length === 0) {
    say(`  This wallet holds no free storage resource. Anything bound inside a file is not listed here.`);
  } else {
    if (epoch !== null) say(`  ${formatBytes(totalUsableBytes(items, epoch))} usable now, in ${items.length} resource${items.length === 1 ? "" : "s"}.`);
    for (const r of items) {
      const status = epoch === null ? "" : `  ${statusWord(statusOf(r, epoch))}`;
      say(`  ${formatBytes(r.sizeBytes).padStart(11)} · epoch ${r.startEpoch} to ${r.endEpoch}${status}`);
      say(`    ${r.objectId}`);
    }
  }
  say(``);
  say(`  What the storage network sells is size and time, not a file. Deleting a file from the`);
  say(`  network returns its remaining time to this wallet, and that is what is listed. Sizes are`);
  say(`  what a resource holds after the network's encoding, not file sizes. Nothing here signs.`);
  if (epoch === null) say(`  The current epoch could not be read, so no line says whether a resource can be used yet.`);
  return 0;
}

function statusWord(status: "lapsed" | "notYet" | "usable"): string {
  return status === "usable" ? "usable now" : status === "notYet" ? "not started" : "ended";
}

/** Bytes for a person: binary units, two decimals, whole bytes below a KiB. */
export function formatBytes(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return unit === "B" ? `${bytes} B` : `${value.toFixed(2)} ${unit}`;
}
