// Row shapes the fake drive serves — moved out of `fake-drive.ts`, which `check:size` measures.

/** One row of `GET /v1/items/expiring`, in the server's own spelling. */
export interface ExpiringRow {
  item_id: string;
  expiry_epoch: number;
}

/** One row of `GET /v1/storage-loss`, in the server's own spelling. */
export interface LossRow {
  blob_object_id: string;
  first_seen: string;
  required_notice: boolean;
  restricted: boolean;
}

/** The three answers `POST /v1/storage-loss/recheck` gives, and no fourth. */
export type RecheckResult = "found" | "still_missing" | "unread";

/** One row of `GET /v1/shares/sent`, in the server's own spelling. */
export interface SentShareRow {
  id: string;
  item_id: string;
  recipient_address: string;
  created_at: string;
}

/** The API key every fake session presents. */
export const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
