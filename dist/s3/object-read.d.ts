import { type Call } from "./call.ts";
import { type DriveObject } from "./listing.ts";
/**
 * The headers a file is answered with.
 *
 * ⛔ A FILE IS NEVER A PAGE OF THE GATEWAY'S ORIGIN. A business serves its users' files from its own
 *    host, often through presigned links a browser opens, and a file named `.html` or `.svg` is
 *    answered with a type a browser runs. `Content-Security-Policy: sandbox` makes whatever it runs
 *    run in an origin of its own, with no scripts and no reach into the host's cookies or storage;
 *    `nosniff` keeps a browser from deciding that a file sent as bytes or text is script after all.
 *    A business that wants its users' files downloaded rather than shown says so per link, with
 *    `response-content-disposition` (below).
 */
export declare function objectHeaders(object: DriveObject): Record<string, string>;
/** The live file at this call's key, or a 404 already answered. */
export declare function objectAt(call: Call): Promise<DriveObject | null>;
export declare function readObject(call: Call, head: boolean): Promise<void>;
