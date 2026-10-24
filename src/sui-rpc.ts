// The chain client: which Sui node a command talks to, over what, and what happens when it does not
// answer.
//
// ⛔ WHY THIS IS ITS OWN FILE AND NOT PART OF walrus.ts. `walrus.ts` holds the host tables, and it
//    is loaded by EVERY invocation including `nmts --help`. Importing the Sui SDK there pulled 150
//    modules into a command that prints text and exits — `deploy/check-cli-startup.mjs` measured it
//    and failed the build, which is exactly what that gate is for. The SDK is imported here, and
//    only the commands that actually reach the chain import this.
//
// ⛔ gRPC-WEB, SINCE 2026-10-21. Sui removed JSON-RPC from its node software in October 2026, and every
//    host this tool used to ask answered only JSON-RPC. The SDK's `SuiGrpcClient` speaks gRPC-web over
//    `fetch`, so the failover below wraps the same `fetch` it always did — the path
//    (`/sui.rpc.v2.<Service>/<Method>`) is kept and only the host changes.
//
// ⛔ NOT A RETRIER. Each host is asked once. Anything other than "no answer" — any 4xx that is not
//    429, and every gRPC status the node sends back — is an answer, and asking a different node the
//    same question gets the same one.
import { SuiGrpcClient } from "@mysten/sui/grpc";

import { reachFetch } from "./reach.ts";
import { graphqlHistory, SUI_GRAPHQL_URLS, type DeeperHistory } from "./shared/lib/wallet/address-history.ts";
import { SUI_RPC_HOSTS, suiRpcHosts } from "./walrus.ts";

/** HTTP statuses that mean "no answer came", the only ones worth asking a second node about. */
function worthAnotherHost(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * A `fetch` that asks the network's hosts in order.
 *
 * ⭐ 2026-09-01. There used to be one host per network, and on that morning the testnet one was
 * measured dead for eleven days — every command that needed the chain on testnet had simply stopped.
 *
 * ⚠ THE LAST HOST'S 5xx/429 IS THROWN, with its number in the sentence (2026-10-21). The gRPC-web
 *   transport turns a returned 500 or 502 into a bare `UNKNOWN`, and then "the server failed" and
 *   "the node said no" look the same to whoever decides whether to wait and ask again.
 */
function failoverFetch(hosts: readonly string[]): typeof fetch {
  let preferred = 0;
  return async (input, init) => {
    const asked = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    let lastError: unknown = null;
    for (let step = 0; step < hosts.length; step += 1) {
      const index = (preferred + step) % hosts.length;
      const host = hosts[index];
      if (host === undefined) continue;
      try {
        const res = await reachFetch(new URL(asked.pathname + asked.search, host), init);
        if (worthAnotherHost(res.status)) {
          lastError = new Error(`${host} → HTTP ${res.status}`);
          continue;
        }
        preferred = index;
        return res;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`no Sui node answered (${hosts.length} tried)`);
  };
}

/**
 * A Sui client for `network` that asks the network's hosts in order.
 *
 * ⚠ One failover per client on purpose: the host that answered becomes the one asked first, and
 *   sharing that state across clients would let one command's bad luck redirect every other. The
 *   flip side is that a recovered first host is not noticed until the process restarts — that is
 *   the price of not probing a node nobody asked us to talk to.
 *
 * `format: "binary"` — protobuf bytes as they are; every host in the tables answers binary
 * (measured 2026-10-21), and the default text form base64s every message.
 */
export function suiClient(network: "testnet" | "mainnet"): SuiGrpcClient {
  const hosts = suiRpcHosts(network);
  return new SuiGrpcClient({
    network,
    baseUrl: hosts[0] ?? "",
    format: "binary",
    fetch: failoverFetch(hosts),
  });
}

/**
 * Where a wallet's history OLDER than a gRPC node's few-week window is read — Sui's GraphQL service
 * (`shared/lib/wallet/address-history.ts` holds why and the measurements) — or `null` when this run
 * named its own Sui node: somebody who names a node is saying *that one*, and quietly asking a public
 * service as well would send their addresses somewhere they did not choose. The history answer then
 * says it is partial instead.
 */
export function deeperHistory(network: "testnet" | "mainnet"): DeeperHistory | null {
  const named = suiRpcHosts(network).join(" ") !== (SUI_RPC_HOSTS[network] ?? []).join(" ");
  return named ? null : graphqlHistory(SUI_GRAPHQL_URLS[network], (input, init) => reachFetch(input, init));
}
