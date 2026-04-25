import OpenAI from "openai";

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? "text-embedding-3-small";

let client: OpenAI | null = null;
function openai() {
  if (!client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set");
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const r = await openai().embeddings.create({ model: EMBED_MODEL, input: text });
  const raw = r.data[0].embedding as number[];
  const v = new Float32Array(raw);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
  return v;
}
