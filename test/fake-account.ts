// The account's own two doors, answered for a test: minting a key from the NMTS key, and the
// signed-in device list.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-docs.ts` HAS ONE: `check:size` measures `fake-drive.ts` and
//    it is within a few lines of the ceiling. The seam is not arbitrary — everything here is about
//    the ACCOUNT's own credentials and sessions, and nothing here touches the drive's file list,
//    its item rows or its storage.
//
// ⚠ NOTHING HERE ANSWERS A ROUTE THE SERVER DOES NOT HAVE. Both addresses below are ones
//   `api/src/routes` registers; a fake that answered anything would prove only that the tool
//   agrees with the test.

import type { IncomingMessage, ServerResponse } from "node:http";

/** One signed-in session, in the server's own spelling. */
export interface FakeSession {
  id: string;
  label_ct: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  current: boolean;
}

/** What the next mint answers with, or the refusal it answers instead. */
export interface FakeIssue {
  key: string;
  key_id: string;
  scopes: number;
  expires_at: string;
}

/** One key as `POST /v1/account/api-keys/list-by-code` lists it. */
export interface FakeKey {
  key_id: string;
  scopes: number;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  uses: number;
}

export interface AccountState {
  /** What `GET /v1/account/sessions` answers. */
  sessions: FakeSession[];
  /** What the list door answers, and what the revoke door cuts from. */
  keys: FakeKey[];
  /** Every body the tool posted to the list door and to the revoke door, in order. */
  listRequests: unknown[];
  revokeRequests: unknown[];
  /** What the next mint hands back. */
  issue: FakeIssue;
  /** Refuse the next mint with this code instead of answering. */
  refuseIssueWith: string | null;
  /** Every body the tool posted to the mint door, in order. */
  issueRequests: unknown[];
  /** Every Authorization header value the tool sent, in order. */
  bearers: (string | null)[];
  /** What `GET /v1/account/summary` answers — only the `terms` part is read by the tests here. */
  summary: unknown;
  /** Every body the tool posted to the acceptance door, in order. */
  acceptRequests: unknown[];
  /** Refuse the next acceptance with this answer instead of a 204. */
  refuseAcceptWith: { status: number; code: string; message: string } | null;
  /** Every sign-out the tool asked for: the url and whether a proof header travelled with it. */
  signOuts: { url: string; proof: string | null }[];
  /** Every erasure the tool asked for: whether a proof header travelled with it. */
  erasures: { proof: string | null }[];
}

/** An account that owes acceptance of the pair that took effect on 2026-09-10. */
const DEFAULT_SUMMARY = {
  terms: {
    acceptance_required: true,
    required_terms_version: "2026-09-10-v11",
    required_privacy_version: "2026-09-10-v12",
  },
};

const DEFAULT_ISSUE: FakeIssue = {
  // A key shaped exactly like a real one — 9 + 12 + 1 + 43 — so nothing refuses it offline.
  key: `nmts_ak1_${"K".repeat(12)}_${"s".repeat(43)}`,
  key_id: "K".repeat(12),
  scopes: 1,
  expires_at: "2026-10-05T00:00:00Z",
};

export const accountState: AccountState = {
  sessions: [],
  keys: [],
  listRequests: [],
  revokeRequests: [],
  issue: { ...DEFAULT_ISSUE },
  refuseIssueWith: null,
  issueRequests: [],
  bearers: [],
  summary: DEFAULT_SUMMARY,
  acceptRequests: [],
  refuseAcceptWith: null,
  signOuts: [],
  erasures: [],
};

export function resetAccount(): void {
  accountState.sessions = [];
  accountState.issue = { ...DEFAULT_ISSUE };
  accountState.refuseIssueWith = null;
  accountState.issueRequests = [];
  accountState.keys = [];
  accountState.listRequests = [];
  accountState.revokeRequests = [];
  accountState.bearers = [];
  accountState.summary = DEFAULT_SUMMARY;
  accountState.acceptRequests = [];
  accountState.refuseAcceptWith = null;
  accountState.signOuts = [];
  accountState.erasures = [];
}

