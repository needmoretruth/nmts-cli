// The `wallet` agreement with a SCOPE, an EXPIRY and, if the person wants one, a SPENDING CEILING.
//
// ⛔ WHY THE PLAIN "ONCE PER MACHINE, FOREVER" GRANT WAS NOT ENOUGH HERE. Every other agreement in
//    this tool is about a capability whose cost is bounded by something else — credits by the
//    server's ceilings, a share by the file it names. A wallet has no such bound: whatever is in it
//    can leave in one signature, and an agent in `mode auto` that could grant an open-ended wallet
//    agreement could give ITSELF unlimited, indefinite spending. So this one grant carries three
//    things the others do not, in the same file, under the same key:
//      · a scope — `storage` (extending a file's lease, paying for a file's storage) or `all`
//        (also exchanging and sending). A gift is in neither: a person approves every gift.
//      · an expiry — never more than 30 days away. The browser's standing approval has the same
//        ceiling, for the same reason: a grant nobody remembers giving should run out on its own.
//      · optionally a ceiling per coin. What this tool signs under the grant is added up here,
//        and a signature that would pass the ceiling is refused BEFORE it is made.
//
// ⛔ AN OLDER RECORD WITHOUT AN EXPIRY COUNTS AS NO GRANT. Versions before this one wrote the wallet
//    agreement as a bare date. Reading that as "agreed to everything, forever" would be the exact
//    grant this file exists to make impossible, so it is asked for again — with the new words.
//
// ⚠ THE LEDGER IS THIS MACHINE'S. It counts what THIS tool signed under THIS grant. The wallet can
//   be spent from elsewhere with the same account code, and nothing here can see that.

import { NmtsError } from "./errors.ts";
import { readConsentRecords, writeConsentRecords } from "./consent.ts";
import { BINARY_NAME, SUPPORT_EMAIL } from "./product.ts";
import { coinAmount } from "./wallet.ts";

export const WALLET_SCOPES = ["storage", "all"] as const;
export type WalletScope = (typeof WALLET_SCOPES)[number];
/** What a signature is for. `donate` is deliberately not here: no grant reaches a gift. */
export type WalletAction = "extend" | "seal" | "reshape" | "exchange" | "send" | "give";
const SCOPE_ACTIONS: Readonly<Record<WalletScope, readonly WalletAction[]>> = {
  storage: ["extend", "seal", "reshape"],
  all: ["extend", "seal", "reshape", "exchange", "send", "give"],
};
/** The ceiling on any grant's length. The browser's standing approval has the same one. */
export const MAX_GRANT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WalletGrant {
  scope: WalletScope;
  grantedAt: string;
  expiresAt: string;
  byVersion: string;
  /** Ceilings in base units, as strings (a JSON number would round them). `null` = no ceiling. */
  capWalFrost: string | null;
  capSuiMist: string | null;
  /** What this tool has signed away under this grant, in base units. */
  spentWalFrost: string;
  spentSuiMist: string;
}

export interface Spend {
  walFrost: bigint;
  suiMist: bigint;
}

/** A decimal coin amount ("1.25") as base units. Nine decimals, like the chain. */
export function parseCoinAmount(text: string, what: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text.trim());
  if (m === null || m[1] === undefined) {
    throw new NmtsError(`${what} must be a number of coins, like 12 or 0.5.`, { exitCode: 2 });
  }
  return BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0"));
}

export function scopeCovers(scope: WalletScope, action: WalletAction): boolean {
  return SCOPE_ACTIONS[scope].includes(action);
}

