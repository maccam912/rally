/** Minimal client for the local oMLX OpenAI-compatible vision server. Always
 * gate calls on isOmlxAvailable() so the main test suite stays hermetic. */
const BASE = process.env.OMLX_BASE_URL ?? "http://localhost:8000/v1";
const KEY = process.env.OMLX_API_KEY ?? "0000";
const MODEL = process.env.OMLX_VISION_MODEL ?? "gemma-4-e2b-it-4bit";

export async function isOmlxAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface VisualVerdict {
  looksValid: boolean;
  reason: string;
}

/** Ask the vision model a yes/no question about a PNG image. */
export async function askVision(png: Buffer, question: string): Promise<VisualVerdict> {
  const b64 = png.toString("base64");
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `${question}\n\nReply with strict JSON only: ` +
                `{"looksValid": boolean, "reason": "short"}`,
            },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  let text: string = data?.choices?.[0]?.message?.content ?? "{}";
  text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : "{}") as VisualVerdict;
}
