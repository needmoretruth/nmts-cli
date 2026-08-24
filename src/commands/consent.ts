// `nmts consent` — see what this machine has agreed to, and change it.
//
// ⛔ IT IS A COMMAND AND NOT A PROMPT. A yes/no question in the middle of another command cannot
//    be answered by anything that is not a terminal, which is most of the places this tool runs:
//    a container, a build step, an agent's subprocess. Making agreement its own command means the
//    same answer works everywhere, is recorded with a date, and can be looked at afterwards —
//    none of which is true of a keystroke.

import { CONSENTS, CONSENT_KEYS, grant, grantedAt, revoke, type ConsentKey } from "../consent.ts";
import { NmtsError } from "../errors.ts";
import { BINARY_NAME, SUPPORT_EMAIL, VERSION } from "../product.ts";

export interface ConsentOptions {
  json?: boolean;
  write?: (line: string) => void;
  /** The clock. Injected so a test asserts a real timestamp rather than tolerating any string. */
  now?: () => Date;
}

function isKey(value: string): value is ConsentKey {
  return (CONSENT_KEYS as string[]).includes(value);
}

function keyOrFail(raw: string | undefined): ConsentKey {
  if (raw === undefined || raw === "") {
    throw new NmtsError("Say which one.", {
      exitCode: 2,
      nextStep: `One of: ${CONSENT_KEYS.join(" · ")}`,
    });
  }
  if (!isKey(raw)) {
    throw new NmtsError(`There is nothing called "${raw}" to agree to.`, {
      exitCode: 2,
      nextStep: `One of: ${CONSENT_KEYS.join(" · ")}`,
    });
  }
  return raw;
}

export function consent(
  action: string | undefined,
  target: string | undefined,
  options: ConsentOptions = {},
): number {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  if (action === undefined || action === "" || action === "list") {
    if (options.json) {
      say(
        JSON.stringify(
          CONSENT_KEYS.map((key) => ({
            key,
            granted: grantedAt(key) !== null,
            grantedAt: grantedAt(key),
            what: CONSENTS[key].what,
            risk: CONSENTS[key].risk,
          })),
        ),
      );
      return 0;
    }
    for (const key of CONSENT_KEYS) {
      const at = grantedAt(key);
      say(`${at === null ? "  not agreed" : "  agreed    "}  ${key}`);
      say(`                ${CONSENTS[key].what}`);
      if (at !== null) say(`                agreed on this machine ${at}`);
      say(``);
    }
    say(`  ${BINARY_NAME} consent grant <name>    agree, on this machine, once`);
    say(`  ${BINARY_NAME} consent revoke <name>   take it back`);
    say(``);
    say(`  Agreeing here does not change what the published Terms say. NMTS is not responsible`);
    say(`  for what any program on this machine does with this account, an AI agent included.`);
    say(`  Something wrong or confusing? ${SUPPORT_EMAIL}`);
    return 0;
  }

  if (action === "grant") {
    const key = keyOrFail(target);
    grant(key, VERSION, now());
    say(`agreed: ${key}`);
    say(`  ${CONSENTS[key].what}`);
    say(`  ${CONSENTS[key].limit}`);
    return 0;
  }

  if (action === "revoke") {
    const key = keyOrFail(target);
    revoke(key);
    say(`taken back: ${key}`);
    return 0;
  }

  throw new NmtsError(`Unknown: ${BINARY_NAME} consent ${action}`, {
    exitCode: 2,
    nextStep: `Try \`${BINARY_NAME} consent\`, \`${BINARY_NAME} consent grant <name>\`, or \`${BINARY_NAME} consent revoke <name>\`.`,
  });
}
