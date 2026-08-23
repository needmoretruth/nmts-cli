// The product's own names, in one place.
//
// WHY A MODULE FOR THREE STRINGS. The name reached the code before it was settled — first
// "NMTS for Agent", then "NMTS for Agents", and finally `nmts-cli` with the tool itself just
// called `nmts` (owner, 2026-08-23). A name spelled out at twelve call sites is a name that
// ends up spelled three ways.
//
// ⛔ "for agents" is NOT part of the name. It says who this is for, which belongs in the README
//    and the package description where it can change without renaming anything.

/** What a person reads, and what the tool calls itself. Owner-settled 2026-08-23. */
export const PRODUCT_NAME = "nmts";

/** What an agent types. The same word: there is nothing to translate between the two. */
export const BINARY_NAME = "nmts";

/** Where the product lives, for messages that need to send somebody somewhere real. */
export const HOME_URL = "https://nmts.me";

/** The source, for the notices the AGPL asks a program to be able to print. */
export const SOURCE_URL = "https://github.com/needmoretruth/nmts-cli";

/** Who holds the copyright. One place, because it is also the answer to "who can license this". */
export const COPYRIGHT = "Copyright (C) 2026 needmoretruth";
