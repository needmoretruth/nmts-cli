// The library surface of this package — what `import "@needmoretruth/nmts-cli"` hands a program.
//
// ⛔ THIS IS NOT THE COMMAND. `main.ts` is what the `nmts` binary runs; nothing here parses
//    arguments, prints, prompts or exits. Everything re-exported below takes its inputs as values
//    and reports through return values and thrown `NmtsError`s, which is what lets another
//    package — the SDK, or somebody's own server — build on it without inheriting a terminal.
//
// ⛔ ONLY MODULES THAT NEVER TOUCH A TERMINAL ARE HERE. `code-access.ts`, `api-key.ts`,
//    `session.ts` and every `commands/*` file can stop to ask a person something, and a library
//    that stops to ask on somebody's server is a library that hangs. A program that wants the
//    NMTS key from the environment reads `credentials.ts` and decides for itself.
//
// ⛔ THIS ENTRY POINT IS NODE'S, AND IT SAYS SO BY REGISTERING THE NODE HOST ON THE WAY IN. Every
//    program that imports this package is unchanged by the split: the engine is still found on
//    disk, state is still the same files under the same names, the environment is still read. What
//    is new is that the same modules also run in a page, through `portable.ts` and a host
//    registered there.
//
// ⚠ THE PACKAGE'S `exports` MAP NAMES THIS FILE AND A FEW OF THE MODULES BELOW BY SUBPATH. A
//   module not named there is reachable through this file only; adding a subpath is a promise
//   that its shape stays put, so it is done on purpose and one at a time.
import { registerNodeHost } from "./host-node.js";
// ⛔ BEFORE ANYTHING BELOW CAN BE CALLED, AND THAT IS WHY IT IS A STATEMENT RATHER THAN SOMETHING A
//    CALLER DOES. A module's imports run before its body, so by the time a program holds anything
//    from this file the host is in place — and no existing caller had to learn that there is one.
registerNodeHost();
// Everything that runs anywhere, with the reasons: `portable.ts`.
export * from "./portable.js";
// Where a credential can come from on this machine. Reading is here; ASKING is not.
export { API_KEY_ENV_VAR, API_KEY_FILE_ENV_VAR, CODE_ENV_VAR, CODE_FILE_ENV_VAR, configDir, readSecretFile, resolveAccountCode, resolveApiKey, } from "./credentials.js";
// This machine as a host: the engine on disk, state in the config directory, the real environment.
export { nodeHost, registerNodeHost, statePath } from "./host-node.js";
export { engineDir } from "./engine-node.js";
// Bytes in and out of the places only Node has: a file on a disk, and this process's own stdout.
export { fileSource } from "./upload-file-node.js";
export { measureLocal } from "./upload-price-node.js";
export { fileSink } from "./download-sink-node.js";
