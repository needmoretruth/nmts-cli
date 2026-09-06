export interface ParsedArgs {
    command: string | null;
    /** Positional arguments after the command. */
    operands: string[];
    server?: string;
    network?: string;
    help: boolean;
    version: boolean;
    /** Machine-readable output where a command has one. */
    json: boolean;
    /** Include what is in the trash. */
    all: boolean;
    /** Where to write a fetched file. */
    out?: string;
    /** Replace a file that is already there. */
    force: boolean;
    /** The name an uploaded file gets in the drive. */
    name?: string;
    /** The destination folder for an upload. */
    to?: string;
    /** Say what an upload would cost and stop. */
    dryRun: boolean;
    /** `put`: how much of a file goes into one part. A byte count, optionally with a unit. */
    partSize?: string;
    /** `put`/`push`: what THIS run does about a name already in use. Absent = this machine's setting. */
    onCollision?: string;
    /** `put`/`push`: credits THIS upload sets aside per file, 0 to 64. Absent = the account's default. */
    deposit?: string;
    /** Answer yes to a warning this run would otherwise stop on. */
    yes: boolean;
    /** `public-code`: publish this account's public code on the server. Permanent. */
    publish: boolean;
    /** `login`: store the account code unsealed rather than under a passphrase. */
    plain: boolean;
    /** `login`: store nothing; print the environment variable to set. */
    env: boolean;
    /** `verify`: report whether the human check is live and stop, asking for no new code. */
    status: boolean;
    /** `create`: print the registration address and stop, rather than waiting for a person. */
    noWait?: boolean;
    /** `ls`: keep only files whose name contains this text, case-insensitively. */
    find?: string;
    /** `ls`: which order to list in — `name`, `size` or `date`. Absent = the path order. */
    sort?: string;
    /** `ls`: reverse whichever order is in effect. */
    desc: boolean;
    /** `push`: include entries whose name begins with a dot. */
    hidden: boolean;
    /** `extend`: how many of the storage network's epochs to add; `put`/`push --pay wallet`: how many to buy. */
    epochs?: string;
    /** `put`/`push`: who pays for the storage — `credits` (the default) or `wallet`. */
    pay?: string;
    /** `put --pay wallet`: `fit`, `whole`, or a held storage resource's object id. */
    storage?: string;
    /** `consent grant wallet`: how long the grant lasts (days, at most 30), or until a date.
     *  `key new`: how many days the new API key lasts. The server clamps at its own ceiling. */
    days?: string;
    until?: string;
    /** `consent grant wallet`: `storage` or `all`. */
    scope?: string;
    /** `key new`: which permissions the key carries — `read`, `write`, `spend`, comma-separated. */
    scopes?: string;
    /** `consent grant wallet`: ceilings in coins. */
    capWal?: string;
    capSui?: string;
    /** `wallet send` · `wallet swap`: a ceiling on the chain fee, in SUI. */
    feeCap?: string;
    /** `wallet swap`: which venue, deepbook or bluefin. Without it both are quoted and the run stops. */
    venue?: string;
    /** `wallet swap`: the slippage allowance in whole bps (1 bps = 0.01%). */
    slippageBps?: string;
    /** `wallet swap`: a person's say past the extremes gate. Refused while a mode is on. */
    acceptExtremes: boolean;
    /** `s3`: which loopback port the gateway listens on. */
    port?: string;
    /**
     * `create`: the version of the Terms of Service a PERSON read and accepts for the new account.
     *
     * ⛔ IT IS A VALUE AND NOT A FLAG, so that what was accepted is on the command line rather than
     *    implied by it. A tool that could accept "whatever is current" would be agreeing on behalf
     *    of somebody who never saw a version number.
     */
    acceptTerms?: string;
    /** `create`: the version of the Privacy Policy accepted in the same act. */
    acceptPrivacy?: string;
    /** `losses`: ask the chain about ONE listed storage object now, instead of listing. */
    recheck?: string;
    /** `losses`: take ONE line off this account's own drive, instead of listing. ⛔ A VALUE AND NOT
     *  A FLAG, so the line put down is named on the command line: a person reads one and puts it down. */
    dismiss?: string;
    /** `shares`: who ONE file was shared with, instead of what was shared with this account. */
    sent?: string;
    /** ultra-high acts under skip-permissions: why this is right to do now. Kept in the run log. */
    reason?: string;
    releaseStorage: boolean;
    size?: string;
    /** `devices`: sign ONE device out by id, or `all` — a person's act, proved by the account code. */
    signOut?: string;
    /**
     * `label`: the label to rename. The NEW name follows as the operand.
     *
     * ⛔ ONE VALUE, NOT TWO, because the table above gives every option exactly one — and a second
     *    spelling of "how many values does this take" is how an option ends up parsed one way and
     *    tested another. What a person types is still `label --rename <old> <new>`: the new name is
     *    read from the operands, which is where `label <name> <files>` already reads a name from.
     */
    rename?: string;
    /** `support send`: what the report is about, and optionally which part of that. */
    category?: string;
    sub?: string;
    /** `support`: the message itself, or the file holding it. */
    message?: string;
    messageFile?: string;
    /**
     * `support send`: attach the run log, and how many runs of it.
     * ⛔ THE EMPTY STRING IS "GIVEN WITH NO NUMBER", which is different from absent. A boolean
     *    beside a count would be two fields answering one question, and the pair can disagree.
     */
    attachLog?: string;
    /**
     * `support`: values that must not travel, replaced wherever they appear.
     *
     * ⛔ THE ONLY REPEATABLE OPTION, and it is repeatable because what it names is one value at a
     *    time. A comma-separated list would make a comma impossible to omit.
     */
    omit?: string[];
    /**
     * `whoami`: print the account code itself.
     *
     * ⛔ A FLAG AND NOT A VALUE — it names no secret, it asks for the one this machine already
     *    holds. The option table is checked for names that look like credentials; this one carries
     *    nothing and says what it does.
     */
    reveal: boolean;
    /**
     * `key new`: put the new key on the screen once, as well as storing it. A flag and not a value
     * for the reason above: it names no secret, it asks for the one this run was just handed.
     */
    print: boolean;
    /** `nmts wallet address --qr` — the address as a QR code in the terminal as well. */
    qr: boolean;
    /** `wallet hall --remove`: be listed by a shortened address again. Never with `--name`. */
    remove: boolean;
    /** `terms`/`privacy`: which language to fetch — `en` or `ko`. Absent = English. */
    lang?: string;
    /** `terms`: the message board's terms rather than the service's. */
    board: boolean;
    /**
     * `notices`/`terms`/`privacy`: keep the document as a file instead of printing it.
     *
     * ⛔ A FLAG, AND THE NOTICE'S ID IS STILL THE OPERAND. `notices --save <id>` reads exactly like
     *    `notices <id>`, which is the point: one way to name a notice, whichever of the two things
     *    is being done with it. The file's NAME is never an option — it is the server's, so that a
     *    copy kept here and a copy kept from the browser are the same file.
     */
    save: boolean;
}
export declare const OPTIONS_TAKING_A_VALUE: string[];
export declare const FLAGS: string[];
export declare function parseArgs(argv: readonly string[]): ParsedArgs;