/**
 * Answer one of the account's two doors, or say this was not one of them.
 *
 * ⚠ IT IS HANDED THE WHOLE REQUEST, not just the method and the url, because the mint door is a
 *   POST with a body and what the tool put in that body is most of what these tests are about —
 *   and because the bearer it does or does not send is the other half.
 */
export function serveAccount(
  method: string,
  url: string,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const bearer = req.headers["authorization"];
  if (method === "GET" && url === "/v1/account/sessions") {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    json(200, { sessions: accountState.sessions });
    return true;
  }
  if (method === "DELETE" && url === "/v1/account") {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    const proofHeader = req.headers["x-nmts-account-proof"];
    const proof = typeof proofHeader === "string" ? proofHeader : null;
    accountState.erasures.push({ proof });
    if (proof === null) {
      json(403, { error: { code: "ACCOUNT_PROOF_REQUIRED", message: "the NMTS key's proof is needed" } });
      return true;
    }
    res.writeHead(204);
    res.end();
    return true;
  }
  if (method === "DELETE" && url.startsWith("/v1/account/sessions")) {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    const proofHeader = req.headers["x-nmts-account-proof"];
    const proof = typeof proofHeader === "string" ? proofHeader : null;
    accountState.signOuts.push({ url, proof });
    // The real server refuses a bare key before it looks at the id.
    if (proof === null) {
      json(403, { error: { code: "ACCOUNT_PROOF_REQUIRED", message: "the NMTS key's proof is needed" } });
      return true;
    }
    if (url === "/v1/account/sessions") {
      const revoked = accountState.sessions.length;
      accountState.sessions = [];
      json(200, { revoked });
      return true;
    }
    const id = url.slice("/v1/account/sessions/".length);
    const before = accountState.sessions.length;
    accountState.sessions = accountState.sessions.filter((s) => s.id !== id);
    if (accountState.sessions.length === before) {
      json(404, { error: { code: "NOT_FOUND", message: "no such session" } });
      return true;
    }
    res.writeHead(204);
    res.end();
    return true;
  }
  if (method === "GET" && url === "/v1/account/summary") {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    json(200, accountState.summary);
    return true;
  }
  if (method === "POST" && url === "/v1/account/accept-terms/by-code") {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      accountState.acceptRequests.push(raw === "" ? null : JSON.parse(raw));
      const refusal = accountState.refuseAcceptWith;
      if (refusal !== null) {
        return json(refusal.status, { error: { code: refusal.code, message: refusal.message } });
      }
      res.writeHead(204);
      res.end();
    });
    return true;
  }
  if (method === "POST" && url === "/v1/account/api-keys/list-by-code") {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      accountState.listRequests.push(raw === "" ? null : JSON.parse(raw));
      json(200, { keys: accountState.keys });
    });
    return true;
  }
  if (method === "POST" && url === "/v1/account/api-keys/revoke-by-code") {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const body: unknown = raw === "" ? null : JSON.parse(raw);
      accountState.revokeRequests.push(body);
      const wanted = body !== null && typeof body === "object" && "key_id" in body ? body["key_id"] : undefined;
      const live = accountState.keys.filter((k) => k.revoked_at === null);
      if (wanted === undefined || wanted === null) {
        for (const k of live) k.revoked_at = "2026-09-06T10:00:00Z";
        return json(200, { revoked: live.length });
      }
      const hit = live.find((k) => k.key_id === wanted);
      // The real server answers 404 for a stranger's handle, a missing one and a cut one alike.
      if (hit === undefined) return json(404, { error: { code: "NOT_FOUND", message: "no such key" } });
      hit.revoked_at = "2026-09-06T10:00:00Z";
      json(200, { revoked: 1 });
    });
    return true;
  }
  if (method === "POST" && url === "/v1/account/api-keys/by-code") {
    accountState.bearers.push(typeof bearer === "string" ? bearer : null);
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      accountState.issueRequests.push(raw === "" ? null : JSON.parse(raw));
      const refusal = accountState.refuseIssueWith;
      // Both refusals this door has are 409 on the real server.
      if (refusal !== null) return json(409, { error: { code: refusal, message: "not right now" } });
      json(201, accountState.issue);
    });
    return true;
  }
  return false;
}
