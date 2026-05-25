export type StrategyChunk = {
  index: number;
  text: string;
  embedding_snippet: string;
};

export function chunkStrategyText(text: string, chunkSize = 1200): StrategyChunk[] {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: StrategyChunk[] = [];
  for (let start = 0; start < normalized.length; start += chunkSize) {
    const value = normalized.slice(start, start + chunkSize).trim();
    if (!value) continue;
    chunks.push({
      index: chunks.length,
      text: value,
      embedding_snippet: value.slice(0, 240),
    });
  }
  return chunks;
}

export async function extractStrategyFromPdf(buffer: Buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return String(data.text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 24000);
}
