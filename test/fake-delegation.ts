// The delegation table, enforced by the fake server the way the real one enforces it.
//
// ⛔ WHY (spec 2026-09-20 unit C). The fake answered a delegation token at every door, so a verb
//    whose door is `Never` for a token passed its delegation-root test and then failed for every
//    business against the real server. Making a public link was such a verb. Now a token meets the
//    server's own verdicts here: `never` refuses, `needs` asks for the bit, `proof` asks for the bit
//    and the code's proof header.
//
// ⛔ THE TABLE IS A COPY, AND THE SERVER KEEPS IT TRUE. `delegation-table.json` is written from
//    `DELEGATION_ROUTES` and a server test fails when the two differ (`delegation_table_copy.rs`).
//    It is a copy because these tests are published where the server source is not.
//
// ⚠ THE TOKEN'S SIGNATURE IS NOT CHECKED, only its scope read: whether a signature holds is the
//   server's judgement, tested where the verifier is. A path the table does not name is not ours
//   (the storage network's doors share this fake) and passes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

interface Row {
  method: string;
  path: string;
  reach: "needs" | "proof" | "human" | "any" | "never";
  bit: number;
}

const REACHES: readonly string[] = ["needs", "proof", "human", "any", "never"];

function isRow(value: unknown): value is Row {
  if (typeof value !== "object" || value === null) return false;
  const reach: unknown = Reflect.get(value, "reach");
  return (
    typeof Reflect.get(value, "method") === "string" &&
    typeof Reflect.get(value, "path") === "string" &&
    typeof reach === "string" &&
    REACHES.includes(reach) &&
    typeof Reflect.get(value, "bit") === "number"
  );
}

const parsedTable: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "delegation-table.json"), "utf8"));
const rows: unknown[] = Array.isArray(parsedTable) ? parsedTable : [];
// ⛔ A COPY THAT DID NOT READ IS A GUARD THAT GUARDS NOTHING, so it stops the suite instead.
if (rows.length < 150 || !rows.every(isRow)) throw new Error("delegation-table.json did not read as the delegation table");
const TABLE = rows.filter(isRow).map((row) => ({
  ...row,
  pattern: new RegExp(`^${row.path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
}));

const holes = (path: string): number => (path.match(/\{/g) ?? []).length;

/** Every refusal the guard gave, so a test can say which door stopped it. */
export const delegationRefusals: string[] = [];

function scopeOf(token: string): number | null {
  const payload = token.slice("nmts_dt1_".length).split(".")[0] ?? "";
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const s = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "s") : null;
    return typeof s === "number" ? s : null;
  } catch {
    return null;
  }
}

/** Refuse the request as the server would, and say whether it was refused. */
export function refuseByDelegationTable(method: string, url: string, req: IncomingMessage, res: ServerResponse): boolean {
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer nmts_dt1_")) return false;
  const path = url.split("?")[0] ?? "";
  // ⚠ A written segment wins over a placeholder, as in the server's router: `/v1/share-links/live`
  //   is not the link `{link_id}` = "live", and the table lists the placeholder row first.
  const row = TABLE.filter((r) => r.method === method && r.pattern.test(path)).sort((a, b) => holes(a.path) - holes(b.path))[0];
  if (row === undefined) return false;
  const scope = scopeOf(auth.slice("Bearer ".length));
  const refuse = (status: number, code: string): true => {
    delegationRefusals.push(`${method} ${row.path} ${code}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code, message: `${method} ${row.path}: ${code.toLowerCase()}` } }));
    return true;
  };
  if (scope === null) return refuse(401, "DELEGATION_INVALID");
  if (row.reach !== "needs" && row.reach !== "proof") return refuse(403, "DELEGATION_SCOPE");
  if ((scope & row.bit) === 0) return refuse(403, "DELEGATION_SCOPE");
  if (row.reach === "proof" && typeof req.headers["x-nmts-account-proof"] !== "string") {
    return refuse(403, "ACCOUNT_PROOF_REQUIRED");
  }
  return false;
}
