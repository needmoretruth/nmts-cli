// `nmts login` — keep an account code on this machine, in one of three shapes.
//
// ⚠ IT DOES NOT CHECK THE CODE WITH THE SERVER, AND IT SAYS SO. The code never goes to the server
//    at all — it is what opens the files, and nothing on the far end has ever seen it — so there
//    is nobody to ask whether it is the right one. Its own check symbol is verified here, offline,
//    and that is the whole of what can be known: a code for an account that does not exist is
//    stored and looks fine until a command needs the server.
//
// ⛔ THE API KEY IS THE OTHER HALF OF SETTING THIS TOOL UP, AND IT IS CHECKED. It is a credential
//    the SERVER issued, so the server can be asked about it — and it is, before it is written
//    down, against the one route a key reaches without holding any permission. Until this command
//    took one, a key could only arrive in an environment variable that vanishes with the terminal
//    or by somebody editing the credentials file by hand. Where a key comes from and what is done
//    to it lives in `api-key.ts`; what a person is told about it lives here.
//
// ⛔⭐ THE DEFAULT IS SEALED (owner, 2026-08-23: *support storing it, but by default only with
//    encryption or the like; if they agree to a disclaimer and unlock it, allow plain storage
//    too*). So there are three shapes and the person picks, rather than the tool deciding for
//    them and being wrong on somebody's laptop:
//
//      nmts login            sealed under a passphrase.  Asks nothing.
//      nmts login --plain    in the clear at mode 600.   Asks once: `unsafe-code-storage`.
//      nmts login --env      stores nothing; prints the variable to set. Asks once: `plain-env`.
//
// ⚠ AND WHAT A PERSON DOES OUTSIDE THIS TOOL IS THEIRS. Writing the code into a note, a password
//   manager or a repository is not something this can see, and it is not something it should try
//   to stop. What it can do is make the shape it writes ITSELF a decision.
import { assertUsableCode } from "../account.js";
import { keySourceName, keyToStore, settleApiKey } from "../api-key.js";
import { lockCode, samePassphrase } from "../code-vault.js";
import { API_KEY_ENV_VAR, API_KEY_FILE_ENV_VAR, CODE_ENV_VAR, CODE_FILE_ENV_VAR, PASSPHRASE_ENV_VAR, codeStorageIsPrivate, credentialsPath, modesAreEnforced, readCredentialsFile, readSecretFile, writeCredentials, } from "../credentials.js";
import { requireConsent } from "../consent.js";
import { NmtsError } from "../errors.js";
import { firstRunNotice } from "../notice.js";
import { holdTerminal, promptSecret, stdinIsATerminal } from "../prompt.js";
import { askAboutCollisions } from "../setup-questions.js";
import { BINARY_NAME, HOME_URL } from "../product.js";
import { resolveNetwork } from "../network.js";
import { resolveServer } from "../server.js";
/**
 * ⚠ EIGHT, AND NO COMPOSITION RULES. scrypt makes a short passphrase expensive to attack, not
 *   safe: four characters is guessed whatever the cost factor. Requiring a digit and a capital
 *   would not change that and would push people to reuse the one they always type.
 */
