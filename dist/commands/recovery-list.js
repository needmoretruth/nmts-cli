// `nmts recovery-list` — writing the account's recovery list out as a file.
//
// ⛔ WHY IT EXISTS. The recovery list is the answer to "NMTS is gone and I still have my account
//    code": it holds, encrypted, where every file's bytes are on the public storage network, and
//    the key that opens each of them. The account screen has always been able to write one. An
//    account used only from a terminal could not, so the artefact that exists for the day this
//    service is not there did not exist for those accounts at all.
//
// ⛔ IT IS NOT THE FILE-LIST COPY, AND NEITHER REPLACES THE OTHER. `nmts listfile` writes the names
//    and keys this machine has seen; this one writes the storage addresses, which that file has
//    none of. Keep both, and keep both somewhere other than the account code.
//
// ⛔ THE ACCOUNT CODE IS NOT IN THE FILE. This file plus the code is the account, so keeping them
//    together turns one theft into a total loss. The artefact that deliberately carries both is
//    `nmts kit`, and it says so about itself.
//
// ⛔ NO PARTIAL LIST, EVER. If any page, name or key does not reconcile, nothing is written and the
//    reason is printed. A list quietly missing files tells somebody they are covered when they are
//    not, and they find out on the one day it cannot be repaired.
import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { NmtsError } from "../errors.js";
import { assembleRecoveryList, recordRecoveryList } from "../recovery-assemble.js";
export async function recoveryList(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const assembled = await assembleRecoveryList({
        server: options.server,
        network: options.network,
    });
    const { built, file, seq } = assembled;
    // ⛔ ASKED BEFORE THE ATTEMPT AND ENFORCED BY THE WRITE ITSELF. The `wx` flag below is what
    //    actually reserves the name; this only turns the common case into a sentence rather than a
    //    system error.
    const destination = destinationFor(options.out, file.filename);
    if (options.force !== true && existsSync(destination))
        throw alreadyThere(destination);
    try {
        // ⛔ 0600. These bytes are one account's whole storage index, sealed — and a mode is cheaper to
        //    get right than an explanation of why it did not matter.
        writeFileSync(destination, file.content, {
            flag: options.force === true ? "w" : "wx",
            mode: 0o600,
        });
    }
    catch (error) {
        if (error instanceof Error && Reflect.get(error, "code") === "EEXIST") {
            throw alreadyThere(destination);
        }
        throw error;
    }
    await recordRecoveryList(assembled, destination);
    if (options.json === true) {
        say(JSON.stringify({
            writtenTo: destination,
            seq,
            nrm: built.doc.v,
            files: built.fileCount,
            bytes: built.totalBytes,
            capturedAt: assembled.capturedAt,
            // ⛔ REACHES A READER THAT ONLY PARSES JSON. An agent has to be able to say the account is
            //    not fully covered without a person reading the lines below.
            missingFromSource: built.missingFromSource,
        }));
        return 0;
    }
    say(`Wrote ${destination}`);
    say(``);
    say(`  Recovery list ${seq} — ${built.fileCount} files, ${built.totalBytes} bytes described.`);
    say(`  It holds where each file's bytes are on the storage network, and the key that opens`);
    say(`  each one, sealed with the account code.`);
    say(``);
    say(`  Recorded with the server: version ${seq}, kept on this machine (no storage-network`);
    say(`  copy), read from the account at ${assembled.capturedAt}.`);
    if (built.missingFromSource.length > 0) {
        say(``);
        say(`  ⚠ ${built.missingFromSource.length} file(s) in your file list are not in the account's`);
        say(`    stored files, so they are not in this list. An upload that never finished looks like`);
        say(`    this. Nothing here is covered for them.`);
    }
    say(``);
    say(`  ⛔ It does not contain the account code. Keep it somewhere other than the code: together`);
    say(`     they are the whole account.`);
    say(`  ⚠ A list goes stale. Run this again after uploading: of two files, the one whose filename`);
    say(`    carries the higher number supersedes the other.`);
    return 0;
}
/** Where the file goes: the given file name, inside the given directory, or this directory. */
function destinationFor(out, filename) {
    if (out === undefined)
        return join(process.cwd(), filename);
    const target = isAbsolute(out) ? out : resolve(process.cwd(), out);
    // A directory that exists means "put it in here under its own name"; anything else is the name
    // to write. Guessing the other way round would rename the artefact whose filename is how a
    // person tells two copies apart.
    if (existsSync(target) && statSync(target).isDirectory())
        return join(target, filename);
    return target;
}
function alreadyThere(destination) {
    return new NmtsError(`${destination} is already there.`, {
        exitCode: 4,
        nextStep: `Nothing was written. Pass --out to choose another name, or --force to replace it.`,
    });
}