/** Turn what was typed into a grant, or refuse with the line to correct. Nothing is written. */
export function parseWalletGrant(
  input: { days?: string | undefined; until?: string | undefined; scope?: string | undefined; capWal?: string | undefined; capSui?: string | undefined },
  now: Date,
  version: string,
): WalletGrant {
  const scope = input.scope ?? "storage";
  if (!(WALLET_SCOPES as readonly string[]).includes(scope)) {
    throw new NmtsError(`--scope must be one of: ${WALLET_SCOPES.join(" · ")}.`, {
      exitCode: 2,
      nextStep: "storage = extending a file's lease and paying for a file's storage. all = also exchanging and sending. A gift is in neither.",
    });
  }
  let expiresMs: number;
  if (input.until !== undefined) {
    const at = Date.parse(input.until);
    if (!Number.isFinite(at)) {
      throw new NmtsError("--until must be a date, like 2026-09-30 or 2026-09-30T12:00Z.", { exitCode: 2 });
    }
    expiresMs = at;
  } else if (input.days !== undefined) {
    const days = Number(input.days);
    if (!Number.isInteger(days) || days < 1) {
      throw new NmtsError("--days must be a whole number of days, at least 1.", { exitCode: 2 });
    }
    expiresMs = now.getTime() + days * DAY_MS;
  } else {
    throw new NmtsError("A wallet agreement needs an expiry: say how long it lasts.", {
      exitCode: 2,
      nextStep:
        `\`${BINARY_NAME} unlock wallet --days 7\` (up to ${MAX_GRANT_DAYS}), or --until <date>. ` +
        `Add --scope storage|all (default storage) and, if you want a ceiling, --cap-wal <coins> --cap-sui <coins>.`,
    });
  }
  const ceiling = now.getTime() + MAX_GRANT_DAYS * DAY_MS;
  if (expiresMs <= now.getTime()) {
    throw new NmtsError("That expiry is already in the past.", { exitCode: 2 });
  }
  if (expiresMs > ceiling) {
    throw new NmtsError(`A wallet agreement lasts at most ${MAX_GRANT_DAYS} days.`, {
      exitCode: 2,
      nextStep: `Grant it again when it runs out. That is the point: a grant nobody remembers giving should run out on its own.`,
    });
  }
  return {
    scope: scope as WalletScope,
    grantedAt: now.toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    byVersion: version,
    capWalFrost: input.capWal === undefined ? null : parseCoinAmount(input.capWal, "--cap-wal").toString(),
    capSuiMist: input.capSui === undefined ? null : parseCoinAmount(input.capSui, "--cap-sui").toString(),
    spentWalFrost: "0",
    spentSuiMist: "0",
  };
}

function isScope(value: unknown): value is WalletScope {
  return typeof value === "string" && (WALLET_SCOPES as readonly string[]).includes(value);
}

/** The grant on this machine, or null — an older bare-date record, or a malformed one, is null. */
export function readWalletGrant(): WalletGrant | null {
  const raw: unknown = readConsentRecords()["wallet"];
  if (typeof raw !== "object" || raw === null) return null;
  const at = (name: string): unknown => Reflect.get(raw, name);
  const scope = at("scope");
  const grantedAt = at("grantedAt");
  const expiresAt = at("expiresAt");
  const byVersion = at("byVersion");
  if (!isScope(scope) || typeof grantedAt !== "string" || typeof expiresAt !== "string" || typeof byVersion !== "string") {
    return null;
  }
  const units = (name: string): string | null => {
    const v = at(name);
    return typeof v === "string" && /^\d+$/.test(v) ? v : null;
  };
  return {
    scope,
    grantedAt,
    expiresAt,
    byVersion,
    capWalFrost: units("capWalFrost"),
    capSuiMist: units("capSuiMist"),
    spentWalFrost: units("spentWalFrost") ?? "0",
    spentSuiMist: units("spentSuiMist") ?? "0",
  };
}

export function writeWalletGrant(grant: WalletGrant): void {
  const all = readConsentRecords();
  all["wallet"] = grant;
  writeConsentRecords(all);
}

export type GrantState = "none" | "expired" | "active";

export function walletGrantState(grant: WalletGrant | null, now: Date): GrantState {
  if (grant === null) return "none";
  return Date.parse(grant.expiresAt) > now.getTime() ? "active" : "expired";
}

/** What is left under a ceiling, or null when there is none. */
export function roomLeft(cap: string | null, spent: string): bigint | null {
  return cap === null ? null : BigInt(cap) - BigInt(spent);
}

const GRANT_COMMAND = `${BINARY_NAME} unlock wallet --days 7`;

/**
 * Stop unless an active grant covers this signature and its amount, and say what would.
 *
 * ⛔ THE MESSAGE IS THE PRODUCT HERE, as with every other agreement: what happens, what can go
 *    wrong, what is not covered, and the one command that agrees — and, new for this key, the
 *    three things the grant carries.
 */
