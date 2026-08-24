// `nmts update` — install the newest published release of this tool.
//
// ⛔ TYPING THE VERB IS THE AGREEMENT. Everything else in this tool that cannot be taken back
//    stops and waits for `--yes`, because the destructive part is a side effect of asking for
//    something else: `sweep` is asked for a tidy-up and erases rows, `rebuild` is asked for a file
//    list and replaces one. Here the thing that happens IS the thing that was typed. A command
//    called `update` that refuses to update until it is asked twice has not made anybody safer;
//    it has taught them to type `--yes` without reading, which is the habit that matters.
//
// ⛔ IT NAMES A RELEASE, NEVER "LATEST". The version is resolved once, printed, and then installed
//    from the address of THAT release. Handing the installer "latest" would mean the thing on the
//    screen and the thing on the disk are two separate answers to one question, and a release
//    published in between makes them different.
//
// ⛔ IT REFUSES WHEN THIS COPY IS NOT THE ONE IT WOULD REPLACE. Run from a source checkout, or
//    from a copy somebody put somewhere by hand, installing would not update anything — it would
//    put a SECOND copy on the PATH, and which one runs afterwards depends on the order of
//    directories in an environment variable. That is the kind of confusion somebody debugs for an
//    hour, so it is a refusal that says what to run instead.
//
// ⛔ IT ASKS THE SOURCE-HOSTING SITE, NOT NMTS. No account code, no API key, no session; the
//    command works signed out, and it is one of the two places in this tool that talk to a host
//    other than the NMTS server and the storage network. The other is `nmts recovery`.
import { spawnSync } from "node:child_process";
import { NmtsError } from "../errors.js";
import { BINARY_NAME, SOURCE_URL, VERSION } from "../product.js";
import { lookupLatest } from "../update-check.js";
import { compareVersions, installCommand, installCommandLine, isNewer, releasePageUrl, } from "../update-source.js";
/**
 * Was this copy put here by the installer that would replace it?
 *
 * The test is the one thing that is actually true of every such copy and of nothing else: it
 * lives in a directory named for the package, inside a `node_modules`.
 *
 * ⛔ BOTH SEPARATORS, AND THAT IS NOT DEFENSIVENESS. Windows accepts either, and Node hands out
 *    either: a path that came through a file URL arrives as `D:/a/…` while `import.meta.filename`
 *    gives `D:\a\…`. Splitting on the platform's own separator found nothing in the first shape,
 *    so an installed copy on Windows was told it was not installed and `update` refused to run —
 *    green on Linux and macOS, red only on the platform this repository tests last.
 */
export function installedAsPackage(moduleFile) {
    const parts = moduleFile.split(/[\\/]/);
    const at = parts.lastIndexOf("node_modules");
    return at >= 0 && parts[at + 1] === BINARY_NAME;
}
/**
 * Run the installer.
 *
 * ⛔ NO SHELL. The address is built from a version that has already been refused unless it is
 *    three numbers, so there is nothing in this command line a shell could find to interpret —
 *    and asking one to look would be inviting exactly the question this avoids. On Windows the
 *    installer is a `.cmd`, which is why its name differs there: naming it directly is what makes
 *    the shell unnecessary.
 */
function runInstaller(command, json) {
    const [, ...rest] = command;
    const binary = process.platform === "win32" ? "npm.cmd" : "npm";
    // ⛔ Under --json the installer's own output cannot go to stdout: something is parsing that.
    const result = spawnSync(binary, rest, {
        stdio: json ? ["ignore", "pipe", "pipe"] : "inherit",
        encoding: "utf8",
    });
    if (result.error !== undefined) {
        return { code: 1, unstartable: result.error.message };
    }
    const outcome = { code: result.status ?? 1 };
    if (json) {
        const said = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
        if (said.length > 0)
            outcome.output = said.slice(-2000);
    }
    return outcome;
}
export async function update(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const running = options.running ?? VERSION;
    const moduleFile = options.moduleFile ?? import.meta.filename;
    const found = await (options.lookup ?? lookupLatest)();
    if ("failed" in found)
        throw couldNotAsk(found.failed);
    const latest = found.version;
    if (!isNewer(latest, running)) {
        const ahead = compareVersions(running, latest) === 1;
        if (options.json) {
            say(JSON.stringify({ running, latest, newerAvailable: false, installed: false, ahead }));
            return 0;
        }
        say(ahead
            ? `This is ${running}. The newest published release is ${latest}, which is older.`
            : `This is ${running}, which is the newest published release.`);
        return 0;
    }
    const command = installCommand(latest);
    const line = installCommandLine(latest);
    const page = releasePageUrl(latest);
    // Unreachable while `lookupLatest` only returns shape-checked versions, and a refusal rather
    // than a cast: the value came off the network, and this is the last place that can say no.
    if (command === null || line === null || page === null) {
        throw couldNotAsk(`the newest release is named ${latest}, which this version cannot install`);
    }
    const isPackage = installedAsPackage(moduleFile);
    // ⛔ A DRY RUN THAT REFUSED WOULD BE REPORTING A FAILURE THAT DID NOT HAPPEN. It was asked to
    //    say what it would do and it said it, whichever copy this is — so it ends at 0. The refusal
    //    below belongs to the run that would actually have installed something.
    const stopping = options.dryRun === true || !isPackage;
    if (stopping) {
        const code = options.dryRun === true ? 0 : 4;
        if (options.json) {
            say(JSON.stringify({
                running,
                latest,
                newerAvailable: true,
                installed: false,
                installedAsPackage: isPackage,
                command: line,
                releasePage: page,
            }));
            return code;
        }
        say(`${running} is running. ${latest} is published:  ${page}`);
        say(``);
        if (!isPackage) {
            say(`This copy was not installed by the installer, so installing would leave two:`);
            say(`  this one    ${moduleFile}`);
            say(`  the new one wherever the installer puts it, which may come first on your PATH.`);
            say(``);
            say(`Update this copy where it came from — or, to install alongside it anyway:`);
            say(``);
        }
        say(`  ${line}`);
        return code;
    }
    if (!options.json) {
        say(`${running} → ${latest}   ${page}`);
        say(``);
        say(`  ${line}`);
        say(``);
    }
    const outcome = (options.install ?? runInstaller)(command, options.json === true);
    if (outcome.unstartable !== undefined) {
        throw new NmtsError(`The installer could not be started: ${outcome.unstartable}`, {
            exitCode: 1,
            nextStep: `Nothing was changed. \`npm\` has to be on the PATH for this command to install ` +
                `anything. Once it is, this does the same thing:\n\n  ${line}`,
        });
    }
    if (outcome.code !== 0) {
        throw new NmtsError(`The installer stopped with code ${outcome.code}.`, {
            exitCode: 1,
            nextStep: (outcome.output !== undefined ? `${outcome.output}\n\n` : "") +
                `${running} is still what runs. A global install writes outside your home directory on ` +
                `some setups and needs the rights to do it; running the same command yourself shows the ` +
                `whole reason:\n\n  ${line}`,
        });
    }
    if (options.json) {
        say(JSON.stringify({ running, latest, newerAvailable: true, installed: true, command: line }));
        return 0;
    }
    say(`${latest} is installed. \`${BINARY_NAME} --version\` says which one runs.`);
    return 0;
}
function couldNotAsk(why) {
    return new NmtsError(`Could not find out which release is newest: ${why}.`, {
        exitCode: 1,
        nextStep: `Nothing was changed. This asks the site the releases are published on, not NMTS — the ` +
            `releases are readable in a browser at:\n\n  ${SOURCE_URL}/releases/latest`,
    });
}
