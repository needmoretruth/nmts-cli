// `nmts devices` — what is signed in to this account.
//
// ⛔ WHY IT EXISTS. An account run from a terminal could see everything about itself except who
//    was holding a session to it. The browser has had that list since sessions had names; the one
//    account nobody is watching a screen for had nothing. The server opened the READ to a key
//    holding the files:read permission and left the two sign-outs shut, so this command lists and
//    cannot end anything.
//
// ⛔ SIGNING A DEVICE OUT IS A PERSON'S ACT, AND `--sign-out` KEEPS IT ONE (2026-09-06 · CLI parity
//    ③-2). A key alone must never end sessions: a stolen key that could end the browser's session
//    could lock the person out of the one screen that revokes it, and the server still refuses a
//    bare key. What opens the door is the NMTS key's proof beside the key — whoever holds the
//    code can sign in and do the same from a browser — so this option needs the code on this
//    machine, is refused in mode auto before the code is opened, and asks once before it acts.
//
// ⚠ THE DEVICE NAME IS SEALED AND STAYS SEALED HERE. It is encrypted under a key derived from the
//   NMTS key, which the server has never had — so what a listing can honestly show is when a
//   session started, when it was last used, and when it runs out. This command does not open the
//   name: opening it needs the NMTS key, and this command runs on a key alone so that it
//   works on a machine where the code is not present at all.
//
// ⚠ AND THE NETWORK IS NOT RESOLVED HERE. Nothing in this answer is stored on the storage
//   network, so demanding to be told which one a development server uses would refuse a run over
//   a fact it never consults — the same reading `listfile` and `env` already take.

import { accountProofFor } from "../account-proof.ts";
import { request } from "../api.ts";
import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { BINARY_NAME, HOME_URL } from "../product.ts";
import { promptLine, stdinIsATerminal } from "../prompt.ts";
import { resolveServer } from "../server.ts";
import { requireApiKey } from "../session.ts";

export interface DevicesOptions {
  server?: string | undefined;
  json?: boolean;
  /** Sign ONE device out by id, or `all` of them. A high act: the tier gate asks first. */
  signOut?: string | undefined;
  /** The answer the tier gate already took, or the person's own `--yes`. */
  yes?: boolean;
  write?: (line: string) => void;
  /** Injected in tests: answers the one confirmation. */
  readLine?: ((question: string) => Promise<string>) | undefined;
}

/** One signed-in session, as this command reports it. */
interface Device {
  id: string;
  /** Whether the device was given a name — never the name, which is sealed. */
  named: boolean;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  current: boolean;
}

function asDevices(value: unknown): Device[] {
  if (!isRecord(value)) throw new NmtsError("The server's answer was not an object.");
  const rows = value["sessions"];
  if (!Array.isArray(rows)) {
    throw new NmtsError(
      "The server listed the signed-in devices in a shape this version cannot read.",
      { nextStep: `Update this tool — \`npm install -g ${BINARY_NAME}\` — or read it in a browser.` },
    );
  }
  const out: Device[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = row["id"];
    const created = row["created_at"];
    const used = row["last_used_at"];
    const expires = row["expires_at"];
    // ⛔ A ROW THIS CANNOT READ IS SKIPPED, NOT INVENTED. A device shown with made-up times is
    //    worse than one row fewer: somebody looking for a session they did not start would be
    //    reading a fiction.
    if (typeof id !== "string" || typeof created !== "string") continue;
    out.push({
      id,
      // ⚠ WHETHER IT HAS A NAME, NOT THE NAME. The value is ciphertext this command cannot open,
      //   and printing base64 would be printing noise while implying it means something.
      named: typeof row["label_ct"] === "string" && row["label_ct"] !== "",
      created_at: created,
      last_used_at: typeof used === "string" ? used : created,
      expires_at: typeof expires === "string" ? expires : created,
      current: row["current"] === true,
    });
  }
  return out;
}

