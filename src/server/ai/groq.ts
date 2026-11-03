/**
 * Minimal Groq chat client (OpenAI-compatible API) with an explicit time budget. Plain fetch, so
 * our loop is the only retry and tests can stub `fetch`. Request and response bodies are never
 * logged: they carry customer data under NDA.
 *
 * Groq does not use API inputs or outputs for training (Services Agreement §4.2); enable Zero
 * Data Retention on the production key so nothing is kept for abuse monitoring either.
 */

export type AiFailure = "NO_KEY" | "TIMEOUT" | "RATE_LIMITED" | "HTTP_ERROR" | "INVALID_OUTPUT";

export class AiUnavailableError extends Error {
  constructor(
    readonly reason: AiFailure,
    message: string,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

type Content = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface ChatJsonRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: Content }>;
  responseFormat: { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: object } } | { type: "json_object" };
  maxCompletionTokens?: number;
  /** gpt-oss only: extraction needs little reasoning, so "low" keeps it fast. */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface ChatJsonOptions {
  attemptTimeoutMs?: number;
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function aiConfig() {
  return {
    apiKey: process.env.GROQ_API_KEY || null,
    baseUrl: (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    textModel: process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b",
    visionModel: process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b",
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function chatJson(request: ChatJsonRequest, options: ChatJsonOptions = {}): Promise<{ json: unknown; durationMs: number }> {
  const { apiKey, baseUrl } = aiConfig();
  if (!apiKey) throw new AiUnavailableError("NO_KEY", "No Groq API key is configured.");
  const attemptTimeout = options.attemptTimeoutMs ?? 20_000;
  const budget = options.budgetMs ?? 45_000;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const started = Date.now();
  const remaining = () => budget - (Date.now() - started);

  const body = JSON.stringify({
    model: request.model,
    messages: request.messages,
    response_format: request.responseFormat,
    temperature: 0,
    max_completion_tokens: request.maxCompletionTokens ?? 4_000,
    ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort, include_reasoning: false } : {}),
  });

  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(attemptTimeout, remaining())));
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (remaining() <= 1_000) throw new AiUnavailableError("TIMEOUT", "The AI service did not answer in time.");
      if ((error as Error).name === "AbortError" && attempt >= 2) throw new AiUnavailableError("TIMEOUT", "The AI service did not answer in time.");
      await sleep(Math.min(1_000 * attempt, remaining()));
      continue;
    }
    clearTimeout(timer);

    if (response.ok) {
      const data = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new AiUnavailableError("INVALID_OUTPUT", "The AI service returned an empty answer.");
      try {
        return { json: JSON.parse(content), durationMs: Date.now() - started };
      } catch {
        throw new AiUnavailableError("INVALID_OUTPUT", "The AI service returned malformed JSON.");
      }
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 1_000 * attempt;
      if (attempt >= 3 || wait >= remaining() - 1_000) {
        throw new AiUnavailableError(response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR", response.status === 429 ? "The AI service is rate-limiting requests." : `The AI service failed (${response.status}).`);
      }
      await sleep(wait);
      continue;
    }

    // 400 from a schema mismatch (best-effort mode) or any other client error: no retry.
    throw new AiUnavailableError(response.status === 400 ? "INVALID_OUTPUT" : "HTTP_ERROR", `The AI service refused the request (${response.status}).`);
  }
}
