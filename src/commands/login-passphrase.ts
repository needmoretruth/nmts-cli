// The passphrase a NEW seal is made under: where it comes from, and the two rules about it.
//
// ⛔ MOVED OUT OF `login.ts` RATHER THAN REWRITTEN (2026-09-20). Every line below was in that file
//    and is unchanged; it moved because that file reached the length gate when wallet sign-in
//    arrived, and this is where the seam already was: `login.ts` decides which of the three shapes
//    the NMTS key is stored in and what a person is told, and this answers one question inside one
//    of them. Nothing here reads the code, writes a file or talks to a server.

import { samePassphrase } from "../code-vault.ts";
import { PASSPHRASE_ENV_VAR } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { BINARY_NAME } from "../product.ts";
import { promptSecret, stdinIsATerminal } from "../prompt.ts";

/**
 * ⚠ EIGHT, AND NO COMPOSITION RULES. scrypt makes a short passphrase expensive to attack, not
 *   safe: four characters is guessed whatever the cost factor. Requiring a digit and a capital
 *   would not change that and would push people to reuse the one they always type.
 */
const MIN_PASSPHRASE = 8;

/** What this needs of `login`'s options: the injected prompt, when a test supplies one. */
export interface PassphraseSource {
  /** Injected in tests. Called twice for a new passphrase — the second is the confirmation. */
  readPassphrase?: ((prompt: string) => Promise<string>) | undefined;
}

/**
 * A passphrase for a NEW seal: from the environment, or typed twice.
 *
 * ⚠ The environment form is not confirmed, because there is nothing to confirm it against and
 *   asking would hang. A typo there produces a file whose passphrase nobody knows — which is why
 *   the message below says to keep it, not merely to choose it.
 */
export async function newPassphrase(options: PassphraseSource): Promise<string> {
  const ask = options.readPassphrase;
  const fromEnv = process.env[PASSPHRASE_ENV_VAR];
  if (ask === undefined && fromEnv !== undefined && fromEnv.length > 0) {
    if (fromEnv.length < MIN_PASSPHRASE) throw tooShort();
    return fromEnv;
  }
  if (ask === undefined && !stdinIsATerminal()) {
    throw new NmtsError("Sealing the NMTS key needs a passphrase, and there is no terminal.", {
      exitCode: 2,
      nextStep: [
        `One of these:`,
        `  · set ${PASSPHRASE_ENV_VAR} and run this again`,
        `  · ${BINARY_NAME} login --plain   store it unsealed (asks for an agreement first)`,
        `  · ${BINARY_NAME} login --env     store nothing; print the variable to set`,
      ].join("\n"),
    });
  }
  const prompt = ask ?? ((q: string) => promptSecret(q, PASSPHRASE_ENV_VAR));
  const first = await prompt(`New passphrase for the stored NMTS key (not shown as you type): `);
  if (first.length < MIN_PASSPHRASE) throw tooShort();
  const again = await prompt(`Type it again: `);
  if (!samePassphrase(first, again)) {
    throw new NmtsError("Those two passphrases are not the same.", {
      exitCode: 2,
      nextStep: `Nothing was written. Run \`${BINARY_NAME} login\` again.`,
    });
  }
  return first;
}

function tooShort(): NmtsError {
  return new NmtsError(`That passphrase is shorter than ${MIN_PASSPHRASE} characters.`, {
    exitCode: 2,
    nextStep:
      `Nothing was written. A short passphrase is guessed whatever the tool does to slow guessing ` +
      `down. ⛔ If it is lost, the sealed copy cannot be opened by anybody — keep it somewhere.`,
  });
}
