import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayOptions } from "./contract.ts";
export declare function handle(req: IncomingMessage, res: ServerResponse, options: GatewayOptions): Promise<void>;
