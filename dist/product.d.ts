/** What a person reads, and what the tool calls itself. Owner-settled 2026-08-23. */
export declare const PRODUCT_NAME = "nmts";
/** What an agent types. The same word: there is nothing to translate between the two. */
export declare const BINARY_NAME = "nmts";
/**
 * This build's version.
 *
 * ⛔ Kept here rather than read from `package.json`: the published build has no package.json
 *    beside it. Here rather than in `main.ts` because the MCP server has to say it too, and a
 *    command importing the entry point is a cycle waiting to bite.
 */
export declare const VERSION = "0.28.0";
/** Where the product lives, for messages that need to send somebody somewhere real. */
export declare const HOME_URL = "https://nmts.me";
/** The source, so a person holding only the built program can find what it was built from. */
export declare const SOURCE_URL = "https://github.com/needmoretruth/nmts-cli";
/** Who holds the copyright. One place, because it is also the answer to "who can license this". */
export declare const COPYRIGHT = "Copyright 2026 needmoretruth";
/**
 * Where to write about a fault, a confusing message, or anything that got in the way.
 *
 * ⛔ IT IS IN THE TOOL AND NOT ONLY IN THE README, because the moment somebody wants to report
 *    something is the moment it went wrong -- and that is exactly when nobody goes looking for a
 *    web page. The smallest annoyance is worth an email; most of them are cheap to fix and
 *    invisible from here.
 */
export declare const SUPPORT_EMAIL = "nmts@nmts.me";
/** The document in the source repository that is written for an agent rather than for a person. */
export declare const AGENTS_DOC = "AGENTS.md";
