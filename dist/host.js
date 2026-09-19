// The five things this package cannot do by itself, in one register — so that everything else in
// it is code that runs anywhere a `fetch` does.
//
// ⛔ A REGISTER, NOT A BRANCH. Nothing below asks which runtime it is in. The entry point that a
//    program imports puts a host in here — `index.ts` registers the Node one, the SDK's `/browser`
//    entry registers a browser one — and every portable module afterwards asks for the one that is
//    there. A `typeof window === "undefined"` test in each of the modules instead would be the
//    same decision made twenty times, and the twenty-first is the one that gets it wrong on a
//    runtime nobody was thinking about.
//
// ⛔ FIVE, AND THEY ARE THE WHOLE LIST. Loading the engine, keeping state, reading the
//    environment, saying how far along something is, and having a zstd encoder: those are what a
//    browser cannot do the way Node does. Anything a sixth entry would be asked to carry is a sign
//    that a module is doing something it should be handed instead.
//
// ⛔ STATE IS ASYNCHRONOUS. A browser's store is a database with transactions and there is no
//    honest way to read one without waiting. Node's is a file and could have stayed synchronous;
//    making it look synchronous in a browser would take a worker and a shared buffer to fake, and
//    a fake that blocks the page is worse than the `await` it saves.
//
// ⛔ NO `node:` IMPORT MAY EVER APPEAR IN THIS FILE, or in anything it reaches. `portable.ts` is
//    the entry that promises it and `test/portable-closure.test.ts` is what holds the promise.
import { NmtsError } from "./errors.js";
let registered = null;
/**
 * Put the host for this runtime in the register.
 *
 * Called once, from the entry point a program imported, before anything else runs. Calling it
 * again replaces what is there, which is what a test that swaps a host needs and what nothing else
 * should do.
 */
export function registerHost(next) {
    registered = next;
}
/** Empty the register. For tests that need to see what an unhosted module does. */
export function forgetHost() {
    registered = null;
}
/** True when something has registered one. Lets a caller ask instead of catching. */
export function hostIsRegistered() {
    return registered !== null;
}
/**
 * The host for this runtime.
 *
 * ⛔ IT REFUSES RATHER THAN GUESSING. A program that imported `@needmoretruth/nmts-cli/portable`
 *    and registered nothing has one thing wrong with it, and naming that is worth more than a
 *    default host that half-works and fails somewhere further in.
 */
export function host() {
    if (registered === null) {
        throw new NmtsError("HOST_MISSING: no runtime host has been registered.", {
            exitCode: 1,
            nextStep: "Import `@needmoretruth/nmts-cli` (which registers the Node host) or the SDK's `/browser` " +
                "entry (which registers a browser one) before calling anything that keeps state.",
        });
    }
    return registered;
}
