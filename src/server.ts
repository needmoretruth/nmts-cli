// Which NMTS server this run talks to.
//
// ⚠ THERE IS ONE REAL SERVER AND IT IS NOT A SETTING PEOPLE SHOULD NEED. The override exists for
//    development against a local stack, not as a knob to tune. It is read from an argument or the
//    environment rather than stored, so a credentials file cannot silently point a later run
//    somewhere else than the run that wrote it.

import { NmtsError } from "./errors.ts";

export const DEFAULT_SERVER = "https://nmts.me";
export const SERVER_ENV_VAR = "NMTS_SERVER";

/**
 * Resolve the server for this run: an explicit argument, then the environment, then the default.
 *
 * ⛔ Refuses anything that is not http(s). A credential is sent to whatever this returns, so a
 *    typo that lands on another scheme must stop here rather than somewhere further in.
 */
export function resolveServer(explicit?: string | undefined): string {
  const raw = explicit ?? process.env[SERVER_ENV_VAR] ?? DEFAULT_SERVER;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NmtsError(`Not a URL: ${raw}`, {
      exitCode: 2,
      nextStep: `Pass --server https://host, or unset ${SERVER_ENV_VAR}.`,
    });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new NmtsError(`A server must be http or https, not ${url.protocol}`, { exitCode: 2 });
  }
  // Trailing slashes make every later join ambiguous; normalise once, here.
  return url.origin + url.pathname.replace(/\/+$/, "");
}
