import { DateTime } from "luxon";
import {
  bestContactTimes,
  nextTouchpoint,
  DEFAULT_FOLLOWUPS,
  messagePermission,
} from "@/lib/domain";
import type { Contact, Tenant } from "@/lib/types";
import { validateIntakeAnswer, isOptOutMessage } from "@/lib/intake";
import { pool, audit, type DB } from "./db";
import { decide, chosen, yes, isJevConfigured } from "./jev";
import { answerKnowledge } from "./knowledge";
import { sendMessage } from "./facebook";

export async function planTouchpoints(
  db: DB,
  tenant: Tenant,
  contact: Contact,
) {
  if (
    contact.opted_out ||
    contact.stage === "converted" ||
    ["stopped", "human"].includes(contact.bot_state)
  )
    return;
  const zone = contact.timezone || tenant.timezone;
  const { rows } = await db.query(
    "select direction,sent_at from mori_messages where tenant_id=$1 and contact_id=$2 and direction='inbound'",
    [tenant.id, contact.id],
  );
  const times = bestContactTimes(
    rows.map((m) => ({ ...m, sent_at: new Date(m.sent_at).toISOString() })),
    zone,
  );
  const now = DateTime.utc();
  for (let day = 1; day <= 7; day++) {
    const first = new Date(contact.first_inquiry_at).toISOString();
    const scheduled = nextTouchpoint(
      first,
      day,
      times.map((t) => t.hour),
      zone,
      now,
    );
    const scheduledDt = DateTime.fromISO(scheduled);
    // Skip elapsed touchpoints instead of sending a burst when a worker comes back online.
    if (
      scheduledDt.toMillis() <= now.toMillis() ||
      scheduledDt.toMillis() > Date.parse(first) + 7 * 86400000
    )
      continue;
    const template = (
      tenant.followup_templates[day - 1] || DEFAULT_FOLLOWUPS[day - 1]
    ).replaceAll("{name}", contact.name.split(" ")[0]);
    await db.query(
      "insert into mori_touchpoints (tenant_id,contact_id,day_number,scheduled_at,template) values ($1,$2,$3,$4,$5) on conflict (tenant_id,contact_id,day_number) do update set scheduled_at=excluded.scheduled_at,template=excluded.template where mori_touchpoints.status='scheduled'",
      [tenant.id, contact.id, day, scheduled, template],
    );
  }
}
export async function botReply(
  tenant: Tenant,
  contact: Contact,
  inbound: string,
  firstMessage: boolean,
) {
  const db = pool;
  const stop = isOptOutMessage(inbound);
  if (stop) {
    await db.query(
      "update mori_contacts set opted_out=true,bot_state='stopped' where tenant_id=$1 and id=$2",
      [tenant.id, contact.id],
    );
    await db.query(
      "update mori_touchpoints set status='cancelled',reason='Opted out' where tenant_id=$1 and contact_id=$2 and status in ('scheduled','needs_human','blocked')",
      [tenant.id, contact.id],
    );
    return;
  }
  if (
    !tenant.bot_enabled ||
    contact.opted_out ||
    ["human", "stopped"].includes(contact.bot_state)
  )
    return;
  const permission = messagePermission(
    contact,
    "bot",
    Date.now(),
    process.env.FACEBOOK_AD_WINDOW_ENABLED === "true",
  );
  if (!permission.allowed) return;
  const explicitHuman =
    /\b(human|real person|agent|representative|kausap na tao)\b/i.test(inbound);
  let human = explicitHuman;
  let isQuestion = inbound.includes("?");
  const awaiting = tenant.intake_fields.find(
    (f) => f.required && !contact.form_answers[f.key],
  );
  const exactChoiceAnswer =
    awaiting?.type === "choice" &&
    awaiting.options?.some(
      (o) => o.toLowerCase() === inbound.trim().toLowerCase(),
    );
  if (isJevConfigured()) {
    const decision = await decide(
      {
        latest_customer_message: inbound,
        intake_answers: contact.form_answers,
      },
      {
        handoff: {
          type: "noul",
          instructions:
            "Does the customer ask for a real human, describe a serious complaint, or need an action outside product questions and intake collection?",
        },
        faq: {
          type: "noul",
          instructions:
            "Is this a product or business question that should be answered from the approved knowledge base?",
        },
        objection: {
          type: "choice",
          instructions:
            "Classify the primary purchase objection. Select none when no objection is expressed.",
          criteria: {
            price: "Too expensive or cannot afford",
            trust: "Concerns about legitimacy or reliability",
            timing: "Not ready or postponing",
            product_fit: "Product does not fit needs",
            delivery: "Shipping or delivery concern",
            none: "No purchase objection",
          },
        },
      },
    );
    human ||= yes(decision?.handoff);
    isQuestion ||= yes(decision?.faq, 0.8);
    const objection = chosen(decision?.objection);
    if (objection && objection !== "none") {
      await db.query(
        "update mori_contacts set objections=(select jsonb_agg(distinct value) from jsonb_array_elements(objections || $3::jsonb)) where tenant_id=$1 and id=$2",
        [tenant.id, contact.id, JSON.stringify([objection])],
      );
    }
  }
  if (exactChoiceAnswer) isQuestion = false;
  if (human) {
    await db.query(
      "update mori_contacts set bot_state='human' where tenant_id=$1 and id=$2",
      [tenant.id, contact.id],
    );
    await db.query(
      "update mori_touchpoints set status='needs_human',reason='Human handoff requested' where tenant_id=$1 and contact_id=$2 and status='scheduled'",
      [tenant.id, contact.id],
    );
    await sendMessage(
      db,
      tenant.id,
      contact,
      "I have passed your conversation to our team. A person will help you from here.",
      "bot",
      undefined,
      true,
    );
    await audit(db, tenant.id, null, "bot.handoff", { contact_id: contact.id });
    return;
  }
  const fields = tenant.intake_fields;
  let missing = fields.find((f) => f.required && !contact.form_answers[f.key]);
  if (missing && !firstMessage && !isQuestion && !isJevConfigured()) {
    const answer = validateIntakeAnswer(missing, inbound);
    if (answer) {
      contact.form_answers[missing.key] = answer;
      await db.query(
        "update mori_contacts set form_answers=$3,name=case when $4='name' then $5 else name end,phone=case when $4='phone' then $5 else phone end,email=case when $4='email' then $5 else email end where tenant_id=$1 and id=$2",
        [
          tenant.id,
          contact.id,
          JSON.stringify(contact.form_answers),
          missing.key,
          answer,
        ],
      );
      if (missing.key === "name") contact.name = answer;
      missing = fields.find((f) => f.required && !contact.form_answers[f.key]);
    }
  }
  let reply = firstMessage
    ? "Hi! I’m the automated assistant. I’ll collect a few details so our team can help. You can ask for a human anytime.\n\n"
    : "";
  if (isQuestion && !firstMessage && !missing) {
    const answer = await answerKnowledge(db, tenant.id, inbound);
    if (answer.answer) {
      reply += `${answer.answer}\n\n`;
      await audit(db, tenant.id, null, "bot.knowledge_answer", {
        contact_id: contact.id,
        source: answer.source,
      });
      if ("media_url" in answer && answer.media_url && answer.media_type)
        await sendMessage(db, tenant.id, contact, "", "bot", {
          url: answer.media_url,
          type: answer.media_type,
        });
    } else {
      await db.query(
        "update mori_contacts set bot_state='human' where tenant_id=$1 and id=$2",
        [tenant.id, contact.id],
      );
      await sendMessage(
        db,
        tenant.id,
        contact,
        "I’ll ask our team to answer that accurately. A person will continue this conversation.",
        "bot",
        undefined,
        true,
      );
      await audit(db, tenant.id, null, "bot.low_confidence_handoff", {
        contact_id: contact.id,
        reason: answer.reason,
      });
      return;
    }
  }
  if (missing)
    reply += `${isQuestion && !firstMessage ? "I can help with that after we complete your details.\n\n" : ""}${missing.label}${missing.options?.length ? `\nOptions: ${missing.options.join(", ")}` : ""}`;
  else if (contact.bot_state === "intake") {
    const qualifies = fields.every(
      (f) =>
        !f.qualify?.length ||
        f.qualify.some(
          (v) => v.toLowerCase() === contact.form_answers[f.key]?.toLowerCase(),
        ),
    );
    await db.query(
      "update mori_contacts set bot_state='faq',stage=case when stage='converted' then stage else $3 end where tenant_id=$1 and id=$2",
      [tenant.id, contact.id, qualifies ? "qualified" : "not_qualified"],
    );
    contact.bot_state = "faq";
    reply +=
      "Thank you, your details are complete. What would you like to know about our products or services?";
  } else if (!reply.trim())
    reply =
      "Would you like to ask a product question, or speak to a member of our team?";
  if (reply.trim()) {
    // Messenger text limit. Long approved passages are split without changing their content.
    for (let i = 0; i < reply.length; i += 1900)
      await sendMessage(
        db,
        tenant.id,
        contact,
        reply.slice(i, i + 1900),
        "bot",
      );
  }
  await planTouchpoints(db, tenant, contact);
}
