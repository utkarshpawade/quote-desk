import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractWithAi, transcribeImage } from "./extract";
import { AiUnavailableError, chatJson } from "./groq";

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200 });

const noSleep = async () => {};
const request = { model: "m", messages: [{ role: "user" as const, content: "x" }], responseFormat: { type: "json_object" as const } };

describe("Groq client", () => {
  beforeEach(() => vi.stubEnv("GROQ_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  it("returns parsed JSON and sends the key only in the header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ lines: ["A"] }));
    const res = await chatJson(request, { fetchImpl, sleep: noSleep });
    expect(res.json).toEqual({ lines: ["A"] });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toMatchObject({ temperature: 0, response_format: { type: "json_object" } });
  });

  it("is unavailable without a key", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(chatJson(request, { fetchImpl: vi.fn() })).rejects.toMatchObject({ reason: "NO_KEY" });
  });

  it("honours retry-after on 429, then succeeds", async () => {
    const sleep = vi.fn(noSleep);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(ok({ lines: [] }));
    await chatJson(request, { fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once when the model's output broke the strict schema, then gives up", async () => {
    const schemaFailure = () => new Response(JSON.stringify({ error: { code: "json_validate_failed", message: "Generated JSON does not match the expected schema." } }), { status: 400 });
    const recovers = vi.fn().mockResolvedValueOnce(schemaFailure()).mockResolvedValueOnce(ok({ lines: ["B"] }));
    expect((await chatJson(request, { fetchImpl: recovers, sleep: noSleep })).json).toEqual({ lines: ["B"] });
    const fails = vi.fn().mockResolvedValueOnce(schemaFailure()).mockResolvedValueOnce(schemaFailure());
    await expect(chatJson(request, { fetchImpl: fails, sleep: noSleep })).rejects.toMatchObject({ reason: "INVALID_OUTPUT" });
    expect(fails).toHaveBeenCalledTimes(2);
  });

  it("gives up at once when the wait would exceed the time budget", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 429, headers: { "retry-after": "60" } }));
    await expect(chatJson(request, { fetchImpl, sleep: noSleep, budgetMs: 45_000 })).rejects.toMatchObject({ reason: "RATE_LIMITED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout when every attempt is aborted", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    await expect(chatJson(request, { fetchImpl, sleep: noSleep })).rejects.toMatchObject({ reason: "TIMEOUT" });
  });

  it("rejects malformed JSON and refused requests without retrying", async () => {
    await expect(chatJson(request, { fetchImpl: vi.fn().mockResolvedValue(ok("not json")), sleep: noSleep })).rejects.toMatchObject({ reason: "INVALID_OUTPUT" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(chatJson(request, { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("AI extraction", () => {
  beforeEach(() => vi.stubEnv("GROQ_API_KEY", "test-key"));
  afterEach(() => vi.unstubAllEnvs());

  const f = (value: string, evidence: string, line: number | null = 3) => ({ value, evidence, line });
  const empty = { customerName: null, contactEmail: null, customerRef: null, subject: null, dueDate: null };
  const part = { partNo: null, description: null, drawingNo: null, drawingRev: null, material: null, grossWeightKg: null, netWeightKg: null, annualVolume: null, heatTreatment: null, surfaceTreatment: null };

  it("turns the model's answer into raw values with evidence and line locators", async () => {
    const answer = {
      rfq: { ...empty, dueDate: f("12/11/2026", "by 12/11/2026", 9) },
      parts: [{ ...part, partNo: f("DRV-GB-2207", "Part No: DRV-GB-2207", 4), annualVolume: f("60,000 nos", "Annual requirement: 60,000 nos", 6) }],
    };
    const res = await extractWithAi({ label: "Email", text: "L001: …" }, { fetchImpl: vi.fn().mockResolvedValue(ok(answer)), sleep: noSleep });
    expect(res.values).toEqual([
      { fieldKey: "dueDate", raw: "12/11/2026", evidence: "by 12/11/2026", locator: "line 9", part: undefined },
      { fieldKey: "partNo", raw: "DRV-GB-2207", evidence: "Part No: DRV-GB-2207", locator: "line 4", part: { partNo: "DRV-GB-2207", description: null, row: 0 } },
      { fieldKey: "annualVolume", raw: "60,000 nos", evidence: "Annual requirement: 60,000 nos", locator: "line 6", part: { partNo: "DRV-GB-2207", description: null, row: 0 } },
    ]);
  });

  it("refuses an answer that does not match the schema", async () => {
    await expect(extractWithAi({ label: "Email", text: "x" }, { fetchImpl: vi.fn().mockResolvedValue(ok({ rfq: {}, parts: "no" })), sleep: noSleep })).rejects.toMatchObject({ reason: "INVALID_OUTPUT" });
  });

  it("transcribes an image to lines", async () => {
    const res = await transcribeImage("AAAA", { fetchImpl: vi.fn().mockResolvedValue(ok({ lines: ["PART NO DRV-GB-2207", "MATERIAL 20MnCr5"] })), sleep: noSleep });
    expect(res.text).toBe("PART NO DRV-GB-2207\nMATERIAL 20MnCr5");
  });
});
