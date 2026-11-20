import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import {
  api,
  apiError,
  getUser,
  withTenant,
  HttpError,
  adminSupabase,
  type Context,
} from "@/server/auth";
import { pool, transaction, audit } from "@/server/db";
import { DEFAULT_FIELDS, DEFAULT_FOLLOWUPS, moneyMinor } from "@/lib/domain";
import { extractKnowledge, embed, answerKnowledge } from "@/server/knowledge";
import { sendMessage } from "@/server/facebook";
import { planTouchpoints } from "@/server/bot";
import { autofillContact } from "@/server/autofill";
import { isJevConfigured, jevConfiguration } from "@/server/jev";
import type { Contact } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ path: string[] }> };
const uuid = z.uuid();
const mediaSchema = z.object({
  url: z.url().max(2000),
  type: z.enum(["image", "video", "audio", "file"]),
});
function validMedia(url: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "res.cloudinary.com" ||
    !parsed.pathname.startsWith(`/${process.env.CLOUDINARY_CLOUD_NAME}/`)
  )
    throw new HttpError(
      400,
      "Upload the attachment to your Cloudinary library first.",
    );
}
async function contactFor(ctx: Context, id: string): Promise<Contact> {
  const { rows } = await ctx.db.query(
    "select * from mori_contacts where tenant_id=$1 and id=$2",
    [ctx.tenant.id, uuid.parse(id)],
  );
  if (!rows[0])
    throw new HttpError(404, "Contact not found or not assigned to you.");
  return rows[0];
}
async function snapshot(ctx: Context) {
  const t = ctx.tenant.id;
  // The authenticated DB role applies RLS to every collection, including calendar totals.
  const queries = {
    contacts:
      "select * from mori_contacts where tenant_id=$1 order by first_inquiry_at desc",
    orders:
      "select * from mori_orders where tenant_id=$1 order by created_at desc",
    ads: "select * from mori_ads where tenant_id=$1 order by name",
    spend: "select * from mori_spend where tenant_id=$1 order by day",
    resources:
      "select id,name,type,status,currency,timezone from mori_resources where tenant_id=$1 order by name",
    members:
      "select m.user_id,m.name,m.email,m.role,coalesce(array_agg(a.resource_id) filter (where a.resource_id is not null),'{}') as assignments from mori_memberships m left join mori_assignments a on a.tenant_id=m.tenant_id and a.user_id=m.user_id where m.tenant_id=$1 group by m.user_id,m.name,m.email,m.role order by m.name",
    documents:
      "select * from mori_documents where tenant_id=$1 order by created_at desc",
    faqs: "select * from mori_faqs where tenant_id=$1 order by question",
    touchpoints:
      "select * from mori_touchpoints where tenant_id=$1 order by scheduled_at",
    messages: "select * from mori_messages where tenant_id=$1 order by sent_at",
    audit:
      "select id,action,details,created_at from mori_audit where tenant_id=$1 order by created_at desc limit 100",
  };
  const collections: Record<string, unknown[]> = {};
  // A transaction owns one connection; keep its queries sequential.
  for (const [key, sql] of Object.entries(queries))
    collections[key] = (await ctx.db.query(sql, [t])).rows;
  return {
    tenant: ctx.tenant,
    ...collections,
    integrations: {
      supabase: true,
      cloudinary: !!process.env.CLOUDINARY_API_SECRET,
      facebook: (collections.resources as { type: string }[]).some(
        (r) => r.type === "page",
      ),
      jev: isJevConfigured(),
      jev_provider: jevConfiguration().provider,
      jev_model: jevConfiguration().model,
      embeddings: !!process.env.EMBEDDING_API_KEY,
    },
  };
}

