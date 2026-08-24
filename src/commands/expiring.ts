// `nmts expiring` — which files are about to run out of the storage they were paid for.
//
// ⛔ IT IS ITS OWN COMMAND AND NOT A COLUMN IN `ls`. `ls` answers from the sealed file list alone
//    and says so; this answers from three places at once — the chain for the epoch clock, the
//    server for which files end when, and the list for what those files are called. Folding it in
//    would make the cheapest and most-run command in this tool depend on a chain read that can be
//    slow, blocked, or down, and the honest behaviour when that read fails is to STOP. A listing
//    that stops because a storage network is unreachable is a worse listing.
//
// ⛔ NOTHING HERE IS DRAWN AS SAFE BECAUSE IT COULD NOT BE READ. An unreadable clock refuses; a
//    file whose storage period was never recorded is reported as unrecorded and kept out of the
//    ranking; a file the server names and the list does not is printed as an id rather than
//    dropped. Silence is the failure this whole surface exists to prevent — the account screen and
//    this command are the only two places an expiry warning ever appears, because NMTS holds no
//    address to send one to.
//
// ⛔ AND IT BUYS NOTHING. Extending storage moves the person's own coins and is signed by their own
//    wallet; there is no command here that signs. What this does is make the deadline visible in
//    time for somebody to act on it.

import { request } from "../api.ts";
import { buildIndex, fullPathOf } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import {
  daysLeftInWords,
  daysLeftUntilEpoch,
  stageOf,
  warningCutoffEpoch,
  type EpochClock,
  type ExpiryStage,
} from "../expiry.ts";
import { readFileList } from "../manifest.ts";
import { HOME_URL } from "../product.ts";
import { openSession } from "../session.ts";
import { humanSize } from "../units.ts";

export interface ExpiringOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  /**
   * Read the storage network's epoch clock.
   *
   * ⚠ A SEAM, NOT AN OPTION: there is no flag for it and no way to supply one from a command line.
   *   It exists because the alternative is a test that either talks to a real storage network — and
   *   so cannot be run in an epoch change, on a halted chain, or at all offline — or does not
   *   exercise the arithmetic that decides what a person is warned about.
   */
  readClock?: () => Promise<EpochClock | null>;
  /** The instant to measure against. Passed in so one run reports one moment. */
  now?: number;
}

/** One row of the answer, before it is printed either way. */
interface Row {
  id: string;
  /** Null when the server holds this file and the sealed list does not name it. */
  path: string | null;
  size: number | null;
  expiryEpoch: number;
  stage: ExpiryStage;
  daysLeft: number | null;
  daysLeftExact: boolean;
}

