// `nmts env` — what this machine is, and what that means for the account code.
//
// ⛔ IT ASKS THE SERVER NOTHING AND NEEDS NO CREDENTIAL. It is the first command an agent can run
//    on a machine it has never seen, and a command that needed to be signed in to say "there is
//    nowhere safe to keep the code here" would say it too late.
import { adviseFor, readEnvironment } from "../environment.js";
import { PASSPHRASE_ENV_VAR, resolveAccountCode, resolveApiKey, } from "../credentials.js";
import { BINARY_NAME, SUPPORT_EMAIL } from "../product.js";
/**
 * Where a credential came from, in words rather than in the field name.
 *
 * ⛔ `--json` keeps the field name. A machine wants a value it can compare; a person reading the
 *    table wants to know whether the thing on disk is the code or a sealed copy of it, and
 *    "file-locked" does not say that to somebody who has never read this source.
 */
function sourceWords(source) {
    switch (source) {
        case "env":
            return "environment variable — readable by anything running as you";
        case "secret-file":
            return "a file named by an environment variable";
        case "file":
            return "this tool's own file, unsealed";
        case "file-locked":
            return "this tool's own file, sealed with a passphrase";
    }
}
export function env(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const environment = readEnvironment();
    // ⛔ WHETHER, NOT WHAT. Nothing about a credential's VALUE is read here, printed here, or
    //    returned by --json. What is reported is that one was found and where it came from.
    let code = null;
    let key = null;
    // ⛔ REFUSED IS NOT ABSENT, AND THIS COMMAND IS THE ONE PLACE THAT MUST SAY WHICH. Both of these
    //    used to swallow the failure and report "not found" — so a credentials file gone
    //    world-readable, which is a leak nothing else in the system ever mentions, was invisible in
    //    the very command written to be run first on a machine nobody knows. The MESSAGE is kept
    //    (it names a path, never a value); the credential is not.
    let codeProblem = null;
    let keyProblem = null;
    try {
        code = resolveAccountCode();
    }
    catch (error) {
        codeProblem = error instanceof Error ? error.message : String(error);
    }
    try {
        key = resolveApiKey();
    }
    catch (error) {
        keyProblem = error instanceof Error ? error.message : String(error);
    }
    const advice = adviseFor(environment, code !== null);
    if (options.json) {
        say(JSON.stringify({
            ...environment,
            accountCode: code === null
                ? codeProblem === null
                    ? null
                    : { present: false, refused: codeProblem }
                : { present: true, source: code.source },
            apiKey: key === null
                ? keyProblem === null
                    ? null
                    : { present: false, refused: keyProblem }
                : { present: true, source: key.source },
            advice,
        }));
        return 0;
    }
    say(`  system        ${environment.os} ${environment.osRelease} · node ${environment.node}`);
    const mapping = environment.rootMapped === null
        ? ""
        : environment.rootMapped
            ? " · rootless (root here is an ordinary user on the host)"
            : " · root here is root on the host";
    say(`  containment   ${environment.containment}${mapping}`);
    say(`  running as    uid ${environment.uid ?? "n/a"}`);
    say(`  private files ${environment.privateStorage ? "yes" : "NO — this filesystem does not keep a file mode"}`);
    say(`  config        ${environment.configDir}`);
    say(`  terminal      ${environment.interactive ? "yes" : "no — nothing here can be typed"}`);
    say(`  browser       ${environment.browserReachable ? "reachable" : "not reachable"}`);
    const found = (got, problem) => (got !== null ? `found — ${sourceWords(got.source)}` : problem !== null ? `⛔ REFUSED — ${problem}` : "not found");
    say(`  account code  ${found(code, codeProblem)}`);
    if (code?.source === "file-locked") {
        // ⛔ THE ANSWER AN AGENT NEEDS BEFORE IT RUNS ANYTHING ELSE. A sealed code with no way to
        //    supply the passphrase is not a usable credential, and finding that out on the first
        //    upload — after the file has been read and sealed — is finding it out too late.
        const havePassphrase = (process.env[PASSPHRASE_ENV_VAR] ?? "").length > 0;
        const how = havePassphrase
            ? `${PASSPHRASE_ENV_VAR} is set`
            : environment.interactive
                ? `it will be asked for on the terminal`
                : `⛔ NOT AVAILABLE — no ${PASSPHRASE_ENV_VAR} and no terminal`;
        say(`  passphrase    ${how}`);
    }
    say(`  api key       ${found(key, keyProblem)}`);
    if (advice.length > 0) {
        say(``);
        for (const item of advice) {
            say(`  ${item.level === "warn" ? "⛔" : "·"} ${item.text}`);
        }
    }
    say(``);
    say(`  \`${BINARY_NAME} env --json\` is the same thing in one line.`);
    say(`  Something here wrong or missing? ${SUPPORT_EMAIL}`);
    return 0;
}
