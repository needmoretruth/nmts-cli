// `nmts logout` — remove the stored account code from this machine.
//
// ⚠ WHAT IT DOES NOT DO. It removes a file. It does not end any session on the server, and it
//    cannot reach a copy of the code that has already been read by something else on this machine.
//    Saying "logged out" without saying that would suggest a revocation that did not happen.

import { rmSync } from "node:fs";
import { credentialsPath } from "../credentials.ts";

export function logout(write?: (line: string) => void): number {
  const say = write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const path = credentialsPath();
  let removed = true;
  try {
    rmSync(path);
  } catch (error) {
    if (isNotFound(error)) removed = false;
    else throw error;
  }
  say(removed ? `Removed ${path}` : `Nothing to remove — ${path} does not exist.`);
  if (removed) {
    say(`  This deleted a file. It did not end anything on the server, and it cannot reach a copy`);
    say(`  that something on this machine already read.`);
  }
  return 0;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
