import { createHmac } from "node:crypto";
import { decrypt } from "./crypto";
import { pool, type DB } from "./db";
import { HttpError } from "./auth";
import { messagePermission } from "@/lib/domain";
import type { Contact } from "@/lib/types";
export const graphVersion = () => process.env.FACEBOOK_GRAPH_VERSION || "v27.0";
export async function graph<T = Record<string, unknown>>(
  path: string,
  token: string,
  params: Record<string, string> = {},
  method = "GET",
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  const body = new URLSearchParams({
    ...params,
    appsecret_proof: createHmac("sha256", process.env.FACEBOOK_APP_SECRET!)
      .update(token)
      .digest("hex"),
  });
  if (method === "GET") for (const [k, v] of body) url.searchParams.set(k, v);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method !== "GET"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: method !== "GET" ? body : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const json = await response.json();
  if (!response.ok || json.error)
    throw new HttpError(
      502,
      `Facebook request failed (code ${json.error?.code || response.status}). Check app permissions and the connected account.`,
    );
  return json;
}
export async function graphPages<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const result: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < 200; i++) {
    const data = await graph<{
      data: T[];
      paging?: { next?: string; cursors?: { after?: string } };
    }>(path, token, { ...params, limit: "100", ...(after ? { after } : {}) });
    result.push(...data.data);
    if (!data.paging?.next) return result;
    after = data.paging.cursors?.after;
    if (!after)
      throw new HttpError(502, "Facebook pagination could not be completed.");
  }
  throw new HttpError(
    502,
    "Facebook returned too many pages; narrow the sync range.",
  );
}
export async function sendMessage(
  db: DB,
  tenantId: string,
  contact: Contact,
  text: string,
  sender: "bot" | "agent",
  media?: { url: string; type: string },
  handoffNotice = false,
) {
  const current = (
    await pool.query<Contact>(
      "select * from mori_contacts where tenant_id=$1 and id=$2",
      [tenantId, contact.id],
    )
  ).rows[0];
  if (!current) throw new HttpError(404, "Contact not found.");
  // Read consent and messaging timestamps again immediately before every external send.
  contact = current;
  if (sender === "bot") {
    const tenant = (
      await pool.query("select bot_enabled from mori_tenants where id=$1", [
        tenantId,
      ])
    ).rows[0];
    if (
      !tenant?.bot_enabled ||
      contact.bot_state === "stopped" ||
      (contact.bot_state === "human" && !handoffNotice)
    )
      throw new HttpError(
        409,
        "The assistant is paused for this conversation.",
      );
  }
  const permission = messagePermission(
    contact,
    sender,
    Date.now(),
    process.env.FACEBOOK_AD_WINDOW_ENABLED === "true",
  );
  if (!permission.allowed) throw new HttpError(409, permission.reason);
  if (!contact.page_id || !contact.external_id)
    throw new HttpError(
      409,
      "This contact has no connected Messenger identity.",
    );
  const { rows } = await pool.query(
    "select token_encrypted from mori_resources where tenant_id=$1 and id=$2 and type='page' and status='connected'",
    [tenantId, contact.page_id],
  );
  if (!rows[0]) throw new HttpError(409, "Connect the Facebook Page first.");
  // Each delivery is recorded before the external send. Ambiguous failures are never auto-retried.
  const { rows: pending } = await pool.query(
    "insert into mori_messages (tenant_id,contact_id,direction,sender,text,media_url,media_type,status) values ($1,$2,'outbound',$3,$4,$5,$6,'sending') returning id",
    [
      tenantId,
      contact.id,
      sender,
      text,
      media?.url || null,
      media?.type || null,
    ],
  );
  const message = media
    ? {
        attachment: {
          type: media.type,
          payload: { url: media.url, is_reusable: true },
        },
      }
    : { text };
  try {
    const result = await graph<{ message_id: string }>(
      `${contact.page_id}/messages`,
      decrypt(rows[0].token_encrypted),
      {
        recipient: JSON.stringify({ id: contact.external_id }),
        message: JSON.stringify(message),
        messaging_type: permission.tag ? "MESSAGE_TAG" : "RESPONSE",
        ...(permission.tag ? { tag: permission.tag } : {}),
      },
      "POST",
    );
    await pool.query(
      "update mori_messages set status='sent',external_id=$1 where id=$2 and tenant_id=$3",
      [result.message_id, pending[0].id, tenantId],
    );
    return result;
  } catch (error) {
    await pool.query(
      "update mori_messages set status=$3 where id=$1 and tenant_id=$2",
      [
        pending[0].id,
        tenantId,
        error instanceof HttpError ? "failed" : "needs_review",
      ],
    );
    if (!(error instanceof HttpError))
      throw new HttpError(
        502,
        "Delivery could not be confirmed. Inspect the conversation before sending again.",
      );
    throw error;
  }
}
