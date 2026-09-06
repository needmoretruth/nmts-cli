import { type ShareOptions } from "./share.ts";
/**
 * `nmts shares --sent <path>` — who ONE file was shared with.
 *
 * ⛔ IT IS THE OTHER DIRECTION OF `shares`, NOT A FILTER ON IT. The inbox answers "what can I
 *    download"; this answers "who can download this", which is the only question a person asking
 *    whether to withdraw a share is actually asking. The server keeps the two in different tables
 *    and gives them different routes, and joining them here would invent a view neither has.
 *
 * ⛔ THE ADDRESS IS PRINTED AS THE SERVER STORED IT. There is no name, no directory and nothing to
 *    look one up against — the recipient of a share is an address and nothing else — so a line
 *    that dressed it up as anything friendlier would be inventing an identity.
 *
 * ⚠ IT ONLY READS. Nothing here changes a share, and `unshare <id>` is what takes the id printed
 *   at the end of a line and withdraws it.
 */
export declare function sharesSent(target: string | undefined, options?: ShareOptions): Promise<number>;
/** `nmts unshare <id>` — withdraw a share you sent, or remove one you were sent. */
