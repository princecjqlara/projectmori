import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import assert from "node:assert/strict";
import type { Contact, Tenant } from "../src/lib/types";
import { DEFAULT_FIELDS, DEFAULT_FOLLOWUPS } from "../src/lib/domain";
async function main() {
  if (process.argv.includes("--debug")) {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const response = await original(input, init);
      const json = await response.clone().json();
      const body = JSON.parse(String(init?.body || "{}"));
      console.log(
        "Decision diagnostics:",
        JSON.stringify(
          Object.fromEntries(
            Object.entries(json.answers || {}).map(([key, answer]) => {
              const a = answer as {
                type: string;
                noul?: number;
                choice?: string;
                probabilities?: Record<string, number>;
              };
              return [
                key,
                a.type === "noul"
                  ? a.noul
                  : {
                      choice: a.choice,
                      probability: a.probabilities?.[a.choice || ""],
                      token: a.choice
                        ? body.questions[key]?.criteria?.[a.choice]
                        : null,
                    },
              ];
            }),
          ),
        ),
      );
      return response;
    };
  }
  const { extractContactDetails } = await import("../src/server/autofill");
  const { jevConfiguration } = await import("../src/server/jev");
  const { pool } = await import("../src/server/db");
  const tenant: Tenant = {
    id: "test",
    name: "Autofill test",
    timezone: "Asia/Manila",
    currency: "PHP",
    expense_percent: 0,
    expense_threshold_minor: 0,
    automation_enabled: false,
    bot_enabled: false,
    aov_spend_multiplier: 1.5,
    min_ad_days: 3,
    intake_fields: DEFAULT_FIELDS,
    followup_templates: DEFAULT_FOLLOWUPS,
    role: "head",
  };
  const contact: Contact = {
    id: "test",
    tenant_id: "test",
    page_id: null,
    external_id: null,
    name: "Messenger contact",
    email: null,
    phone: null,
    stage: "not_qualified",
    bot_state: "intake",
    first_inquiry_at: new Date().toISOString(),
    last_inbound_at: new Date().toISOString(),
    converted_at: null,
    ad_window_opened_at: null,
    source_ad_id: null,
    source: "test",
    timezone: null,
    form_answers: {},
    objections: [],
    notes: "",
    opted_out: false,
    assigned_to: null,
  };
  try {
    const result = await extractContactDetails(tenant, contact, [
      {
        id: "m1",
        sent_at: new Date().toISOString(),
        text: "Hi, I'm Andrea Reyes from Quezon City. My number is 09171234567 and my email is andrea@example.com. I'm interested in the gift bundle, and my budget is ₱3,000.",
      },
    ]);
    const values = Object.fromEntries(
      result.proposals.map((p) => [p.field_key, p.value]),
    );
    console.log("Synthetic customer extraction:", JSON.stringify(values));
    assert.equal(values.name, "Andrea Reyes");
    assert.equal(values.phone, "09171234567");
    assert.equal(values.email, "andrea@example.com");
    assert.equal(values.location, "Quezon City");
    assert.match(values.interest, /gift bundle/i);
    assert.match(values.budget, /3,?000/);
    const missing = await extractContactDetails(tenant, contact, [
      {
        id: "m2",
        sent_at: new Date().toISOString(),
        text: "How much is delivery?",
      },
    ]);
    assert.equal(
      missing.proposals.length,
      0,
      "A question must not become a profile fact.",
    );
    const thirdParty = await extractContactDetails(tenant, contact, [
      {
        id: "third-party",
        sent_at: new Date().toISOString(),
        text: "My sister Ana Reyes lives in Makati. Her number is 09175550000 and her email is ana@example.com. I am just asking about your business hours.",
      },
    ]);
    assert.equal(
      thirdParty.proposals.length,
      0,
      "Third-party details must not become this contact’s facts.",
    );
    const existing = {
      ...contact,
      name: "Saved Name",
      email: "saved@example.com",
      phone: "09179999999",
      form_answers: {
        name: "Saved Name",
        phone: "09179999999",
        email: "saved@example.com",
        location: "Saved City",
        budget: "Saved budget",
        interest: "Saved interest",
      },
    };
    const preserved = await extractContactDetails(tenant, existing, [
      {
        id: "m3",
        sent_at: new Date().toISOString(),
        text: "My name is Another Person and my email is another@example.com.",
      },
    ]);
    assert.equal(
      preserved.proposals.length,
      0,
      "Existing saved details must not be overwritten.",
    );
    const provider = jevConfiguration();
    console.log(
      `PASS: live ${provider.provider} / ${provider.model} multi-field extraction, unsupported-question and third-party rejection, and preservation of existing values. No database records or customer messages changed.`,
    );
  } catch (error) {
    console.error(
      "Live autofill verification failed:",
      error instanceof Error ? error.message : "unknown",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
