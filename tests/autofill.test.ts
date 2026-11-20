import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Contact, IntakeField } from "../src/lib/types";
const mocks = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("../src/server/jev", async () => ({
  ...(await vi.importActual("../src/server/jev")),
  decide: mocks.decide,
  isJevConfigured: () => true,
}));
import {
  autofillFields,
  extractContactDetails,
  knownProfileAnswers,
  tokenizeCustomerMessages,
  type CustomerText,
} from "../src/server/autofill";
const contact = (): Contact => ({
  id: "c",
  tenant_id: "t",
  page_id: null,
  external_id: null,
  name: "Messenger contact",
  email: null,
  phone: null,
  stage: "not_qualified",
  bot_state: "intake",
  first_inquiry_at: "2026-11-01T00:00:00Z",
  last_inbound_at: null,
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
});
const message = (id: string, text: string): CustomerText => ({
  id,
  text,
  sent_at: "2026-11-01T00:00:00Z",
});
const field: IntakeField = {
  key: "name",
  label: "Your full name?",
  type: "text",
  required: true,
};
const oneFieldContact = () => ({
  ...contact(),
  phone: "09171234567",
  email: "saved@example.com",
});
function response(
  messages: CustomerText[],
  startWord: string,
  endWord: string,
  present = 0.99,
) {
  const tokens = tokenizeCustomerMessages(messages);
  const start = tokens.find((t) => t.text === startWord)!.id,
    end = tokens.find((t) => t.text === endWord)!.id;
  return {
    present_0: { type: "noul", noul: present },
    start_0: {
      type: "choice",
      choice: start,
      confidence: 0.8,
      probabilities: { [start]: 0.8 },
    },
    end_0: {
      type: "choice",
      choice: end,
      confidence: 0.9,
      probabilities: { [end]: 0.9 },
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe("Extractive contact autofill", () => {
  it("saves only a verified exact customer span with message provenance", async () => {
    const messages = [message("m1", "Hi, I'm Andrea Reyes from Makati.")];
    mocks.decide
      .mockResolvedValueOnce(response(messages, "Andrea", "Reyes"))
      .mockResolvedValueOnce({ verified_0: { type: "noul", noul: 0.98 } });
    const result = await extractContactDetails(
      { intake_fields: [field] },
      oneFieldContact(),
      messages,
    );
    expect(result.proposals).toMatchObject([
      {
        field_key: "name",
        value: "Andrea Reyes",
        source_message_id: "m1",
        source_text: "Andrea Reyes",
        probability: 0.98,
        profile_column: "name",
      },
    ]);
  });
  it("does not overwrite saved profile data or existing form answers", () => {
    const c = {
      ...oneFieldContact(),
      name: "Already Saved",
      form_answers: { city: "Makati" },
    };
    expect(
      autofillFields(
        {
          intake_fields: [
            field,
            { key: "city", label: "City?", type: "text", required: true },
          ],
        },
        c,
      ),
    ).toEqual([]);
  });
  it("rejects unsupported and ambiguous details before verification", async () => {
    const messages = [message("m1", "Andrea Reyes")];
    mocks.decide.mockResolvedValueOnce(
      response(messages, "Andrea", "Reyes", 0.7),
    );
    expect(
      (
        await extractContactDetails(
          { intake_fields: [field] },
          oneFieldContact(),
          messages,
        )
      ).proposals,
    ).toEqual([]);
    expect(mocks.decide).toHaveBeenCalledTimes(1);
  });
  it("rejects a candidate when the independent source check is uncertain", async () => {
    const messages = [message("m1", "Andrea Reyes")];
    mocks.decide
      .mockResolvedValueOnce(response(messages, "Andrea", "Reyes"))
      .mockResolvedValueOnce({ verified_0: { type: "noul", noul: 0.7 } });
    const result = await extractContactDetails(
      { intake_fields: [field] },
      oneFieldContact(),
      messages,
    );
    expect(result.proposals).toEqual([]);
    expect(result.review).toContain("name");
  });
  it("never constructs a value by joining separate customer messages", async () => {
    const messages = [message("m1", "Andrea"), message("m2", "Reyes")];
    mocks.decide.mockResolvedValueOnce(response(messages, "Andrea", "Reyes"));
    expect(
      (
        await extractContactDetails(
          { intake_fields: [field] },
          oneFieldContact(),
          messages,
        )
      ).proposals,
    ).toEqual([]);
    expect(mocks.decide).toHaveBeenCalledTimes(1);
  });
  it("validates phone and number fields after selecting literal evidence", async () => {
    const phone: IntakeField = {
      key: "phone",
      label: "Phone?",
      type: "phone",
      required: true,
    };
    const c = { ...contact(), name: "Saved Name", email: "saved@example.com" };
    const invalid = [message("m1", "tomorrow")];
    mocks.decide.mockResolvedValueOnce(
      response(invalid, "tomorrow", "tomorrow"),
    );
    expect(
      (await extractContactDetails({ intake_fields: [phone] }, c, invalid))
        .proposals,
    ).toEqual([]);
    const budget: IntakeField = {
      key: "budget",
      label: "Budget?",
      type: "number",
      required: true,
    };
    const values = [message("m2", "₱3,000.50")];
    mocks.decide
      .mockResolvedValueOnce(response(values, "₱", "000.50"))
      .mockResolvedValueOnce({ verified_0: { type: "noul", noul: 0.99 } });
    const result = await extractContactDetails(
      { intake_fields: [budget] },
      { ...oneFieldContact(), name: "Saved Name" },
      values,
    );
    expect(result.proposals[0].value).toBe("3000.50");
    expect(result.proposals[0].source_text).toBe("₱3,000.50");
  });
  it("caps the token choices below the provider limit and retains message offsets", () => {
    const messages = [
      message("m1", "old ".repeat(300)),
      message("m2", "latest text"),
    ];
    const tokens = tokenizeCustomerMessages(messages);
    expect(tokens).toHaveLength(240);
    expect(tokens.at(-1)?.text).toBe("text");
    expect(
      tokens.every(
        (t) =>
          messages
            .find((m) => m.id === t.message_id)!
            .text.slice(t.start, t.end) === t.text,
      ),
    ).toBe(true);
  });
  it("includes optional contact email even when the intake form does not request it", () => {
    expect(
      autofillFields({ intake_fields: [field] }, contact()).map((f) => f.key),
    ).toEqual(["name", "phone", "email"]);
  });
  it("reuses already saved profile details for matching empty intake fields", () => {
    const c = {
      ...oneFieldContact(),
      name: "Saved Name",
      form_answers: { phone: "Form phone" },
    };
    expect(
      knownProfileAnswers(
        {
          intake_fields: [
            field,
            { key: "phone", label: "Phone?", required: true, type: "phone" },
            { key: "email", label: "Email?", required: true, type: "email" },
          ],
        },
        c,
      ),
    ).toEqual({ name: "Saved Name", email: "saved@example.com" });
  });
});