export async function GET(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return api(async () => {
    if (path[0] === "workspaces") {
      const user = await getUser(request);
      return transaction(
        async (db) =>
          (
            await db.query(
              "select t.id,t.name,m.role from mori_tenants t join mori_memberships m on m.tenant_id=t.id where m.user_id=$1 order by t.created_at",
              [user.id],
            )
          ).rows,
        user.id,
      );
    }
    if (path[0] === "snapshot") return withTenant(request, snapshot);
    throw new HttpError(404, "Endpoint not found.");
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { path } = await context.params;
  if (path[0] === "media") return uploadMedia(request);
  if (path[0] === "knowledge" && path[1] !== "search")
    return uploadKnowledge(request);
  return api(async () => {
    if (path[0] === "workspaces") {
      const user = await getUser(request);
      const body = z
        .object({ name: z.string().trim().min(2).max(100) })
        .parse(await request.json());
      return transaction(async (db) => {
        const id = randomUUID();
        await db.query(
          "insert into mori_tenants (id,name,intake_fields,followup_templates) values ($1,$2,$3,$4)",
          [
            id,
            body.name,
            JSON.stringify(DEFAULT_FIELDS),
            JSON.stringify(DEFAULT_FOLLOWUPS),
          ],
        );
        await db.query(
          "insert into mori_memberships (tenant_id,user_id,role,name,email) values ($1,$2,'head',$3,$4)",
          [
            id,
            user.id,
            user.user_metadata.full_name ||
              user.email?.split("@")[0] ||
              "Workspace owner",
            user.email,
          ],
        );
        return { id, name: body.name, role: "head" };
      });
    }
    if (path[0] === "contacts" && path[1] && path[2] === "autofill")
      return withTenant(request, async (ctx) => {
        if (!isJevConfigured())
          throw new HttpError(
            503,
            "Configure a Jev or OpenRouter API key to use autofill.",
          );
        const contact = await contactFor(ctx, path[1]);
        try {
          return await autofillContact(ctx.tenant, contact, {
            actorId: ctx.userId,
            manual: true,
            db: ctx.db,
          });
        } catch {
          throw new HttpError(
            502,
            "Jev could not complete autofill. Existing details were preserved. Check the AI connection and try again.",
          );
        }
      });
    if (path[0] === "contacts")
      return withTenant(request, async (ctx) => {
        const body = z
          .object({
            name: z.string().trim().min(1).max(150),
            email: z.email().or(z.literal("")).optional(),
            phone: z.string().max(40).optional(),
            page_id: z.string().max(100).nullable().optional(),
            notes: z.string().max(10000).optional(),
          })
          .parse(await request.json());
        if (ctx.role === "member" && !body.page_id)
          throw new HttpError(400, "Select an assigned Page for this contact.");
        if (body.page_id) {
          const { rows } = await ctx.db.query(
            "select id from mori_resources where tenant_id=$1 and id=$2 and type='page'",
            [ctx.tenant.id, body.page_id],
          );
          if (!rows[0]) throw new HttpError(400, "Select an accessible Page.");
        }
        const { rows } = await ctx.db.query(
          "insert into mori_contacts (tenant_id,name,email,phone,page_id,notes,assigned_to) values ($1,$2,$3,$4,$5,$6,$7) returning *",
          [
            ctx.tenant.id,
            body.name,
            body.email || null,
            body.phone || null,
            body.page_id || null,
            body.notes || "",
            ctx.userId,
          ],
        );
        await audit(ctx.db, ctx.tenant.id, ctx.userId, "contact.created", {
          contact_id: rows[0].id,
        });
        return rows[0];
      });
    if (path[0] === "orders")
      return withTenant(request, async (ctx) => {
        const body = z
          .object({
            contact_id: uuid,
            amount: z.coerce.number().positive().max(1e9),
            status: z.enum(["pending", "paid"]),
            notes: z.string().max(10000).default(""),
          })
          .parse(await request.json());
        await contactFor(ctx, body.contact_id);
        const { rows } = await ctx.db.query(
          "insert into mori_orders (tenant_id,contact_id,amount_minor,currency,status,notes,paid_at) values ($1,$2,$3,$4,$5,$6,$7) returning *",
          [
            ctx.tenant.id,
            body.contact_id,
            moneyMinor(body.amount),
            ctx.tenant.currency,
            body.status,
            body.notes,
            body.status === "paid" ? new Date() : null,
          ],
        );
        await recomputeContact(ctx, body.contact_id);
        await audit(ctx.db, ctx.tenant.id, ctx.userId, "order.created", {
          order_id: rows[0].id,
          amount_minor: rows[0].amount_minor,
        });
        return rows[0];
      });
    if (path[0] === "messages")
      return withTenant(request, async (ctx) => {
        const body = z
          .object({
            contact_id: uuid,
            text: z.string().trim().max(2000).default(""),
            media: mediaSchema.optional(),
            human_support: z.boolean().default(false),
          })
          .parse(await request.json());
        if (!body.text && !body.media)
          throw new HttpError(400, "Write a message or add an attachment.");
        if (body.media) validMedia(body.media.url);
        const contact = await contactFor(ctx, body.contact_id);
        const elapsed =
          Date.now() - Date.parse(contact.last_inbound_at || "1970-01-01");
        if (elapsed >= 86400000 && !body.human_support)
          throw new HttpError(
            400,
            "Confirm this is a manual support reply before using the Human Agent tag.",
          );
        if (body.text && body.media)
          throw new HttpError(
            400,
            "Send the text and attachment as separate messages.",
          );
        const result = await sendMessage(
          ctx.db,
          ctx.tenant.id,
          contact,
          body.text,
          "agent",
          body.media,
        );
        await ctx.db.query(
          "update mori_contacts set bot_state='human' where tenant_id=$1 and id=$2",
          [ctx.tenant.id, contact.id],
        );
        await audit(ctx.db, ctx.tenant.id, ctx.userId, "message.sent", {
          contact_id: contact.id,
        });
        return result;
      });
    if (path[0] === "knowledge" && path[1] === "search")
      return withTenant(request, async (ctx) => {
        const { question } = z
          .object({ question: z.string().trim().min(2).max(2000) })
          .parse(await request.json());
        return answerKnowledge(ctx.db, ctx.tenant.id, question);
      });
    if (path[0] === "faqs")
      return withTenant(
        request,
        async (ctx) => {
          const body = z
            .object({
              question: z.string().trim().min(3).max(1000),
              answer: z.string().trim().min(1).max(10000),
              media_url: z.url().nullable().optional(),
              media_type: z
                .enum(["image", "video", "audio", "file"])
                .nullable()
                .optional(),
            })
            .parse(await request.json());
          if (body.media_url) validMedia(body.media_url);
          const { rows } = await ctx.db.query(
            "insert into mori_faqs (tenant_id,question,answer,media_url,media_type) values ($1,$2,$3,$4,$5) returning *",
            [
              ctx.tenant.id,
              body.question,
              body.answer,
              body.media_url || null,
              body.media_type || null,
            ],
          );
          return rows[0];
        },
        ["head", "admin"],
      );
    if (path[0] === "touchpoints" && path[1] === "plan")
      return withTenant(request, async (ctx) => {
        const { contact_id } = z
          .object({ contact_id: uuid })
          .parse(await request.json());
        const contact = await contactFor(ctx, contact_id);
        // Planning uses the service connection only after RLS verified this contact.
        await planTouchpoints(pool, ctx.tenant, contact);
        return { ok: true };
      });
    if (path[0] === "members") return createMember(request);
    if (path[0] === "facebook" && path[1] === "sync")
      return withTenant(
        request,
        async (ctx) => {
          const { syncAds } = await import("@/server/sync");
          // Reads ad accounts accessible to this administrator; tokens remain server-side.
          return syncAds(ctx.tenant, ctx.userId);
        },
        ["head", "admin"],
      );
    throw new HttpError(404, "Endpoint not found.");
  });
}
async function recomputeContact(ctx: Context, contactId: string) {
  // A database trigger keeps conversion stage/timing correct for API and direct DB writes.
  await ctx.db.query(
    "select id from mori_contacts where tenant_id=$1 and id=$2",
    [ctx.tenant.id, contactId],
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return api(async () => {
    if (path[0] === "contacts" && path[1])
      return withTenant(request, async (ctx) => {
        const contact = await contactFor(ctx, path[1]);
        const body = z
          .object({
            name: z.string().trim().min(1).max(150).optional(),
            stage: z.enum(["qualified", "not_qualified"]).optional(),
            bot_state: z.enum(["intake", "faq", "human", "stopped"]).optional(),
            notes: z.string().max(20000).optional(),
            objections: z.array(z.string().max(500)).max(30).optional(),
            form_answers: z
              .record(z.string().max(100), z.string().max(2000))
              .optional(),
            timezone: z.string().max(100).nullable().optional(),
            opted_out: z.boolean().optional(),
            assigned_to: uuid.nullable().optional(),
          })
          .strict()
          .parse(await request.json());
        if (body.stage && contact.converted_at)
          throw new HttpError(
            409,
            "A contact with paid orders remains converted. Refund or cancel the orders first.",
          );
        if (body.timezone && !DateTime.now().setZone(body.timezone).isValid)
          throw new HttpError(400, "Enter a valid IANA timezone.");
        if (
          body.bot_state &&
          body.bot_state !== "stopped" &&
          contact.opted_out &&
          body.opted_out !== false
        )
          throw new HttpError(
            409,
            "Obtain renewed consent and clear the opt-out before resuming.",
          );
        const entries = Object.entries(body);
        if (!entries.length) return { ok: true };
        const sets = entries.map(([key], i) => `${key}=$${i + 3}`).join(",");
        await ctx.db.query(
          `update mori_contacts set ${sets} where tenant_id=$1 and id=$2`,
          [
            ctx.tenant.id,
            contact.id,
            ...entries.map(([key, v]) =>
              ["form_answers", "objections"].includes(key)
                ? JSON.stringify(v)
                : v,
            ),
          ],
        );
        if (
          body.bot_state === "stopped" ||
          body.bot_state === "human" ||
          body.opted_out
        )
          await ctx.db.query(
            "update mori_touchpoints set status='cancelled',reason='Stopped or handed to a human' where tenant_id=$1 and contact_id=$2 and status='scheduled'",
            [ctx.tenant.id, contact.id],
          );
        await audit(ctx.db, ctx.tenant.id, ctx.userId, "contact.updated", {
          contact_id: contact.id,
          fields: entries.map(([key]) => key),
        });
        return { ok: true };
      });
    if (path[0] === "orders" && path[1])
      return withTenant(request, async (ctx) => {
        const id = uuid.parse(path[1]);
        const body = z
          .object({
            status: z.enum(["pending", "paid", "cancelled", "refunded"]),
            notes: z.string().max(10000).optional(),
          })
          .parse(await request.json());
        const { rows } = await ctx.db.query(
          "update mori_orders set status=$3,paid_at=case when $3='paid' then coalesce(paid_at,now()) else paid_at end,notes=coalesce($4,notes) where tenant_id=$1 and id=$2 returning contact_id",
          [ctx.tenant.id, id, body.status, body.notes ?? null],
        );
        if (!rows[0]) throw new HttpError(404, "Order not found.");
        await recomputeContact(ctx, rows[0].contact_id);
        await audit(ctx.db, ctx.tenant.id, ctx.userId, "order.status_changed", {
          order_id: id,
          status: body.status,
        });
        return { ok: true };
      });
    if (path[0] === "settings")
      return withTenant(
        request,
        async (ctx) => {
          const field = z.object({
            key: z
              .string()
              .regex(/^[a-z][a-z0-9_]*$/)
              .max(50),
            label: z.string().trim().min(1).max(500),
            required: z.boolean(),
            type: z.enum(["text", "email", "phone", "number", "choice"]),
            options: z.array(z.string().min(1).max(200)).max(30).optional(),
            qualify: z.array(z.string().max(200)).max(30).optional(),
          });
          const body = z
            .object({
              name: z.string().trim().min(2).max(100).optional(),
              timezone: z.string().max(100).optional(),
              expense_percent: z.number().min(0).max(100).optional(),
              expense_threshold_minor: z
                .number()
                .int()
                .nonnegative()
                .max(1e11)
                .optional(),
              automation_enabled: z.boolean().optional(),
              bot_enabled: z.boolean().optional(),
              autofill_enabled: z.boolean().optional(),
              aov_spend_multiplier: z.number().min(0.5).max(10).optional(),
              intake_fields: z.array(field).min(1).max(20).optional(),
              followup_templates: z
                .array(z.string().trim().min(1).max(2000))
                .length(7)
                .optional(),
            })
            .strict()
            .parse(await request.json());
          if (body.timezone && !DateTime.now().setZone(body.timezone).isValid)
            throw new HttpError(400, "Enter a valid IANA timezone.");
          if (
            body.intake_fields &&
            new Set(body.intake_fields.map((f) => f.key)).size !==
              body.intake_fields.length
          )
            throw new HttpError(400, "Form field keys must be unique.");
          if (
            body.intake_fields?.some(
              (f) => f.type === "choice" && !f.options?.length,
            )
          )
            throw new HttpError(400, "Choice fields need at least one option.");
          const entries = Object.entries(body);
          if (!entries.length) return { ok: true };
          await ctx.db.query(
            `update mori_tenants set ${entries.map(([k], i) => `${k}=$${i + 2}`).join(",")} where id=$1`,
            [
              ctx.tenant.id,
              ...entries.map(([k, v]) =>
                ["intake_fields", "followup_templates"].includes(k)
                  ? JSON.stringify(v)
                  : v,
              ),
            ],
          );
          await audit(ctx.db, ctx.tenant.id, ctx.userId, "settings.updated", {
            fields: entries.map(([k]) => k),
          });
          return { ok: true };
        },
        ["head", "admin"],
      );
    if (path[0] === "ads" && path[1])
      return withTenant(
        request,
        async (ctx) => {
          const body = z
            .object({ automation_enabled: z.boolean() })
            .parse(await request.json());
          const result = await ctx.db.query(
            "update mori_ads set automation_enabled=$3 where tenant_id=$1 and id=$2 returning id",
            [ctx.tenant.id, path[1], body.automation_enabled],
          );
          if (!result.rows[0]) throw new HttpError(404, "Ad not found.");
          await audit(
            ctx.db,
            ctx.tenant.id,
            ctx.userId,
            "ad.automation_changed",
            { ad_id: path[1], enabled: body.automation_enabled },
          );
          return { ok: true };
        },
        ["head", "admin"],
      );
    if (path[0] === "members" && path[1]) return updateMember(request, path[1]);
    if (path[0] === "touchpoints" && path[1])
      return withTenant(request, async (ctx) => {
        const result = await ctx.db.query(
          "update mori_touchpoints set status='cancelled',reason='Cancelled by agent' where tenant_id=$1 and id=$2 and status in ('scheduled','needs_human','blocked') returning id",
          [ctx.tenant.id, uuid.parse(path[1])],
        );
        if (!result.rows[0])
          throw new HttpError(
            404,
            "Touchpoint not found or already completed.",
          );
        return { ok: true };
      });
    throw new HttpError(404, "Endpoint not found.");
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return api(() =>
    withTenant(
      request,
      async (ctx) => {
        if (!["faqs", "knowledge"].includes(path[0]) || !path[1])
          throw new HttpError(404, "Endpoint not found.");
        const table = path[0] === "faqs" ? "mori_faqs" : "mori_documents";
        await ctx.db.query(
          `delete from ${table} where tenant_id=$1 and id=$2`,
          [ctx.tenant.id, uuid.parse(path[1])],
        );
        await audit(ctx.db, ctx.tenant.id, ctx.userId, `${path[0]}.deleted`, {
          id: path[1],
        });
        return { ok: true };
      },
      ["head", "admin"],
    ),
  );
}

async function uploadKnowledge(request: Request) {
  return api(() =>
    withTenant(
      request,
      async (ctx) => {
        const data = await request.formData();
        const file = data.get("file");
        if (!(file instanceof File))
          throw new HttpError(400, "Choose a knowledge file.");
        const { rows } = await ctx.db.query(
          "insert into mori_documents (tenant_id,name) values ($1,$2) returning id",
          [ctx.tenant.id, file.name.slice(0, 250)],
        );
        const id = rows[0].id;
        try {
          const chunks = await extractKnowledge(file);
          for (let i = 0; i < chunks.length; i++) {
            const vector = await embed(chunks[i]);
            await ctx.db.query(
              "insert into mori_chunks (tenant_id,document_id,chunk_index,content,embedding) values ($1,$2,$3,$4,$5::extensions.vector)",
              [
                ctx.tenant.id,
                id,
                i,
                chunks[i],
                vector ? JSON.stringify(vector) : null,
              ],
            );
          }
          await ctx.db.query(
            "update mori_documents set status='ready',chunk_count=$3 where tenant_id=$1 and id=$2",
            [ctx.tenant.id, id, chunks.length],
          );
          return { id, status: "ready", chunk_count: chunks.length };
        } catch (error) {
          // Provider/extraction errors are safe summaries; SQL errors abort this transaction.
          const message =
            error instanceof Error && !("code" in error)
              ? error.message.slice(0, 250)
              : "Indexing failed. Please try again.";
          await ctx.db.query(
            "update mori_documents set status='failed',error=$3 where tenant_id=$1 and id=$2",
            [ctx.tenant.id, id, message],
          );
          return { id, status: "failed", error: message };
        }
      },
      ["head", "admin"],
    ),
  );
}
async function uploadMedia(request: Request) {
  return api(() =>
    withTenant(request, async () => {
      const data = await request.formData();
      const file = data.get("file");
      if (!(file instanceof File) || file.size > 20 * 1024 * 1024)
        throw new HttpError(400, "Select a media file smaller than 20 MB.");
      const allowed = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "audio/mpeg",
        "audio/mp4",
        "audio/wav",
        "application/pdf",
      ];
      if (!allowed.includes(file.type))
        throw new HttpError(
          400,
          "Use a JPG, PNG, WebP, GIF, MP4, WebM, MP3, M4A, WAV, or PDF file.",
        );
      if (!process.env.CLOUDINARY_API_SECRET)
        throw new HttpError(503, "Cloudinary credentials are missing.");
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const public_id = `mori/${randomUUID()}`;
      const signature = createHash("sha1")
        .update(
          `public_id=${public_id}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`,
        )
        .digest("hex");
      const upload = new FormData();
      upload.set("file", file);
      upload.set("public_id", public_id);
      upload.set("timestamp", timestamp);
      upload.set("api_key", process.env.CLOUDINARY_API_KEY!);
      upload.set("signature", signature);
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
        { method: "POST", body: upload, signal: AbortSignal.timeout(60000) },
      );
      if (!response.ok)
        throw new HttpError(
          502,
          "Cloudinary upload failed. Check your credentials and file type.",
        );
      const result = await response.json();
      return {
        url: result.secure_url,
        public_id: result.public_id,
        type: file.type.startsWith("image")
          ? "image"
          : file.type.startsWith("video")
            ? "video"
            : file.type.startsWith("audio")
              ? "audio"
              : "file",
        name: file.name,
      };
    }),
  );
}
async function createMember(request: Request) {
  // Verify the administrator before using the privileged authentication API.
  const info = await withTenant(
    request,
    async (ctx) => ({
      tenant: ctx.tenant,
      role: ctx.role,
      actorId: ctx.userId,
    }),
    ["head", "admin"],
  );
  const body = z
    .object({
      email: z.email(),
      name: z.string().trim().min(1).max(100),
      role: z.enum(["admin", "member"]),
      assignments: z.array(z.string().max(100)).max(100),
    })
    .parse(await request.json());
  if (info.role === "admin" && body.role !== "member")
    throw new HttpError(403, "Only the head can create administrators.");
  // Invitation is sent only when a workspace administrator submits this action.
  const existing = await pool.query(
    "select id from auth.users where lower(email)=lower($1) limit 1",
    [body.email],
  );
  if (existing.rows[0])
    return saveMember(info.tenant.id, info.actorId, existing.rows[0].id, body);
  const { data, error } = await adminSupabase().auth.admin.inviteUserByEmail(
    body.email,
    {
      data: { full_name: body.name },
      redirectTo: `${process.env.APP_URL}/auth/callback?next=/set-password`,
    },
  );
  if (error || !data.user)
    throw new HttpError(
      400,
      "Invitation could not be sent. Check Supabase email delivery settings.",
    );
  return saveMember(info.tenant.id, info.actorId, data.user.id, body);
}
async function updateMember(request: Request, userId: string) {
  uuid.parse(userId);
  const info = await withTenant(
    request,
    async (ctx) => ({
      tenant: ctx.tenant,
      role: ctx.role,
      actorId: ctx.userId,
    }),
    ["head", "admin"],
  );
  const body = z
    .object({
      role: z.enum(["admin", "member"]),
      assignments: z.array(z.string().max(100)).max(100),
    })
    .parse(await request.json());
  return transaction(async (db) => {
    const { rows } = await db.query(
      "select * from mori_memberships where tenant_id=$1 and user_id=$2 for update",
      [info.tenant.id, userId],
    );
    if (
      !rows[0] ||
      rows[0].role === "head" ||
      (info.role === "admin" &&
        (rows[0].role !== "member" || body.role !== "member"))
    )
      throw new HttpError(403, "You cannot modify this membership.");
    return saveMember(
      info.tenant.id,
      info.actorId,
      userId,
      { ...body, name: rows[0].name, email: rows[0].email },
      db,
    );
  });
}
async function saveMember(
  tenantId: string,
  actorId: string,
  userId: string,
  body: { name: string; email: string; role: string; assignments: string[] },
  existingDb?: Context["db"],
) {
  const run = async (db: Context["db"]) => {
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [
      `${tenantId}:${userId}`,
    ]);
    const actor = (
      await db.query(
        "select role from mori_memberships where tenant_id=$1 and user_id=$2",
        [tenantId, actorId],
      )
    ).rows[0];
    if (
      !actor ||
      !["head", "admin"].includes(actor.role) ||
      (actor.role === "admin" && body.role !== "member")
    )
      throw new HttpError(403, "Administrator access is required.");
    const prior = (
      await db.query(
        "select role from mori_memberships where tenant_id=$1 and user_id=$2",
        [tenantId, userId],
      )
    ).rows[0];
    if (!existingDb && prior)
      throw new HttpError(
        409,
        "This person is already a teammate. Use Manage access to update their assignments.",
      );
    if (
      prior?.role === "head" ||
      (actor.role === "admin" && prior?.role === "admin")
    )
      throw new HttpError(403, "You cannot modify this membership.");
    for (const id of body.assignments) {
      const { rows } = await db.query(
        "select id from mori_resources where tenant_id=$1 and id=$2",
        [tenantId, id],
      );
      if (!rows[0])
        throw new HttpError(
          400,
          "One of the assigned resources does not belong to this workspace.",
        );
    }
    await db.query(
      "insert into mori_memberships (tenant_id,user_id,role,name,email) values ($1,$2,$3,$4,$5) on conflict (tenant_id,user_id) do update set role=excluded.role,name=excluded.name",
      [tenantId, userId, body.role, body.name, body.email],
    );
    await db.query(
      "delete from mori_assignments where tenant_id=$1 and user_id=$2",
      [tenantId, userId],
    );
    for (const id of new Set(body.assignments))
      await db.query(
        "insert into mori_assignments (tenant_id,user_id,resource_id) values ($1,$2,$3)",
        [tenantId, userId, id],
      );
    await audit(db, tenantId, actorId, "member.saved", {
      user_id: userId,
      role: body.role,
    });
    return { ok: true };
  };
  return existingDb ? run(existingDb) : transaction(run);
}