export async function expiring(options: ExpiringOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? Date.now();
  const session = await openSession(options);

  const readClock =
    options.readClock ??
    (async () => (await import("../walrus-write.ts")).readEpochWindow(session.network));
  const clock = await readClock();
  if (clock === null) {
    // ⛔ Not "nothing is expiring". The two look identical from outside and mean opposite things.
    throw new NmtsError(`The ${session.network} storage network's epoch clock could not be read.`, {
      exitCode: 1,
      nextStep:
        `Nothing was changed and nothing here can be answered without it: which epoch the network ` +
        `is in is a fact only the chain has, and this tool will not count days from a constant. ` +
        `Try again, or name a different Sui node in NMTS_SUI_RPC.`,
    });
  }

  const cutoff = warningCutoffEpoch(clock);
  const answer = asExpiringAnswer(
    await request(session.server, `/v1/items/expiring?before_epoch=${cutoff}`, { token: session.apiKey }),
  );

  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  const index = buildIndex(list.manifest?.entries ?? []);
  const rows: Row[] = answer.rows.map((row) => {
    const entry = index.byId.get(row.id);
    const stage = stageOf(clock, row.expiryEpoch, now);
    const left = stage === "unrecorded" ? null : daysLeftUntilEpoch(clock, row.expiryEpoch, now);
    return {
      id: row.id,
      path: entry === undefined ? null : fullPathOf(index, entry),
      size: entry?.size ?? null,
      expiryEpoch: row.expiryEpoch,
      stage,
      daysLeft: left === null ? null : left.days,
      daysLeftExact: left?.exact ?? true,
    };
  });

  // ⛔ SORTED BY DEADLINE, WITH THE UNKNOWNS AT THE BOTTOM. The server orders by the recorded epoch
  //    and an unrecorded one is 0, so taking that order would head a list called "running out" with
  //    the files nobody knows anything about.
  const dated = rows.filter((r) => r.stage !== "unrecorded").sort((a, b) => a.expiryEpoch - b.expiryEpoch);
  const unrecorded = rows.filter((r) => r.stage === "unrecorded");

  if (options.json) {
    say(
      JSON.stringify({
        network: session.network,
        epoch: clock.current,
        epochDurationMs: clock.durationMs,
        /** ⚠ Absent from the network's own answer most of the time — see `expiry.ts`. */
        epochStartedMs: clock.startedMs,
        beforeEpoch: cutoff,
        truncated: answer.truncated,
        files: [...dated, ...unrecorded],
      }),
    );
    return 0;
  }

  const epochDays = clock.durationMs / 86_400_000;
  say(
    `The ${session.network} storage network is at epoch ${clock.current}, and one epoch is ` +
      `${epochDays === Math.round(epochDays) ? epochDays : epochDays.toFixed(1)} days.`,
  );
  if (dated.length === 0 && unrecorded.length === 0) {
    say(`Nothing in this account runs out before epoch ${cutoff}.`);
    return 0;
  }

  const width = Math.max(...[...dated, ...unrecorded].map((r) => nameOf(r).length));
  if (dated.length > 0) {
    say(``);
    for (const row of dated) {
      const left = row.daysLeft === null ? "" : daysLeftInWords({ days: row.daysLeft, exact: row.daysLeftExact });
      const size = row.size === null ? "" : humanSize(row.size);
      say(
        `${nameOf(row).padEnd(width)}  ${size.padStart(9)}  ends at epoch ${row.expiryEpoch}, ${left}` +
          MARK[row.stage],
      );
    }
    say(``);
    say(`${dated.length} file${dated.length === 1 ? "" : "s"} run out before epoch ${cutoff}.`);
  }

  if (unrecorded.length > 0) {
    say(``);
    for (const row of unrecorded) {
      say(`${nameOf(row).padEnd(width)}  ${(row.size === null ? "" : humanSize(row.size)).padStart(9)}`);
    }
    say(``);
    say(
      `${unrecorded.length} file${unrecorded.length === 1 ? " has" : "s have"} no storage period ` +
        `recorded. That is not a short one: whatever uploaded them could not read the network's ` +
        `epoch clock, so nothing was written down. The chain still knows; a browser can show it.`,
    );
  }

  if (rows.some((r) => r.path === null)) {
    say(``);
    say(`  Rows marked "(not in the file list)" are files the server is holding that this account's`);
    say(`  list does not name. An upload can commit and then fail before the list was written.`);
    say(`  Nothing here can repair that; opening the account in a browser can.`);
  }
  if (answer.truncated) {
    say(``);
    say(`  The server stopped at its limit, so there are more than these. Extending some of them`);
    say(`  and running this again shows the next ones.`);
  }
  say(``);
  say(
    `Extending storage is paid for from your own wallet and signed on your own device, at ` +
      `${HOME_URL}. No command in this tool signs anything.`,
  );
  return 0;
}

/** What a row is called, with the reason spelled out when it has no name. */
function nameOf(row: Row): string {
  return row.path ?? `(not in the file list) ${row.id}`;
}

/** The two stages that need a word beside them. `soon` is the warning itself and needs none. */
const MARK: Record<ExpiryStage, string> = {
  lapsed: "  — TERM ENDED",
  urgent: "  — EXTEND NOW",
  soon: "",
  later: "",
  unrecorded: "",
};

interface ExpiringRow {
  id: string;
  expiryEpoch: number;
}

/**
 * What `GET /v1/items/expiring` answers, narrowed rather than trusted.
 *
 * ⛔ A ROW THIS CANNOT READ IS A REFUSAL, NOT A ROW TO SKIP. Skipping would turn a wire change into
 *    a shorter warning list, which is the one way this command can fail without anybody noticing.
 */
function asExpiringAnswer(value: unknown): { rows: ExpiringRow[]; truncated: boolean } {
  const unreadable = (): never => {
    throw new NmtsError("The server answered with an expiry list this version cannot read.", {
      nextStep: "Update this tool. Nothing was changed, and the account is not in any different state.",
    });
  };
  if (typeof value !== "object" || value === null) return unreadable();
  const raw: unknown = Reflect.get(value, "items");
  if (!Array.isArray(raw)) return unreadable();
  const items: readonly unknown[] = raw;
  const rows: ExpiringRow[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) return unreadable();
    const id: unknown = Reflect.get(item, "item_id");
    const epoch: unknown = Reflect.get(item, "expiry_epoch");
    if (typeof id !== "string" || typeof epoch !== "number") return unreadable();
    rows.push({ id, expiryEpoch: epoch });
  }
  return { rows, truncated: Reflect.get(value, "truncated") === true };
}
