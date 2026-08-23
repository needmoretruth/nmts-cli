// Reading a secret from a terminal without putting it on the screen.
//
// ⛔ WHY NOT `readline`. It echoes what is typed, and an account code on screen ends up in
//    scrollback, in a screen share, and in the terminal recording some agents keep. The usual
//    workaround — swapping `process.stdout.write` for a muted one while the question is open — is
//    a global mutation in a process that may be writing other output, and it stays broken if the
//    promise rejects between the swap and the restore. This reads the raw stream instead: nothing
//    global changes, and echo never happens because nothing echoes it.
//
// ⚠ THIS REQUIRES A REAL TERMINAL. When stdin is a pipe — which is how an agent usually runs this
//    tool — there is nothing to prompt, and waiting would hang on a stream that will never carry a
//    keystroke. The caller is told to use the environment variable, which is the right answer for
//    an agent anyway.
//
// The keystroke rules live in secret-reader.ts and are tested without a terminal.

import { NmtsError } from "./errors.ts";
import { SecretReader } from "./secret-reader.ts";

export function stdinIsATerminal(): boolean {
  return process.stdin.isTTY === true;
}

/** Ask for a secret on the terminal, echoing nothing. Ctrl-C and Ctrl-D abandon the prompt. */
export async function promptSecret(question: string, envVar: string): Promise<string> {
  if (!stdinIsATerminal()) {
    throw new NmtsError("There is no terminal to type into (stdin is not a TTY).", {
      exitCode: 3,
      nextStep: `Set ${envVar} in the environment instead.`,
    });
  }

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw === true;
  const reader = new SecretReader();
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer): void => {
        const step = reader.push(chunk);
        if (step.kind === "more") return;
        stdin.off("data", onData);
        process.stdout.write("\n");
        if (step.kind === "cancelled") {
          reader.wipe();
          reject(new NmtsError("Cancelled.", { exitCode: 130 }));
          return;
        }
        resolve(step.value);
      };
      stdin.on("data", onData);
    });
  } finally {
    reader.wipe();
    stdin.setRawMode(wasRaw);
    stdin.pause();
  }
}
