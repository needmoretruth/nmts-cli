// What `nmts` prints when asked what it can do.
//
// ⛔ COMMANDS THAT ARE NOT BUILT ARE MARKED, NOT HIDDEN. An agent that discovers a command by
//    running it and getting "unknown command" learns the wrong thing — it will try synonyms. Being
//    told the command exists and is unfinished is a fact it can act on: stop, and do not retry.
import { AGENTS_DOC, BINARY_NAME, HOME_URL, PRODUCT_NAME, SOURCE_URL, VERSION } from "./product.js";
// ⛔ THE COPY IS IMPORTED, NOT RETYPED. The same sentences are printed by `nmts support --help`
//    and above every preview, and what they promise is what is taken out of a message before it
//    leaves — not a promise to keep in two versions. ⚠ That module has no imports of its own, so
//    reading it here costs `nmts --help` nothing (`check:cli-startup`).
import { ATTACH_LOG_TEXT, SUPPORT_LONG, supportHelpText } from "./support-copy.js";
import { API_KEY_ENV_VAR, API_KEY_FILE_ENV_VAR, CODE_ENV_VAR, CODE_FILE_ENV_VAR, PASSPHRASE_ENV_VAR, } from "./credentials.js";
import { NETWORK_ENV_VAR } from "./network.js";
import { LATEST_RELEASE_URL, NO_CHECK_ENV_VAR } from "./update-source.js";
import { SERVER_ENV_VAR } from "./server.js";
import { AGGREGATOR_ENV_VAR } from "./walrus.js";
import { CHECK_DOES_NOT_PROVE, CHECK_PROVES, RECOVERY_TOOL_URL, wrapText, } from "./recovery-release.js";
export function helpText(version) {
    return [
        `${PRODUCT_NAME} ${version} — command-line access to end-to-end encrypted NMTS storage.`,
        ``,
        `USAGE`,
        `  ${BINARY_NAME} <command> [options]`,
        ``,
        `COMMANDS`,
        `  login                 Keep an account code on this machine, sealed — and take an API key`,
        `  logout                Remove the stored account code`,
        `  whoami                Show which account the stored code belongs to (offline)`,
        `  create                Make a NEW account. Prints its code once — nothing can print it again.`,
        `                        With no verified key, it prints an address for a PERSON to open`,
        `  key new               Make an API key for this machine out of the account code it already`,
        `                        holds, and store it. \`--print\` shows it once as well`,
        `  key list              Every API key of this account: what it may do, when it stops, when it`,
        `                        was last used. Needs the account code; a key cannot list keys`,
        `  key revoke <id|all>   Cut one key, or all of them — whatever uses it stops at once`,
        `  devices               What is signed in to this account. \`--sign-out <id|all>\` ends one`,
        `                        or all — a person's act: needs the account code, refused in mode auto`,
        `  ls                    List files in the account`,
        `  usage                 What the account holds: counts, bytes, largest files, trash`,
        `  balance               Credits left, what they buy, and the ceilings on spending`,
        `  trial                 What is left of this week's free credits. \`trial apply\` asks for some`,
        `  expiring              List files whose bought storage runs out soon`,
        `  losses                Storage the daily check could not find on the chain; --recheck <id> · --dismiss <id>`,
        `  extend <path>         Buy more storage time for one file — **spends WAL from the wallet**`,
        `  public-code           The code other accounts send files to. \`--publish\` makes it reachable`,
        `  delete-account        A PERSON erases this account's server record — irreversible; needs the`,
        `                        account code, types a sentence, refused in mode auto`,
        `  accept-terms          A PERSON accepts a new version of the Terms, by typing its version;`,
        `                        refused in mode auto. Read first: terms · privacy · notices`,
        `  wallet                Show the account's wallet address, and its SUI and WAL balances`,
        `  wallet address        Just the address, derived on this machine — no network call.`,
        `                        \`--qr\` draws it as a code a phone can scan`,
        `  wallet activity       The wallet's recent transactions, named where the chain proves it`,
        `  wallet storage        The storage resources (size × time) the wallet holds, unbound`,
        `  wallet storage split <id> --size <n>|--epochs <n> · merge <id> <id> · transfer <id> <address>`,
        `                        Cut, join or hand over a resource — **signs**, under the wallet unlock`,
        `  wallet send <SUI|WAL> <amount|max> <address>`,
        `                        Send coins to an address — **signs and spends from the wallet**.`,
        `                        Prints the review; sends only with --yes`,
        `  wallet swap <SUI|WAL> <amount|max>`,
        `                        Swap one coin for the other on DeepBook or Bluefin (mainnet) —`,
        `                        **signs and spends**. Without --venue, quotes both and stops`,
        `  wallet donate <SUI|WAL> <amount>`,
        `                        A voluntary gift to the developer — **signs and spends**. A person's`,
        `                        act: refused in mode auto, and needs --yes every time`,
        `  wallet hall           The gift hall of fame, read from the chain. \`--name <name>\` lists you`,
        `                        under a name your wallet signs for; \`--remove\` goes back to a`,
        `                        shortened address. Reading it signs nothing`,
        `  put <file>            Encrypt one file and upload it, paid with credits — or, with`,
        `                        \`--pay wallet\`, **signs and spends WAL and SUI from the wallet**`,
        `  get <path>            Download one file and decrypt it`,
        `  pull [folder]         Download a whole folder, or the whole account, keeping its shape`,
        `  push <directory>      Upload a whole directory, keeping its shape — **spends credits**,`,
        `                        or the wallet with \`--pay wallet\``,
        `  rm <paths>            Move things to the trash — restorable for 30 days`,
        `  restore <paths>       Bring things back out of the trash`,
        `  sweep                 Drop trash entries whose 30 days have run out. Asks first`,
        `  erase <paths>         Erase files for good — the server's record and this account's key.`,
        `                        A typed sentence; \`--release-storage\` also destroys credit-paid storage`,
        `  rebuild               Build a file list from the server's rows, for an account with none`,
        `  rollback              Put the previous file list back — a person's act`,
        `  listfile              Write this machine's copy of the sealed file list out as a file`,
        `  mkdir <path>          Make a folder, and any folder above it that is missing`,
        `  mv <paths> <folder>   Move things into a folder. \`/\` is the top of the drive`,
        `  rename <path> <name>  Give one thing a new name`,
        `  star <files>          Star files — they are gathered in favourites as well`,
        `  unstar <files>        Take the star off`,
        `  pin <files>           Hold files at the top of the folder they are in`,
        `  unpin <files>         Let them fall back into the ordinary order`,
        `  label <name> <files>  Put one label on files. A label exists while a file wears it`,
        `  unlabel <name> <files>`,
        `                        Take one label off files`,
        `  share <path> <addr>   Give one file to another account. Withdrawing does not recall it.`,
        `                        In normal mode it asks every time: answer with --yes`,
        `  shares                What was shared with this account`,
        `  receive <id>          Download one file somebody shared with this account`,
        `  unshare <id>          Withdraw a share you sent, or remove one you were sent`,
        `  env                   What this machine is, and what it means for the account code`,
        `  unlock [name]         What this machine has unlocked; \`unlock <name>\` opens one — a person,`,
        `                        at a terminal. \`lock <name>\` closes it. (\`consent\` is the older name)`,
        `  mode [name]           How much an agent may decide without asking: default · auto-low ·`,
        `                        auto-high · skip-permissions. Switched by a person at a terminal`,
        `  on-collision          What to do when an upload's name is already in use`,
        `  padding [mode]        How file sizes are hidden: standard, pow2, or off for the exact size.`,
        `                        Applies to the next uploads`,
        `  deposit [credits]     Credits each credit-paid upload sets aside as a deposit, 0 to 64.`,
        `                        Default 64; \`put --deposit <n>\` sets it for one upload`,
        `  tip [percent|off]     The standing share of every storage payment sent to the developer as a`,
        `                        gift, in WAL, without asking. 0 by default; the gift terms are agreed once`,
        `  update                Install the newest published release of this tool`,
        `  recovery              Download the standalone program that reads files back without NMTS`,
        `  recovery-list         Write the file that finds your bytes without NMTS. Holds no code`,
        `  kit                   Recovery kit: that list AND your account code, together in one file`,
        `  verify                Ask a person to pass the check that opens this account's limits`,
        `  support               Write to the developer of NMTS: a bug, an error, an idea, a question`,
        `  notices               What NMTS has posted. <id> prints one; --save <id> keeps it as a file`,
        `  terms                 The Terms of Service in force. --board for the message board's`,
        `  privacy               The Privacy Policy in force`,
        `  mcp                   Serve this account's commands as tools, for an agent that speaks MCP`,
        `  s3                    Serve the drive to any S3 program, on this machine only`,
        ``,
        `OPTIONS`,
        `  --server <url>        NMTS server (default ${SERVER_ENV_VAR} or the live one)`,
        `  --network <name>      mainnet or testnet. Required for any server but the live one`,
        `  --json                Machine-readable output (ls, usage, get, put, env, verify,`,
        `                        expiring, losses, sweep, rebuild, rollback, pull, wallet, shares,`,
        `                        share, receive, label, unlabel, padding, deposit, whoami --reveal,`,
        `                        recovery, balance, trial, extend, recovery-list, kit, update, notices,`,
        `                        devices, key new, key list, key revoke, create. \`key new\` puts the key string in the JSON`,
        `                        only with --print, and \`create\` needs --out as well, so neither`,
        `                        secret enters the output by default)`,
        `  --all                 Include what is in the trash (ls), or take one label off every`,
        `                        file that carries it (unlabel)`,
        `  --sent <path>         Who ONE file was shared with, instead of the inbox (shares)`,
        `  --rename <old>        The label to rename; the new name follows it (label)`,
        `  --qr                  Draw the wallet address as a code to scan (wallet address)`,
        `  --remove              Take your name off the gift hall of fame, leaving a shortened`,
        `                        address (wallet hall). Give this or --name, not both`,
        `  --days <n> | --until <date>`,
        `                        How long a wallet agreement lasts, at most 30 days (unlock`,
        `                        wallet), or how long a new API key lasts (key new). Default 30 days;`,
        `                        the server clamps at its own ceiling and the reply says the date`,
        `  --scopes <list>       What a new key may do (key new): read, write, spend, comma-separated.`,
        `                        Default read. A program that uploads needs all three`,
        `  --print               Put the new key on the screen once as well (key new). It is stored on`,
        `                        this machine either way, and NMTS keeps no copy of it`,
        `  --scope storage|all   What a wallet agreement covers: storage, or also exchanging and`,
        `                        sending (unlock wallet). Default storage. A gift is in neither`,
        `  --cap-wal <coins> --cap-sui <coins>`,
        `                        A ceiling on what this tool may sign away under the agreement`,
        `  --fee-cap <sui>       A ceiling on the chain fee of one transaction (wallet send, wallet`,
        `                        swap). Only up to it is used; the rest stays in the wallet`,
        `  --venue <name>        deepbook or bluefin (wallet swap). Neither is a default: without`,
        `                        it both quotes are printed and nothing is signed`,
        `  --slippage-bps <n>    How far below the quote the swap may still fill, in bps — 1 bps`,
        `                        = 0.01% (wallet swap). 1 to 5000, default 50. Below 10 or above`,
        `                        200 is an extreme`,
        `  --accept-extremes     Go on past the extremes gate — slippage, fee cap or a quote more`,
        `                        than 3% from the site's reference price (wallet swap). A person's`,
        `                        act, refused while a mode is on`,
        `  --reveal              Print the account code itself (whoami). A person's act, and`,
        `                        refused while a mode is on`,
        `  --find <text>         List only the files whose name contains this text (ls). Folders`,
        `                        appear only where they hold a match`,
        `  --sort <key>          name, size or date. Default: whole paths, ascending (ls)`,
        `  --desc                Reverse whichever order is in effect (ls)`,
        `  --hidden              Include entries whose name begins with a dot (push)`,
        `  --out <path>          Where to write files (get, pull, mcp, listfile, recovery,`,
        `                        recovery-list, kit, create, notices, terms, privacy). Default: here`,
        `  --out -               Send a fetched file to stdout instead of writing it (get, listfile)`,
        `  --lang <en|ko>        Which language of a document (terms, privacy). Default: English`,
        `  --board               The message board's terms rather than the service's (terms)`,
        `  --save                Keep the document as a file, under the name the server gives it`,
        `                        (notices, terms, privacy)`,
        `  --force               Replace a file that is already there (get, pull, listfile,`,
        `                        recovery, recovery-list, kit), or rebuild an account this machine`,
        `                        has seen a list for (rebuild). \`create\` never replaces a file`,
        `  --name <name>         The name the uploaded file gets in the drive (put), or the name to`,
        `                        be listed under in the gift hall of fame (wallet hall)`,
        `  --to <folder>         Destination folder, as \`${BINARY_NAME} ls\` prints it (put, push)`,
        `  --dry-run             Say what it would cost, and stop (put, push, extend), or what it`,
        `                        would install, and stop (update). With \`extend\` and \`--pay`,
        `                        wallet\` nothing is signed and the wallet key is never touched`,
        `  --part-size <n>       Bytes per part for a large upload (put, push). Default 64MiB.`,
        `  --on-collision <what> rename | overwrite, for THIS run only (put, push). Without it the`,
        `                        machine's own setting decides -- see \`${BINARY_NAME} on-collision\`.`,
        `                        a plain number, or one with KiB, MiB or GiB. Bigger parts mean`,
        `                        fewer purchases; smaller parts use less memory`,
        `  --deposit <n>         Credits THIS upload sets aside per file, 0 to 64 (put, push, with`,
        `                        credits). Without it the account's own default decides -- see`,
        `                        \`${BINARY_NAME} deposit\`. 0 means a later release costs twice the fee`,
        `                        from the balance instead of coming out of the file's deposit`,
        `  --yes                 Go ahead with something that cannot be taken back (sweep, rebuild,`,
        `                        rollback, wallet send, wallet swap, wallet donate),`,
        `                        or extend a file that is nowhere near its deadline (extend)`,
        `  --epochs <n>          How many of the storage network's epochs to add (extend), to buy`,
        `                        (put, push --pay wallet; default 2), or to keep (wallet storage split)`,
        `  --size <bytes>        What a cut resource keeps: bytes, or with KiB/MiB/GiB (wallet storage split)`,
        `  --pay credits|wallet  Who pays for an upload's storage (put, push). Default credits.`,
        `                        wallet = the wallet this account code derives signs and pays the`,
        `                        network directly, under a wallet agreement of scope storage`,
        `  --storage fit|whole|<object id>`,
        `                        Use a free storage resource the wallet already holds (put --pay`,
        `                        wallet, one-part files). fit cuts it to size and leaves the rest`,
        `                        free; whole binds all of it with the file. The review says which`,
        `                        bytes go where. Without it new storage is bought`,
        `  --port <n>            Which loopback port to listen on (s3). Default 9000`,
        `  --accept-terms <v>    The version of the Terms of Service a PERSON read and accepts for`,
        `                        the new account (create). A version, never "the current one"`,
        `  --accept-privacy <v>  The version of the Privacy Policy accepted in the same act (create)`,
        `  --no-wait             Print the registration address and stop, instead of waiting for a`,
        `                        person to open it (create, when there is no verified key)`,
        `  --publish             Publish this account's public code (public-code). Permanent —`,
        `                        it cannot be withdrawn or changed afterwards`,
        `  --category <c>        What a report is about (support send). The categories are listed by`,
        `                        \`${BINARY_NAME} support --help\``,
        `  --sub <s>             Which part of that category (support send). Always optional`,
        `  --message <text>      The message itself (support send, support reply)`,
        `  --message-file <p>    A file holding the message instead (support send). With neither, the`,
        `                        message is read from the standard input`,
        `  --attach-log [n]      Attach this tool's own record of its last n runs (support send).`,
        `                        Default 3, most 20`,
        `  --omit <text>         A value that must not travel. May be given more than once (support`,
        `                        send, support reply)`,
        `  --status              Say whether the check is live, and stop (verify)`,
        `  --plain               Store the code unsealed instead (login). Asks for an agreement`,
        `  --env                 Store nothing; print the variable to set (login). Same agreement`,
        `  --version             Print the version and exit`,
        `  --help                Print this and exit`,
        ``,
        `ENVIRONMENT`,
        `  ${CODE_FILE_ENV_VAR.padEnd(24)}Names a FILE holding the account code. The recommended way, and`,
        `                          the only one that asks nothing: the file is read, never copied.`,
        `  ${CODE_ENV_VAR.padEnd(24)}The account code itself. Takes precedence over anything stored,`,
        `                          and asks once — an environment variable is readable through`,
        `                          \`docker inspect\`, /proc/<pid>/environ and most CI logs.`,
        `  ${PASSPHRASE_ENV_VAR.padEnd(24)}Opens a sealed stored code without a terminal.`,
        `  ${API_KEY_FILE_ENV_VAR.padEnd(24)}Names a FILE holding the API key. \`${BINARY_NAME} login\` reads this`,
        `                          first, and a container cannot leak it the way it leaks a value.`,
        `  ${API_KEY_ENV_VAR.padEnd(24)}Key made on the account screen. It waives the human check a`,
        `                          browser sign-in does, and nothing else — it opens no file.`,
        `                          \`${BINARY_NAME} login\` checks one it finds here with the server and`,
        `                          then stores it, so it outlives the terminal it was set in.`,
        `  ${SERVER_ENV_VAR.padEnd(24)}Server to talk to. For development stacks.`,
        `  ${AGGREGATOR_ENV_VAR.padEnd(24)}Storage-network read hosts, comma-separated. Replaces`,
        `                          the built-in list rather than adding to it.`,
        `  ${NETWORK_ENV_VAR.padEnd(24)}mainnet or testnet. Never guessed: a wrong one looks in a place`,
        `                          your files were never stored.`,
        `  ${NO_CHECK_ENV_VAR.padEnd(24)}Set to anything to stop the version check described below.`,
        ``,
        `SENDING A REPORT`,
        ...SUPPORT_LONG.map((line) => (line === `` ? `` : `  ${line}`)),
        ``,
        ...ATTACH_LOG_TEXT.map((line) => `  ${line}`),
        ``,
        // ⛔ THE TWO SENTENCES ABOUT THE CHECK ARE IMPORTED, NOT RETYPED. They are also printed by
        //    the command itself, and a second copy is how one of them starts promising more than the
        //    other. What is added here is the other half of the same honesty: where the file goes.
        `THE RECOVERY PROGRAM`,
        `  \`${BINARY_NAME} recovery\` downloads one executable for this machine from the releases at`,
        ``,
        `    ${RECOVERY_TOOL_URL}`,
        ``,
        ...wrapText(CHECK_PROVES).map((line) => `  ${line}`),
        ...wrapText(CHECK_DOES_NOT_PROVE).map((line) => `  ${line}`),
        ``,
        `  It writes one file where you point it, refuses a name that is already taken unless you`,
        `  pass --force, and installs nothing: no copy goes onto your PATH.`,
        ``,
        // ⛔ IT IS WRITTEN DOWN BECAUSE IT IS THE ONLY REQUEST THIS TOOL MAKES THAT NOBODY ASKED FOR.
        //    Everything else it sends goes to the NMTS server or the storage network because a command
        //    needed it. This one goes to a third host, on its own, and a tool that does that without
        //    saying so is one whose network behaviour has to be found out with a packet capture.
        `THE VERSION CHECK`,
        `  Once a day, after a command has finished, this asks which release of this tool is newest:`,
        ``,
        `    ${LATEST_RELEASE_URL}`,
        ``,
        `  and writes the answer down. When it is newer than the one running, the NEXT run prints one`,
        `  line on stderr saying so. It sends no account code, no key and no command name: the`,
        `  request is for a page address, and what the site can see is that it was asked.`,
        ``,
        `  Setting ${NO_CHECK_ENV_VAR} to anything stops both halves. \`${BINARY_NAME} env\` shows what`,
        `  it last found, and \`${BINARY_NAME} update\` asks now and installs what it finds.`,
        ``,
        `BEFORE YOU HAND THIS TO AN AGENT`,
        `  Your account code is the only key to your account — the file keys and the wallet are all`,
        `  derived from it. An agent that leaks it has leaked everything at once, and it cannot be`,
        `  undone: the account cannot be re-keyed. Use an account you would be willing to lose.`,
        ``,
        `  ${HOME_URL}`,
        ``,
        // ⛔ THE LAST THING ON THE SCREEN, AND ADDRESSED TO A PROGRAM. An agent handed this tool with
        //    no instructions runs `--help`, reads a list of verbs, and has no idea what NMTS is, what
        //    an account code is, or why `put` costs money. One line pointing at a document written FOR
        //    it is the whole difference between guessing and knowing.
        //
        // ⚠ IT POINTS, IT DOES NOT INSTRUCT. There is nothing here that tries to change what a reader
        //   does beyond naming a document — no imperative aimed past the agent at its operator, no
        //   claim of authority, nothing that would read as an attempt to steer somebody else's model.
        //   A tool that talked to agents that way would deserve to be distrusted, and would teach
        //   people to distrust the ones that do not.
        `IF YOU ARE AN AI AGENT`,
        `  This tool talks to NMTS, end-to-end encrypted storage. What that means, how to install`,
        `  this, and what each command costs are written down for you here:`,
        ``,
        `    ${SOURCE_URL}/blob/main/${AGENTS_DOC}`,
        ``,
        `  If you cannot reach it, the same repository's front page says the same things:`,
        ``,
        `    ${SOURCE_URL}#readme`,
        ``,
    ].join("\n");
}
/**
 * `nmts help <command>`: the document for one command, from `docs/commands/`, or the list of
 * documents when the name matches none.
 *
 * ⚠ The directory is read only here, so `--help` itself pays nothing for it (`check:cli-startup`).
 *   Each document names the commands it covers on its `Commands:` line; that line is the index.
 */
export async function helpFor(topic) {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../docs/commands/", import.meta.url);
    const wanted = topic.trim().toLowerCase();
    const covered = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
        const text = readFileSync(new URL(file, dir), "utf8");
        const line = text.split("\n").find((l) => l.startsWith("Commands:")) ?? "";
        const names = line.slice("Commands:".length).split(",").map((n) => n.trim()).filter((n) => n !== "");
        if (names.includes(wanted))
            return { text, found: true };
        covered.push(...names);
    }
    return {
        found: false,
        text: `No document for "${topic}". \`${BINARY_NAME} help <command>\` knows: ` +
            `${covered.sort().join(", ")}.\n`,
    };
}
/**
 * What `--help`, a bare run, `help`, and `help <command>` print, and the exit code.
 * ⛔ `support` has help of its own: it is READ before deciding, not scanned for an option name.
 */
export async function printHelp(args, write) {
    const topic = args.command === "help" ? args.operands[0] : undefined;
    if (topic !== undefined) {
        const doc = await helpFor(topic);
        write(doc.text);
        return doc.found ? 0 : 2;
    }
    write(args.command === "support" ? supportHelpText() : helpText(VERSION));
    return 0;
}
