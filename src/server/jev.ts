import { z } from "zod";
export type Question =
  | { type: "noul"; instructions: string; criteria?: unknown }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };
const Answer = z.union([
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),
]);
export function jevConfiguration() {
  const provider =
    process.env.JEV_PROVIDER ||
    (process.env.OPENROUTER_API_KEY ? "openrouter" : "typesafe");
  if (!["openrouter", "typesafe"].includes(provider))
    throw new Error("Unsupported Jev provider.");
  const openrouter = provider === "openrouter";
  const apiKey = openrouter
    ? process.env.OPENROUTER_API_KEY
    : process.env.JEV_API_KEY;
  const url =
    process.env.JEV_API_URL ||
    (openrouter
      ? "https://openrouter.ai/api/alpha/decisions"
      : "https://api.typesafe.ai/v1/systemone");
  if (
    new URL(url).hostname !==
      (openrouter ? "openrouter.ai" : "api.typesafe.ai") ||
    new URL(url).protocol !== "https:"
  )
    throw new Error("Jev endpoint does not match the configured provider.");
  return {
    provider,
    apiKey,
    url,
    model:
      process.env.JEV_MODEL ||
      (openrouter ? "typesafe/jev-1.14" : "jev-latest"),
  };
}
export const isJevConfigured = () => !!jevConfiguration().apiKey;
export async function decide(
  state: unknown,
  questions: Record<string, Question>,
) {
  const config = jevConfiguration();
  if (!config.apiKey) return null;
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(config.provider === "openrouter"
        ? {
            "HTTP-Referer": process.env.APP_URL || "http://127.0.0.1:3000",
            "X-Title": "Mori CRM",
          }
        : {}),
    },
    body: JSON.stringify({
      model: config.model,
      state,
      questions,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`JEV_HTTP_${response.status}`);
  const result = z
    .object({ answers: z.record(z.string(), Answer) })
    .parse(await response.json());
  for (const [key, question] of Object.entries(questions)) {
    const answer = result.answers[key];
    if (!answer || answer.type !== question.type)
      throw new Error("Jev returned a missing or mismatched decision.");
    if (answer.type === "choice" && question.type === "choice") {
      if (
        !Object.hasOwn(question.criteria, answer.choice) ||
        Object.keys(question.criteria).some(
          (option) => !Object.hasOwn(answer.probabilities, option),
        ) ||
        Math.abs(
          Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0) -
            1,
        ) > 0.02
      )
        throw new Error("Jev returned an invalid choice distribution.");
    }
  }
  return result.answers;
}
export const yes = (
  answer: z.infer<typeof Answer> | undefined,
  threshold = 0.9,
) => answer?.type === "noul" && answer.noul >= threshold;
export function chosen(
  answer: z.infer<typeof Answer> | undefined,
  threshold = 0.85,
): string | null {
  return answer?.type === "choice" &&
    answer.probabilities[answer.choice] >= threshold
    ? answer.choice
    : null;
}