const MIN_PASSPHRASE = 8;
export async function login(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const server = resolveServer(options.server);
    // ⛔ Settled BEFORE the notice and before anything is written: if the network cannot be decided,
    //    nothing about this account should be stored at all.
    const network = resolveNetwork(server, options.network);
    const existing = readCredentialsFile();
    if (options.plain === true && options.env === true) {
        throw new NmtsError("--plain and --env ask for two different things.", {
            exitCode: 2,
            nextStep: "--plain writes the code to this machine; --env writes nothing and prints it.",
        });
    }
    if (existing === null)
        say(firstRunNotice());
    // ⛔ ONE HOLD OVER EVERY QUESTION THIS COMMAND ASKS. Between two prompts the terminal is back in
    //    line mode, where it echoes what is typed and swallows lines the next prompt never sees —
    //    and this command asks up to three things with a check in the middle.
    const exit = await holdTerminal(async () => {
        const code = await readTheCode(options);
        // ⛔ CHECKED BEFORE IT IS WRITTEN. The engine verifies the code's own check symbol offline, so
        //    a mistyped code fails here as "that is not a code" instead of being stored and coming
        //    back later as a sign-in failure indistinguishable from a wrong password or a suspended
        //    account.
        await assertUsableCode(code);
        if (options.env === true)
            return printEnvForm(code, say);
        // ⛔ THE KEY IS SETTLED BEFORE THE PASSPHRASE IS ASKED FOR, for the reason the code is checked
        //    before it: everything that can refuse this run should refuse it before somebody has typed
        //    a passphrase twice. It comes after the `--env` branch because that branch writes nothing
        //    at all — there is nowhere for a key to go, and asking for one would be a question whose
        //    answer this command would then throw away.
        const key = await settleApiKey({
            server,
            stored: existing?.apiKey,
            readKey: options.readApiKey,
            confirmReplace: options.confirmKeyReplace,
        });
        const apiKey = keyToStore(key);
        const exit = options.plain === true
            ? storePlain(code, server, network, apiKey, say)
            : await storeSealed(code, server, network, apiKey, options, say);
        sayCheckSymbol(say, key.kind === "stored");
        sayAboutTheKey(key, server, say);
        return exit;
    });
    // ⛔ AFTER THE HOLD, AND ONLY WHEN THE SIGN-IN WORKED. Inside the hold the terminal is in raw
    //    mode and a line prompt never sees a line; before the end, this would be a question about a
    //    setup that then failed. Why it is asked at all is in `setup-questions.ts`.
    if (exit === 0)
        await askAboutCollisions(say);
    return exit;
}
/**
 * Where `login` gets the code to store.
 *
 * ⛔⭐ THE ENVIRONMENT PATH ASKS HERE TOO, AND AN ADVERSARIAL REVIEW IS WHY. This function used to
 *    read `NMTS_ACCOUNT_CODE` directly, so `login` was the one command that used a plain
 *    environment variable without the agreement every other command demands — and the code it
 *    took that way came back out as a sealed store, which needs no agreement at all. Two commands
 *    and the recorded decision was gone, while the documentation said it could not be.
 *
 * ⚠ ORDER: a file first, because that is the shape this tool recommends and it asks for nothing;
 *   then the environment, which asks once; then the terminal.
 */
async function readTheCode(options) {
    const fromFile = readSecretFile(CODE_FILE_ENV_VAR);
    const fromEnv = process.env[CODE_ENV_VAR];
    if (options.readCode === undefined && fromFile === null && fromEnv !== undefined && fromEnv.length > 0) {
        requireConsent("plain-env");
    }
    const code = options.readCode !== undefined
        ? await options.readCode()
        : fromFile !== null
            ? fromFile
            : fromEnv !== undefined && fromEnv.length > 0
                ? fromEnv
                : await promptSecret(`Account code (not shown as you type): `, CODE_ENV_VAR);
    if (code.length === 0) {
        throw new NmtsError("No account code was given.", {
            exitCode: 2,
            nextStep: stdinIsATerminal()
                ? `Run \`${BINARY_NAME} login\` again and paste the code.`
                : `Set ${CODE_ENV_VAR} in the environment.`,
        });
    }
    return code;
}
/** Seal it. The default, and the only shape that survives the file being copied off the machine. */
async function storeSealed(code, server, network, apiKey, options, say) {
    const passphrase = await newPassphrase(options);
    const lockedCode = lockCode(code, passphrase);
    writeCredentials({ lockedCode, server, network, ...(apiKey ? { apiKey } : {}) });
    say(`Sealed for ${server} (${network}) in ${credentialsPath()}`);
    say(``);
    say(`  What is on disk is not the account code. Opening it needs the passphrase, so a copy of`);
    say(`  this file — in a backup, a synced folder, a container image, a stolen disk — is worth`);
    say(`  nothing on its own.`);
    say(``);
    say(`  ⚠ It does NOT protect the code from anything running as you on this machine while you`);
    say(`    are using the tool. Whatever supplies the passphrase can be read the same way.`);
    say(``);
    say(`  Every command that needs the code will ask for the passphrase, or read it from`);
    say(`  ${PASSPHRASE_ENV_VAR}. Opening it costs a fraction of a second and 64 MiB of memory each`);
    say(`  time, on purpose: that is what makes guessing the passphrase expensive.`);
    return 0;
}
/**
 * In the clear, behind the disclaimer.
 *
 * ⛔ THE AGREEMENT IS DEMANDED BEFORE THE CODE IS WRITTEN. ⚠ Not before anything at all happens:
 *    `codeStorageIsPrivate()` runs first and creates the config directory 0700 while measuring
 *    whether a file there can be kept private — that measurement is what the refusal's text has
 *    to be right about, so it cannot come after it.
 */