export function requireWalletGrant(action: WalletAction, spend: Spend, now: Date): WalletGrant {
  const grant = readWalletGrant();
  const state = walletGrantState(grant, now);
  const tail = [
    "",
    `NMTS is not responsible for what is done with this account by any program running on this`,
    `machine, including an AI agent. The published Terms are what govern the service; this is a`,
    `warning, not a substitute for them.`,
    "",
    `⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`,
    `   Do not run the unlock command yourself.`,
    "",
    `Something wrong or confusing here? ${SUPPORT_EMAIL}`,
  ];
  const refuse = (what: string, why: string[]): NmtsError =>
    new NmtsError(what, { exitCode: 5, nextStep: [...why, ...tail].join("\n") });
  if (state === "none" || grant === null) {
    throw refuse("Use the wallet this account code derives, and sign transactions with it.", [
      "A signed transaction moves real assets and cannot be reversed by anybody, including NMTS. " +
        "A mistake here is permanent.",
      "",
      "This agreement carries three things: a scope (storage = extending and paying for storage; " +
        "all = also exchanging and sending — a gift is in neither), an expiry of at most " +
        `${MAX_GRANT_DAYS} days, and, if you want one, a ceiling on what this tool may sign away.`,
      "Only what this tool signs is counted. Handing the account code to another program gives " +
        "that program the same wallet, and nothing here can see that happen.",
      "",
      `To unlock, at a terminal, for a week:  ${GRANT_COMMAND}`,
      `  add --scope all to cover exchanging and sending; --cap-wal <coins> --cap-sui <coins> for a ceiling`,
      `To see what is unlocked:                 ${BINARY_NAME} unlock`,
    ]);
  }
  if (state === "expired") {
    throw refuse(`The wallet agreement on this machine ran out on ${grant.expiresAt}.`, [
      `It was given on ${grant.grantedAt} for scope "${grant.scope}". Nothing was signed.`,
      `To agree again:  ${GRANT_COMMAND}`,
    ]);
  }
  if (!scopeCovers(grant.scope, action)) {
    throw refuse(`The wallet agreement on this machine covers storage only, and this would ${action}.`, [
      `Nothing was signed. To widen it:  ${BINARY_NAME} unlock wallet --days 7 --scope all`,
    ]);
  }
  const walRoom = roomLeft(grant.capWalFrost, grant.spentWalFrost);
  const suiRoom = roomLeft(grant.capSuiMist, grant.spentSuiMist);
  if (walRoom !== null && spend.walFrost > walRoom) {
    throw refuse(`This would sign away ${coinAmount(spend.walFrost)} WAL and the agreement has ${coinAmount(walRoom < 0n ? 0n : walRoom)} WAL left under its ceiling.`, [
      `Ceiling ${coinAmount(BigInt(grant.capWalFrost ?? "0"))} WAL, of which ${coinAmount(BigInt(grant.spentWalFrost))} WAL is already signed away since ${grant.grantedAt}. Nothing was signed.`,
      `To raise it, agree again with a higher --cap-wal, or without one.`,
    ]);
  }
  if (suiRoom !== null && spend.suiMist > suiRoom) {
    throw refuse(`This would spend about ${coinAmount(spend.suiMist)} SUI in fees and the agreement has ${coinAmount(suiRoom < 0n ? 0n : suiRoom)} SUI left under its ceiling.`, [
      `Ceiling ${coinAmount(BigInt(grant.capSuiMist ?? "0"))} SUI, of which ${coinAmount(BigInt(grant.spentSuiMist))} SUI is already counted since ${grant.grantedAt}. Nothing was signed.`,
      `To raise it, agree again with a higher --cap-sui, or without one.`,
    ]);
  }
  return grant;
}

/** Add what was just signed to the grant's ledger. Called after a signature, never before. */
export function recordWalletSpend(spend: Spend): void {
  const grant = readWalletGrant();
  if (grant === null) return;
  writeWalletGrant({
    ...grant,
    spentWalFrost: (BigInt(grant.spentWalFrost) + spend.walFrost).toString(),
    spentSuiMist: (BigInt(grant.spentSuiMist) + spend.suiMist).toString(),
  });
}
