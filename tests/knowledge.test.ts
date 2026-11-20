import { expect, it } from "vitest";
import { chunkText, extractKnowledge } from "../src/server/knowledge";
it("extracts a PDF into indexed passages without a separate PDF service", async () => {
  const content =
    "BT /F1 12 Tf 50 750 Td (Delivery takes two business days.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const chunks = await extractKnowledge(
    new File([pdf], "policy.pdf", { type: "application/pdf" }),
  );
  expect(chunks.join(" ")).toContain("Delivery takes two business days.");
});
it("keeps text overlap and rejects unsupported or empty files", async () => {
  const text = "A".repeat(1600) + "\n" + "B".repeat(1400);
  const chunks = chunkText(text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[0].slice(-180)).toBe(chunks[1].slice(0, 180));
  await expect(extractKnowledge(new File([""], "empty.txt"))).rejects.toThrow(
    "No readable text",
  );
  await expect(extractKnowledge(new File(["x"], "script.exe"))).rejects.toThrow(
    "Upload a PDF",
  );
});
