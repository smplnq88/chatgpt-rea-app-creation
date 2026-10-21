import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./index";

afterEach(() => vi.unstubAllEnvs());

describe("AI API", () => {
  it("reports no configured AI without exposing secrets and gives an actionable error", async () => {
    const app = createApp({ apiKey: "" });
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, aiConfigured: false });
    expect(typeof health.body.backgroundAiConfigured).toBe("boolean");
    expect(typeof health.body.inpaintConfigured).toBe("boolean");
    const answer = await request(app)
      .post("/api/ask")
      .send({ message: "배경을 어떻게 지워요?" });
    expect(answer.status).toBe(503);
    expect(answer.body.code).toBe("AI_NOT_CONFIGURED");
  });

  it("validates user input before contacting AI", async () => {
    const fetch = vi.fn();
    const app = createApp({ apiKey: "test-only", fetch });
    for (const body of [
      { message: "" },
      { message: "x".repeat(4001) },
      { message: "안녕", image: "https://example.com/image.png" },
    ]) {
      const result = await request(app).post("/api/ask").send(body);
      expect(result.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forwards a bounded vision question to the fixed endpoint and returns the answer", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "왼쪽의 배경 제거를 눌러 보세요." } },
            ],
          }),
          { status: 200 },
        ),
      );
    const app = createApp({ apiKey: "test-only", fetch });
    const result = await request(app)
      .post("/api/ask")
      .send({
        message: "어떻게 편집할까요?",
        image: "data:image/png;base64,AAAA",
        history: [{ role: "user", content: "사진이 있어요" }],
      });
    expect(result.status).toBe(200);
    expect(result.body.reply).toContain("배경 제거");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.messages.at(-1).content[1].image_url.url).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(JSON.stringify(result.body)).not.toContain("test-only");
  });

  it("limits repeated questions and does not leak upstream authentication errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("private upstream diagnostic", { status: 401 }),
      );
    const app = createApp({ apiKey: "test-only", fetch, rateLimit: 1 });
    const first = await request(app).post("/api/ask").send({ message: "도움" });
    expect(first.status).toBe(502);
    expect(JSON.stringify(first.body)).not.toContain(
      "private upstream diagnostic",
    );
    const second = await request(app)
      .post("/api/ask")
      .send({ message: "다시 도움" });
    expect(second.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Local image tools", () => {
  const image = "data:image/png;base64,AAAA";

  it("reports unavailable local tools honestly", async () => {
    const app = createApp({
      imageToolsAvailable: false,
      backgroundModelAvailable: false,
    });
    const health = await request(app).get("/api/health");
    expect(health.body.backgroundAiConfigured).toBe(false);
    expect(health.body.inpaintConfigured).toBe(false);
    expect(
      (await request(app).post("/api/remove-background").send({ image }))
        .status,
    ).toBe(503);
    expect(
      (await request(app).post("/api/erase").send({ image, mask: image }))
        .status,
    ).toBe(503);
  });

  it("validates input and routes fixed image operations to the local worker", async () => {
    const imageWorker = vi.fn().mockResolvedValue({ image });
    const app = createApp({
      imageToolsAvailable: true,
      backgroundModelAvailable: true,
      imageWorker,
    });
    expect(
      (
        await request(app)
          .post("/api/remove-background")
          .send({ image: "https://example.com/photo" })
      ).status,
    ).toBe(400);
    expect(imageWorker).not.toHaveBeenCalled();
    const background = await request(app)
      .post("/api/remove-background")
      .send({ image });
    expect(background.status).toBe(200);
    expect(background.body.image).toBe(image);
    expect(imageWorker).toHaveBeenLastCalledWith("background", { image });
    const erase = await request(app)
      .post("/api/erase")
      .send({ image, mask: image });
    expect(erase.status).toBe(200);
    expect(imageWorker).toHaveBeenLastCalledWith("erase", {
      image,
      mask: image,
    });
  });

  it("releases the worker lock after a failure without exposing diagnostics", async () => {
    const imageWorker = vi
      .fn()
      .mockRejectedValueOnce(new Error("private worker path"))
      .mockResolvedValueOnce({ image });
    const app = createApp({
      imageToolsAvailable: true,
      backgroundModelAvailable: true,
      imageWorker,
    });
    const failed = await request(app)
      .post("/api/remove-background")
      .send({ image });
    expect(failed.status).toBe(422);
    expect(JSON.stringify(failed.body)).not.toContain("private worker path");
    expect(
      (await request(app).post("/api/remove-background").send({ image }))
        .status,
    ).toBe(200);
  });
});
