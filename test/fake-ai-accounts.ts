// The three SESSIONLESS AI-account doors, answered for a test.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-erase.ts` HAS ONE: `check:size` measures `fake-account.ts`.
//
// ⛔ EVERY DOOR HERE REFUSES A BEARER, exactly as the real ones do — they are reached by proving the
//    account code and nothing else, and an API key is `Reach::Never` at all three. A fake that
//    answered a request carrying a key could not fail for a tool that sent one.
//
// ⛔ AND EVERY DOOR CHECKS THE PROOF IS THERE. What these routes exist for is that the NMTS key —
//    never a key — is what makes, lists and erases an AI account; a fake that answered without it
//    would let a tool that forgot it pass.

import type { IncomingMessage, ServerResponse } from "node:http";

/** One AI account as the server lists it. */
export interface FakeChild {
  account_id: string;
  child_index: number;
  public_code: string | null;
  created_at: string;
  status: string;
}

export interface AiAccountsState {
  /** What the listing answers with. */
  children: FakeChild[];
  /** Every body posted to one of the three doors, in order, with the door it went to. */
  requests: { door: string; body: unknown; bearer: string | null }[];
  /** Refuse the next creation with this code instead of making anything. */
  refuseCreateWith: string | null;
}

export const aiAccountsState: AiAccountsState = { children: [], requests: [], refuseCreateWith: null };

export function resetAiAccounts(): void {
  aiAccountsState.children = [];
  aiAccountsState.requests = [];
  aiAccountsState.refuseCreateWith = null;
}

const DOORS = ["by-code", "list-by-code", "erase-by-code"] as const;

/** Answer the request if it is one of the three doors; say whether it was. */
export function serveAiAccounts(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const door = DOORS.find((name) => url === `/v1/account/ai-accounts/${name}`);
  if (method !== "POST" || door === undefined) return false;
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const header = req.headers["authorization"];
  const bearer = typeof header === "string" ? header.replace(/^Bearer /, "") : null;
  let raw = "";
  req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
  req.on("end", () => {
    const body: unknown = raw === "" ? null : JSON.parse(raw);
    aiAccountsState.requests.push({ door, body, bearer });
    const at = (name: string): unknown =>
      typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
    if (typeof at("account_id") !== "string" || typeof at("auth_secret") !== "string") {
      return json(401, { error: { code: "INVALID_CREDENTIALS", message: "the account code was not proved" } });
    }
    if (door === "list-by-code") return json(200, { children: aiAccountsState.children });
    if (door === "by-code") {
      const refusal = aiAccountsState.refuseCreateWith;
      if (refusal !== null) {
        return json(422, { error: { code: refusal, message: "this tree has not been opened yet" } });
      }
      const index = at("child_index");
      const id = at("child_account_id");
      if (typeof index !== "number" || typeof id !== "string") {
        return json(400, { error: { code: "VALIDATION", message: "child_index and child_account_id are required" } });
      }
      const child: FakeChild = {
        account_id: id,
        child_index: index,
        public_code: null,
        created_at: "2026-09-20T00:00:00Z",
        status: "active",
      };
      aiAccountsState.children.push(child);
      return json(201, child);
    }
    const child = at("child_id");
    const before = aiAccountsState.children.length;
    aiAccountsState.children = aiAccountsState.children.filter((row) => row.account_id !== child);
    if (aiAccountsState.children.length === before) {
      return json(404, { error: { code: "NOT_FOUND", message: "no such AI account" } });
    }
    res.writeHead(204);
    res.end();
  });
  return true;
}
