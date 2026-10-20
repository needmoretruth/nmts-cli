// The one door to a Walrus build that depends on a price or on the package address.
//
// ⛔ WHY (2026-10-20 · Walrus mainnet). `@mysten/walrus` keeps the system object and state
//    — the storage and write prices, the package id — in each client until `reset()`. A transaction
//    priced from that cache splits the old amount, the contract charges the new one, and
//    `balance::destroy_zero` (price fell) or `balance::split` (price rose) aborts; the server's
//    chain service lost every treasury-paid upload for a week that way. This tool builds a client
//    per command and per signature, so today the reset finds nothing to clear and costs nothing —
//    it is here so that a client kept longer (an MCP session, a held review) still pays today's
//    price. `deploy/check-fresh-walrus.mjs` refuses a builder called any other way.
/** The client's Walrus namespace with its caches cleared, so what follows reads the chain. */
export function freshWalrus(client) {
    client.walrus.reset();
    return client.walrus;
}