export async function devices(options: DevicesOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  // ⛔ THE KEY AND NOT THE NMTS KEY. This read needs no code, so asking for one would refuse a
  //    run over a credential it never uses — and on a machine holding only a key it would make
  //    the one command about that machine's own access the one command it cannot run.
  const apiKey = requireApiKey();
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  if (options.signOut !== undefined) return await signOut(server, apiKey, options, say);

  const rows = asDevices(await request(server, "/v1/account/sessions", { token: apiKey }));

  if (options.json === true) {
    say(JSON.stringify({ devices: rows }));
    return 0;
  }
  if (rows.length === 0) {
    say(`Nothing is signed in to this account.`);
    say(``);
    say(`  An API key is not a session, so the credential this command used is not listed here.`);
    say(`  Signing in at ${HOME_URL} is what puts a row in this list.`);
    return 0;
  }
  for (const row of rows) {
    say(`${row.named ? "named device (the name is sealed)" : "unnamed device"}${row.current ? "  ← this one" : ""}`);
    say(`  last used   ${row.last_used_at}`);
    say(`  signed in   ${row.created_at}`);
    say(`  runs out    ${row.expires_at}`);
  }
  say(``);
  say(`  ${rows.length} signed in. The name each device was given is encrypted with your NMTS`);
  say(`  key, which the server has never had, so it is not shown here.`);
  say(``);
  // ⛔ IT SAYS WHAT THIS CANNOT DO, rather than leaving a reader to find out by trying. A refusal
  //    discovered by running something is a refusal an agent retries.
  say(`  \`${BINARY_NAME} devices --sign-out <id>\` (or \`all\`) ends one — a person's act that needs the`);
  say(`  NMTS key on this machine; a key alone cannot, so a stolen key cannot end the browser's.`);
  return 0;
}

/** `--sign-out <id|all>`: the refusals first, then one question, then the proof and the request. */
async function signOut(
  server: string,
  apiKey: string,
  options: DevicesOptions,
  say: (line: string) => void,
): Promise<number> {
  const target = (options.signOut ?? "").trim();
  if (target === "") throw new NmtsError(`--sign-out needs a device id, or \`all\`.`, { exitCode: 2 });
  // The tier gate has already refused or asked by mode; `--yes` is the answer it took. Without
  // it, the question is put here, to a person at a terminal.
  const ask = options.readLine ?? promptLine;
  if (options.yes !== true && options.readLine === undefined && !stdinIsATerminal()) {
    throw new NmtsError("There is no terminal to answer in (stdin is not a TTY).", {
      exitCode: 3,
      nextStep: `Run this where a person can answer the question it asks, or with --yes after they have.`,
    });
  }
  const held = await requireAccountCode();
  const what = target === "all" ? "every device signed in to this account" : `device ${target}`;
  if (options.yes !== true) {
    const answer = (await ask(`Sign ${what} out? Whoever is there is signed out at once. [y/N] `)).trim();
    if (answer !== "y" && answer !== "Y") {
      say(`Nothing was signed out.`);
      return 1;
    }
  }
  // ⛔ THE PROOF IS BUILT FOR THIS ONE REQUEST AND NOTHING KEEPS IT.
  const accountProof = await accountProofFor({ code: held.code, source: held.source });
  if (target === "all") {
    const answered = await request(server, "/v1/account/sessions", { method: "DELETE", token: apiKey, accountProof });
    const revoked = isRecord(answered) && typeof answered["revoked"] === "number" ? answered["revoked"] : null;
    say(revoked === null ? `Signed out everywhere.` : `Signed out ${revoked} device${revoked === 1 ? "" : "s"}.`);
    return 0;
  }
  await request(server, `/v1/account/sessions/${encodeURIComponent(target)}`, {
    method: "DELETE",
    token: apiKey,
    accountProof,
  });
  say(`Signed device ${target} out.`);
  return 0;
}