function storePlain(code, server, network, apiKey, say) {
    const private_ = codeStorageIsPrivate();
    requireConsent("unsafe-code-storage");
    writeCredentials({ accountCode: code, server, network, ...(apiKey ? { apiKey } : {}) });
    say(`Stored in the clear for ${server} (${network}) in ${credentialsPath()}`);
    if (modesAreEnforced()) {
        say(`  The file is readable only by you (mode 600). It is not encrypted: anything running as`);
        say(`  you can read it, which includes every agent you run on this machine.`);
    }
    else {
        say(`  Windows does not apply a file mode here, so the file inherits the folder's permissions.`);
    }
    if (!private_) {
        say(``);
        say(`  ⛔ This machine did not keep the mode that was asked for, so anybody who can reach that`);
        say(`     path can read the code. \`${BINARY_NAME} login\` without --plain seals it instead,`);
        say(`     and ${CODE_ENV_VAR}_FILE names a file this tool never copies.`);
    }
    return 0;
}
/**
 * Write nothing; print what to set.
 *
 * ⛔ THIS PRINTS THE ACCOUNT CODE, which every other part of this tool refuses to do. It is the
 *    one command whose entire purpose is to hand it back, it says so, and it is behind an
 *    agreement that names how an environment variable leaks.
 */
function printEnvForm(code, say) {
    requireConsent("plain-env");
    // ⛔ SINGLE QUOTES AND NO INTERPOLATION. A shell cannot be persuaded to run part of a
    //    single-quoted string, and a code containing a single quote — the one character that would
    //    break it — cannot exist: the alphabet is Crockford base32, and `'` is refused by the parser
    //    that already accepted this code.
    //
    // ⛔ AND THE WHITESPACE COMES OUT FIRST. The parser treats EVERY whitespace character as an
    //    ignorable separator, so a perfectly valid code can arrive with newlines in it — and this
    //    printed it as eight lines while calling it one, the first of which was an unterminated
    //    string. What is printed has to be a line somebody can paste.
    say(`export ${CODE_ENV_VAR}='${code.replace(/\s+/gu, "")}'`);
    say(``);
    say(`  Nothing was written to this machine. Paste that where your program's environment is set.`);
    say(``);
    say(`  ⚠ The code is now on this screen, and probably in this terminal's scrollback. An`);
    say(`    environment variable is readable by anything running as you, by every child process,`);
    say(`    and — inside a container — by anybody who can run \`docker inspect\`.`);
    say(``);
    say(`  ${CODE_ENV_VAR}_FILE names a FILE holding the code instead, and has none of those.`);
    return 0;
}
/**
 * What is known about the code once it is stored — which depends on whether a key was checked.
 *
 * ⛔⭐ THE SECOND HALF WENT FALSE THE DAY THIS COMMAND STARTED CHECKING A KEY. "Whether the account
 *    exists has not been checked" was exactly right while nothing here spoke to the server; after a
 *    key is accepted, an account demonstrably exists. What is STILL unknown is a different thing
 *    and a sharper one — whether the code and the key belong to the SAME account — and it cannot
 *    be checked by anybody, because the code never goes to the server. Saying the old sentence
 *    after a key had just been accepted would have been the tool describing the world before it.
 */
function sayCheckSymbol(say, keyWasAccepted) {
    say(``);
    say(`  The code is well-formed — its own check symbol matches. That was verified here, offline.`);
    if (!keyWasAccepted) {
        say(`  Whether the account EXISTS has not been checked: signing in goes through a human check`);
        say(`  this tool cannot pass yet, so that will first show up on a command that needs the server.`);
        return;
    }
    say(`  ⚠ Whether it is the code for the account the KEY belongs to has not been checked, and`);
    say(`    cannot be: the code never goes to the server, so nothing can compare the two. A code`);
    say(`    from a different account looks like an account with nothing in it.`);
}
/**
 * What was decided about the API key, said after where the code went.
 *
 * ⛔ THE HANDLE AND NOTHING ELSE. The half printed here is the one the account screen lists; the
 *    secret half is not shown in a confirmation, in an error, or under --json anywhere else in
 *    this tool. Whoever ran this command already has the key, so there is nothing to gain by
 *    echoing it — and a confirmation lands in scrollback, in a screen share, and in whatever an
 *    agent writes to its log.
 */
