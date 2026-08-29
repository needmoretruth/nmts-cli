// Move one item into the trash on the server, or bring it back.
//
// ⛔ 404 IS "ALREADY IN THE STATE YOU ASKED FOR", which is what a half-finished run leaves behind.
//    Treating it as a failure would make the retry of an interrupted command impossible -- the one
//    moment the retry is needed.
//
// ⛔ AND THIS IS AS FAR AS AN API KEY REACHES. `POST /v1/items/erase` -- the one that destroys a
//    row for good -- is closed to keys and stays closed (`api` domain/agent_routes.rs, Reach::Never:
//    "PERMANENT destruction. The soft delete is reachable because it is recoverable; this is the
//    line where that stops."). Anything in this tool that says a file is gone forever is wrong.
import { request, ServerError } from "./api.js";
export async function setTrashed(base, apiKey, id, trashed) {
    const held = encodeURIComponent(id);
    try {
        if (trashed)
            await request(base, `/v1/items/${held}`, { method: "DELETE", token: apiKey });
        else
            await request(base, `/v1/items/${held}/restore`, { method: "POST", token: apiKey, body: {} });
    }
    catch (error) {
        if (error instanceof ServerError && error.status === 404)
            return;
        throw error;
    }
}
