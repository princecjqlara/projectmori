import type { IntakeField } from "./types";

export function validateIntakeAnswer(
  field: IntakeField,
  text: string,
): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (field.type === "email")
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
  if (field.type === "phone")
    return /^\d{7,15}$/.test(trimmed.replace(/[\s()+.-]/g, ""))
      ? trimmed
      : null;
  if (field.type === "number")
    return Number.isFinite(Number(trimmed)) && Number(trimmed) >= 0
      ? trimmed
      : null;
  if (field.type === "choice")
    return (
      field.options?.find(
        (option) => option.toLowerCase() === trimmed.toLowerCase(),
      ) || null
    );
  return trimmed.includes("?") ? null : trimmed;
}
export const isOptOutMessage = (text: string) =>
  /^(stop|unsubscribe|opt out|cancel messages|do not contact me)[.!\s]*$/i.test(
    text.trim(),
  );
export function profileColumn(
  field: IntakeField,
): "name" | "email" | "phone" | null {
  if (
    ["name", "full_name", "fullname", "customer_name", "contact_name"].includes(
      field.key.toLowerCase(),
    )
  )
    return "name";
  if (
    field.type === "email" ||
    ["email", "email_address"].includes(field.key.toLowerCase())
  )
    return "email";
  if (
    field.type === "phone" ||
    ["phone", "phone_number", "mobile", "contact_number"].includes(
      field.key.toLowerCase(),
    )
  )
    return "phone";
  return null;
}
