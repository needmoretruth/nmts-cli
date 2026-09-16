// The shapes the signing module is reached through — one per thing this tool can sign.
//
// ⛔ THEY ARE SEAMS BECAUSE A TEST MUST BE ABLE TO PROVE THAT NOTHING SIGNED. Every command that
//    spends prints a review first and stops there without `--yes`; handing it a function that
//    fails the test if it is ever called is the only way to hold that promise, and a signature
//    that reached a chain in a test would cost money every time the suite ran.
//
// ⛔ EACH ONE CARRIES **WHICH WALLET** WHERE THE MONEY COMES FROM IT (2026-09-16). One
//    NMTS key opens a wallet at every index and the account says which one pays (`activeWallet`
//    in the sealed file list); the command resolves that number BEFORE it prices anything, so the
//    address in the review is the address that signs. A seam that let the number be omitted would
//    let a review be printed for one wallet and a transaction signed by another.
//
// ⚠ They moved out of `wallet-sign.ts` on 2026-09-16 — that file is what signs, and it has a
//   ceiling. Re-exported from there, so no caller spells a new path.
export {};
