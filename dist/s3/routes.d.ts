import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayOptions } from "./contract.ts";
export declare function fail(res: ServerResponse, status: number, code: string, message: string, resource: string): void;
export declare function handle(req: IncomingMessage, res: ServerResponse, options: GatewayOptions): Promise<void>;