function sayAboutTheKey(outcome, server, say) {
    switch (outcome.kind) {
        case "unchanged":
            // The key that was here is still here and was not touched. Nothing happened to report.
            return;
        case "none":
            say(``);
            say(`No API key is stored, and every command that talks to the server needs one.`);
            say(``);
            say(`  Make one on the account screen at ${HOME_URL}, then run \`${BINARY_NAME} login\` again`);
            say(`  with it in ${API_KEY_ENV_VAR} — or paste it when this asks. It is checked with the`);
            say(`  server before it is written down.`);
            say(``);
            say(`  ${API_KEY_FILE_ENV_VAR} names a FILE holding the key instead, which is the shape a`);
            say(`  container cannot leak. The key waives the human check a browser sign-in does, and`);
            say(`  nothing else — it opens no file.`);
            return;
        case "stored":
            say(``);
            say(`Key ${outcome.handle} stored for ${server}.`);
            say(``);
            say(`  That is the key's public handle — the part the account screen lists. The secret half`);
            say(`  is not printed here.`);
            say(``);
            say(`  ${server} accepted it just now, so it is a key this account has and nothing has`);
            say(`  revoked. It waives the human check a browser sign-in does, and nothing else — it`);
            say(`  opens no file, and what it is allowed to ask for was decided when it was made.`);
            if (!outcome.verified) {
                say(``);
                say(`  ⚠ Nothing has checked lately that a person is behind this account, so some requests`);
                say(`    are refused and the rest are held to tighter limits. \`${BINARY_NAME} verify\` prints`);
                say(`    a code for a person to type at a browser.`);
            }
            return;
        case "kept":
            say(``);
            say(`⚠ A different API key is in ${keySourceName(outcome.from)}. It was NOT stored.`);
            say(``);
            say(`  The key already on this machine is left as it is. Replacing one is something to say`);
            say(`  out loud, not something a run about the account code does on the way past — every`);
            say(`  agent using the old one would stop working at a moment nobody would connect to this.`);
            say(``);
            say(`  While that variable is set, every command uses what it holds anyway: the environment`);
            say(`  wins over what is stored. To store it instead — at a terminal, run this again and`);
            say(`  answer the question it asks; with no terminal, \`${BINARY_NAME} logout\` first and`);
            say(`  then \`${BINARY_NAME} login\`.`);
            return;
    }
}
/**
 * A passphrase for a NEW seal: from the environment, or typed twice.
 *
 * ⚠ The environment form is not confirmed, because there is nothing to confirm it against and
 *   asking would hang. A typo there produces a file whose passphrase nobody knows — which is why
 *   the message below says to keep it, not merely to choose it.
 */
async function newPassphrase(options) {
    const ask = options.readPassphrase;
    const fromEnv = process.env[PASSPHRASE_ENV_VAR];
    if (ask === undefined && fromEnv !== undefined && fromEnv.length > 0) {
        if (fromEnv.length < MIN_PASSPHRASE)
            throw tooShort();
        return fromEnv;
    }
    if (ask === undefined && !stdinIsATerminal()) {
        throw new NmtsError("Sealing the account code needs a passphrase, and there is no terminal.", {
            exitCode: 2,
            nextStep: [
                `One of these:`,
                `  · set ${PASSPHRASE_ENV_VAR} and run this again`,
                `  · ${BINARY_NAME} login --plain   store it unsealed (asks for an agreement first)`,
                `  · ${BINARY_NAME} login --env     store nothing; print the variable to set`,
            ].join("\n"),
        });
    }
    const prompt = ask ?? ((q) => promptSecret(q, PASSPHRASE_ENV_VAR));
    const first = await prompt(`New passphrase for the stored code (not shown as you type): `);
    if (first.length < MIN_PASSPHRASE)
        throw tooShort();
    const again = await prompt(`Type it again: `);
    if (!samePassphrase(first, again)) {
        throw new NmtsError("Those two passphrases are not the same.", {
            exitCode: 2,
            nextStep: `Nothing was written. Run \`${BINARY_NAME} login\` again.`,
        });
    }
    return first;
}
function tooShort() {
    return new NmtsError(`That passphrase is shorter than ${MIN_PASSPHRASE} characters.`, {
        exitCode: 2,
        nextStep: `Nothing was written. A short passphrase is guessed whatever the tool does to slow guessing ` +
            `down. ⛔ If it is lost, the sealed copy cannot be opened by anybody — keep it somewhere.`,
    });
}
