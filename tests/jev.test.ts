import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chosen, decide, yes } from "../src/server/jev";
beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("JEV_PROVIDER", "typesafe");
  vi.stubEnv("JEV_API_URL", "https://api.typesafe.ai/v1/systemone");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Jev decision contract", () => {
  it("uses the OpenRouter key only at the OpenRouter Decisions endpoint", async () => {
    vi.stubEnv("JEV_PROVIDER", "openrouter");
    vi.stubEnv("JEV_API_URL", "https://openrouter.ai/api/alpha/decisions");
    vi.stubEnv("OPENROUTER_API_KEY", "test-router-key");
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ answers: { ready: { type: "noul", noul: 0.99 } } }),
      );
    vi.stubGlobal("fetch", fetcher);
    await decide("Test", {
      ready: { type: "noul", instructions: "Is this a test?" },
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/alpha/decisions",
    );
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-router-key",
    );
    vi.stubEnv("JEV_API_URL", "https://api.typesafe.ai/v1/systemone");
    await expect(
      decide("Test", { ready: { type: "noul", instructions: "Test?" } }),
    ).rejects.toThrow("does not match");
  });
  const questions = {
    route: {
      type: "choice" as const,
      instructions: "Which answer applies?",
      criteria: { faq: "Approved FAQ", none: "No supported answer" },
    },
  };
  it("keeps model confidence separate from the probability of the selected option", () => {
    expect(
      chosen({
        type: "choice",
        choice: "faq",
        confidence: 0.99,
        probabilities: { faq: 0.6, none: 0.4 },
      }),
    ).toBeNull();
    expect(
      chosen({
        type: "choice",
        choice: "faq",
        confidence: 0.7,
        probabilities: { faq: 0.94, none: 0.06 },
      }),
    ).toBe("faq");
    expect(yes({ type: "noul", noul: 0.89 })).toBe(false);
  });
  it("makes no paid API request when the key is missing", async () => {
    vi.stubEnv("JEV_API_KEY", "");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await decide("question", questions)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("validates returned options and distribution before an application acts", async () => {
    vi.stubEnv("JEV_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          answers: {
            route: {
              type: "choice",
              choice: "invented",
              confidence: 1,
              probabilities: { faq: 0.6, none: 0.4 },
            },
          },
        }),
      ),
    );
    await expect(decide("question", questions)).rejects.toThrow(
      "invalid choice",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          answers: {
            route: {
              type: "choice",
              choice: "faq",
              confidence: 1,
              probabilities: { faq: 0.9, none: 0.8 },
            },
          },
        }),
      ),
    );
    await expect(decide("question", questions)).rejects.toThrow(
      "invalid choice",
    );
  });
  it("accepts the official typed response and rejects mismatched primitive types", async () => {
    vi.stubEnv("JEV_API_KEY", "test-key");
    const response = {
      answers: {
        route: {
          type: "choice",
          choice: "faq",
          confidence: 0.9,
          probabilities: { faq: 0.95, none: 0.05 },
        },
      },
    };
    const fetcher = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetcher);
    expect(chosen((await decide("question", questions))?.route)).toBe("faq");
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request).toMatchObject({ state: "question", questions });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ answers: { route: { type: "noul", noul: 1 } } }),
        ),
    );
    await expect(decide("question", questions)).rejects.toThrow("mismatched");
  });
});
