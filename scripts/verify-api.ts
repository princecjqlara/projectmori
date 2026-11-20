// Runs against the local app. Creates an email-confirmed test user without sending mail,
// exercises real API/database behavior, and removes all test data in finally.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { pool, transaction } = await import("../src/server/db");
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const email = `mori-qa-${randomUUID()}@example.invalid`,
    password = `Mori!${randomUUID()}`;
  let userId: string | undefined,
    tenantId: string | undefined,
    uploadedId: string | undefined;
  try {
    const { data: created, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Mori QA" },
    });
    if (error) throw error;
    userId = created.user.id;
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const token = signed.data.session!.access_token;
    async function call(path: string, method = "GET", body?: unknown) {
      const response = await fetch(`http://127.0.0.1:3000/api/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "x-tenant-id": tenantId || "",
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          body === undefined
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
      });
      const json = await response.json();
      assert.ok(
        response.ok,
        `${path}: ${response.status}: ${json.error || "request failed"}`,
      );
      return json;
    }
    assert.deepEqual(await call("workspaces"), []);
    const workspace = await call("workspaces", "POST", {
      name: "Mori QA ephemeral workspace",
    });
    tenantId = workspace.id;
    let snapshot = await call("snapshot");
    assert.equal(snapshot.tenant.role, "head");
    assert.equal(snapshot.contacts.length, 0);
    const contact = await call("contacts", "POST", {
      name: "Mori QA contact",
      email: "qa@example.invalid",
      notes: "API verification only",
    });
    const order = await call("orders", "POST", {
      contact_id: contact.id,
      amount: 2500,
      status: "paid",
      notes: "API verification only",
    });
    snapshot = await call("snapshot");
    assert.equal(snapshot.contacts[0].stage, "converted");
    assert.equal(snapshot.orders[0].amount_minor, 250000);
    assert.ok(snapshot.contacts[0].converted_at);
    await call(`orders/${order.id}`, "PATCH", { status: "refunded" });
    snapshot = await call("snapshot");
    assert.equal(snapshot.contacts[0].stage, "qualified");
    assert.equal(snapshot.contacts[0].converted_at, null);
    const form = new FormData();
    form.set(
      "file",
      new File(
        [
          "Delivery takes two business days in Metro Manila. Orders include complimentary gift wrapping.",
        ],
        "QA-policy.txt",
        { type: "text/plain" },
      ),
    );
    const document = await call("knowledge", "POST", form);
    assert.equal(document.status, "ready");
    assert.ok(document.chunk_count > 0);
    await call("faqs", "POST", {
      question: "How long does delivery take?",
      answer: "Delivery takes two business days.",
    });
    const answer = await call("knowledge/search", "POST", {
      question: "How long does delivery take?",
    });
    assert.ok("answer" in answer);
    const rows = await pool.query(
      "select content from mori_chunks where tenant_id=$1",
      [tenantId],
    );
    assert.ok(rows.rows[0].content.includes("Delivery"));
    const mediaForm = new FormData();
    mediaForm.set(
      "file",
      new File(
        [
          new Uint8Array(
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
              "base64",
            ),
          ),
        ],
        "QA-pixel.png",
        { type: "image/png" },
      ),
    );
    const media = await call("media", "POST", mediaForm);
    uploadedId = media.public_id;
    assert.ok(
      media.url.startsWith(
        `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/`,
      ),
    );
    const pageId = `qa-page-${randomUUID()}`;
    await pool.query(
      "insert into mori_resources (tenant_id,id,name,type,token_encrypted,connected_by) values ($1,$2,'QA Page','page','not-a-real-token',$3)",
      [tenantId, pageId, userId],
    );
    const { ingestFacebookEvent } = await import("../src/server/worker");
    const timestamp = Date.now() - 5000;
    const referral = {
      sender: { id: "qa-messenger-id" },
      timestamp,
      referral: { source: "ADS", ad_id: "qa-acquisition-ad" },
    };
    await ingestFacebookEvent(pageId, referral);
    assert.equal(
      (
        await pool.query(
          "select count(*)::int as n from mori_contacts where tenant_id=$1",
          [tenantId],
        )
      ).rows[0].n,
      1,
      "Referral clicks must not create contacts.",
    );
    const event = {
      sender: { id: "qa-messenger-id" },
      timestamp: timestamp + 1000,
      message: { mid: `qa-${randomUUID()}`, text: "Hello" },
    };
    await ingestFacebookEvent(pageId, event);
    await ingestFacebookEvent(pageId, event);
    const imported = (
      await pool.query(
        "select * from mori_contacts where tenant_id=$1 and external_id=$2",
        [tenantId, "qa-messenger-id"],
      )
    ).rows[0];
    assert.equal(imported.source_ad_id, "qa-acquisition-ad");
    assert.equal(Date.parse(imported.first_inquiry_at), event.timestamp);
    assert.equal(
      (
        await pool.query(
          "select count(*)::int as n from mori_messages where tenant_id=$1 and contact_id=$2",
          [tenantId, imported.id],
        )
      ).rows[0].n,
      1,
      "Duplicate deliveries must be idempotent.",
    );
    await ingestFacebookEvent(pageId, {
      sender: { id: "qa-messenger-id" },
      timestamp: timestamp + 2000,
      referral: { source: "ADS", ad_id: "different-returning-ad" },
    });
    const unchanged = (
      await pool.query(
        "select source_ad_id,last_inbound_at from mori_contacts where id=$1",
        [imported.id],
      )
    ).rows[0];
    assert.equal(unchanged.source_ad_id, "qa-acquisition-ad");
    assert.equal(Date.parse(unchanged.last_inbound_at), event.timestamp);
    // Test real OpenRouter extraction and persistence without sending any Page messages.
    const autofillText =
      "My name is Andrea Reyes from Quezon City. My number is 09171234567 and my email is andrea@example.com. I'm interested in the gift bundle and my budget is ₱3,000.";
    const sourceId = randomUUID();
    await pool.query(
      "insert into mori_messages (id,tenant_id,contact_id,direction,sender,text) values ($1,$2,$3,'inbound','contact',$4)",
      [sourceId, tenantId, imported.id, autofillText],
    );
    const filled = await call(`contacts/${imported.id}/autofill`, "POST", {});
    assert.equal(filled.contact.name, "Andrea Reyes");
    assert.equal(filled.contact.email, "andrea@example.com");
    assert.equal(filled.contact.phone, "09171234567");
    assert.equal(filled.contact.form_answers.location, "Quezon City");
    assert.equal(
      filled.contact.autofill_evidence.name.source_message_id,
      sourceId,
    );
    assert.equal(
      Object.keys(
        (await call(`contacts/${imported.id}/autofill`, "POST", {})).updated,
      ).length,
      0,
    );
    await ingestFacebookEvent(pageId, {
      sender: { id: "qa-auto-fill" },
      timestamp: Date.now() - 1000,
      message: { mid: `qa-${randomUUID()}`, text: autofillText },
    });
    const automatic = (
      await pool.query(
        "select name,email,form_answers from mori_contacts where tenant_id=$1 and external_id=$2",
        [tenantId, "qa-auto-fill"],
      )
    ).rows[0];
    assert.equal(automatic.name, "Andrea Reyes");
    assert.equal(automatic.email, "andrea@example.com");
    assert.equal(automatic.form_answers.location, "Quezon City");
    await call("settings", "PATCH", { autofill_enabled: false });
    await ingestFacebookEvent(pageId, {
      sender: { id: "qa-disabled-fill" },
      timestamp: Date.now() - 1000,
      message: { mid: `qa-${randomUUID()}`, text: autofillText },
    });
    const disabled = (
      await pool.query(
        "select name,form_answers from mori_contacts where tenant_id=$1 and external_id=$2",
        [tenantId, "qa-disabled-fill"],
      )
    ).rows[0];
    assert.equal(disabled.name, "Messenger contact");
    assert.deepEqual(disabled.form_answers, {});
    await call("settings", "PATCH", { autofill_enabled: true });
    await call("touchpoints/plan", "POST", { contact_id: imported.id });
    snapshot = await call("snapshot");
    assert.equal(
      snapshot.touchpoints.filter(
        (t: { contact_id: string }) => t.contact_id === imported.id,
      ).length,
      7,
    );
    await call("settings", "PATCH", {
      expense_percent: 20,
      expense_threshold_minor: 100000,
    });
    snapshot = await call("snapshot");
    assert.equal(snapshot.tenant.expense_percent, 20);
    console.log(
      "PASS: real authentication, orders/refunds, knowledge indexing, FAQ/retrieval, Cloudinary upload, referral attribution, webhook deduplication, automatic/manual Jev autofill with source evidence, autofill opt-out, seven touchpoints, and saved settings.",
    );
  } catch (e) {
    console.error(
      "API verification failed:",
      e instanceof Error ? e.message : "unknown",
    );
    process.exitCode = 1;
  } finally {
    if (uploadedId) {
      try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = createHash("sha1")
          .update(
            `public_id=${uploadedId}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`,
          )
          .digest("hex");
        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/destroy`,
          {
            method: "POST",
            body: new URLSearchParams({
              public_id: uploadedId,
              timestamp,
              signature,
              api_key: process.env.CLOUDINARY_API_KEY!,
            }),
          },
        );
        assert.ok(response.ok);
      } catch {
        console.error("Test media cleanup failed.");
        process.exitCode = 1;
      }
    }
    if (tenantId) {
      try {
        await transaction(async (db) => {
          for (const table of [
            "mori_touchpoints",
            "mori_messages",
            "mori_orders",
            "mori_chunks",
            "mori_documents",
            "mori_faqs",
            "mori_audit",
            "mori_spend",
            "mori_ads",
            "mori_contacts",
            "mori_assignments",
            "mori_referrals",
            "mori_resources",
            "mori_memberships",
          ])
            await db.query(`delete from ${table} where tenant_id=$1`, [
              tenantId,
            ]);
          await db.query("delete from mori_tenants where id=$1", [tenantId]);
        });
      } catch {
        console.error("Test workspace cleanup failed.");
        process.exitCode = 1;
      }
    }
    if (userId) {
      const result = await client.auth.admin.deleteUser(userId);
      if (result.error) {
        console.error("Test user cleanup failed.");
        process.exitCode = 1;
      }
    }
    await pool.end();
    console.log("Ephemeral test workspace and authentication user removed.");
  }
}
main();
