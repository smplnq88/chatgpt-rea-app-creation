import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const directory = await mkdtemp(join(tmpdir(), "moa-smoke-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
});
const errors = [];
let downloadNumber = 0;
page.on("pageerror", (error) => errors.push(error.message));
const settle = async () => {
  await page.locator(".busy-overlay").waitFor({ state: "hidden" });
};
const dimension = async () =>
  page
    .locator('canvas[aria-label="편집 중인 이미지"]')
    .evaluate((c) => ({ w: c.width, h: c.height }));
const pixel = async (x, y) =>
  page
    .locator('canvas[aria-label="편집 중인 이미지"]')
    .evaluate(
      (c, { x, y }) => [...c.getContext("2d").getImageData(x, y, 1, 1).data],
      { x, y },
    );
const upload = async (path) => {
  await page.getByLabel("이미지 파일 선택").setInputFiles(path);
  await settle();
};
async function save(format, scale = 1) {
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: format, exact: true }).click();
  await dialog
    .locator(".scale-options button")
    .filter({ hasText: `${scale}×` })
    .click();
  const waiting = page.waitForEvent("download");
  await dialog.getByRole("button", { name: `${format} 파일 저장하기` }).click();
  const download = await waiting;
  const path = join(
    directory,
    `${++downloadNumber}-${download.suggestedFilename()}`,
  );
  await download.saveAs(path);
  await settle();
  return path;
}
try {
  await page.goto(baseURL);
  await page.waitForFunction(
    () =>
      document.querySelector('canvas[aria-label="편집 중인 이미지"]')?.width ===
      1200,
  );
  assert.equal(await page.title(), "모아 스튜디오 · 나만의 이미지 작업실");
  await page.screenshot({
    path: join(directory, "desktop.png"),
    fullPage: true,
  });
  console.log("PASS editor opens with sample illustration");
  const fixture = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 100;
    c.height = 80;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 100, 80);
    ctx.fillStyle = "#e5243b";
    ctx.fillRect(42, 32, 16, 16);
    return c.toDataURL("image/png").split(",")[1];
  });
  const fixturePath = join(directory, "fixture.png");
  await writeFile(fixturePath, Buffer.from(fixture, "base64"));
  await upload(fixturePath);
  assert.deepEqual(await dimension(), { w: 100, h: 80 });
  assert.deepEqual(await pixel(50, 40), [229, 36, 59, 255]);
  // Paint exactly the small red object and reconstruct it from its white surroundings.
  await page.getByRole("button", { name: "지우기", exact: true }).click();
  if (
    await page
      .getByRole("button", { name: "주변색 채우기", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "주변색 채우기", exact: true })
      .click();
  await page.locator("#brush").fill("30");
  const canvas = page.getByLabel("지울 부분 칠하기");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page
    .getByRole("button", { name: "칠한 부분 지우기", exact: true })
    .click();
  await settle();
  assert.deepEqual(await pixel(50, 40), [255, 255, 255, 255]);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  assert.deepEqual(await pixel(50, 40), [229, 36, 59, 255]);
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  assert.deepEqual(await pixel(50, 40), [255, 255, 255, 255]);
  console.log(
    "PASS magic eraser changes selected pixels; undo/redo restore exact pixels",
  );
  await upload(fixturePath);
  await page.getByRole("button", { name: "배경 제거", exact: true }).click();
  if (
    await page
      .getByRole("button", { name: "단색 배경 제거", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "단색 배경 제거", exact: true })
      .click();
  await page.getByRole("button", { name: "배경 없애기", exact: true }).click();
  await settle();
  assert.equal((await pixel(0, 0))[3], 0);
  assert.deepEqual(await pixel(50, 40), [229, 36, 59, 255]);
  const transparentPath = await save("PNG");
  await upload(transparentPath);
  assert.equal((await pixel(0, 0))[3], 0);
  console.log(
    "PASS background removal preserves subject and PNG round-trip transparency",
  );
  const capabilities = await (
    await page.request.get(`${baseURL}/api/health`)
  ).json();
  if (capabilities.inpaintConfigured) {
    await upload(fixturePath);
    await page.getByRole("button", { name: "지우기", exact: true }).click();
    await page
      .getByRole("button", { name: "자연스럽게 지우기", exact: true })
      .click();
    const box = await page.getByLabel("지울 부분 칠하기").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page
      .getByRole("button", { name: "칠한 부분 지우기", exact: true })
      .click();
    await settle();
    const center = await pixel(50, 40);
    assert.ok(center[0] > 245 && center[1] > 245 && center[2] > 245);
    console.log("PASS natural eraser through actual OpenCV server");
  } else
    console.log("SKIP natural eraser: optional Python tools not installed");
  if (capabilities.backgroundAiConfigured) {
    await upload(
      fileURLToPath(new URL("../public/sample.svg", import.meta.url)),
    );
    await page.getByRole("button", { name: "배경 제거", exact: true }).click();
    await page
      .getByRole("button", { name: "AI로 배경 제거", exact: true })
      .click();
    await page
      .getByRole("button", { name: "배경 없애기", exact: true })
      .click();
    await settle();
    const alpha = await page.getByLabel("편집 중인 이미지").evaluate((c) => {
      const data = c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      let clear = 0,
        solid = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 10) clear++;
        if (data[i] > 245) solid++;
      }
      return { clear, solid };
    });
    assert.ok(alpha.clear > 100_000 && alpha.solid > 20_000);
    await page.screenshot({
      path: join(directory, "ai-background.png"),
      fullPage: true,
    });
    console.log(
      "PASS real AI background cutout preserves foreground with transparent background",
    );
  } else console.log("SKIP AI cutout: optional model not installed");
  await upload(transparentPath);
  await page.getByRole("button", { name: "비율 변경", exact: true }).click();
  await page.getByLabel("가로 픽셀").fill("200");
  await page.getByLabel("세로 픽셀").fill("200");
  await page.getByRole("button", { name: "크기 바꾸기", exact: true }).click();
  await settle();
  assert.deepEqual(await dimension(), { w: 200, h: 200 });
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  assert.deepEqual(await dimension(), { w: 100, h: 80 });
  console.log("PASS aspect-ratio resize and dimensional undo");
  await upload(fixturePath);
  const outputs = {};
  for (const f of ["PNG", "JPG", "PDF", "SVG"]) {
    outputs[f] = await save(f, 2);
    const bytes = await readFile(outputs[f]);
    assert.ok(bytes.length > 100);
    if (f === "PDF") assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    if (f === "SVG") assert.ok(bytes.toString().includes("<image"));
    await upload(outputs[f]);
    assert.deepEqual(await dimension(), { w: 200, h: 160 });
    await upload(fixturePath);
  }
  console.log(
    "PASS PNG/JPG/PDF/SVG downloads at 2× and imports of every exported format",
  );
  // One import of each supported type -> export to every supported type (16 format pairs).
  for (const source of ["PNG", "JPG", "PDF", "SVG"]) {
    await upload(outputs[source]);
    for (const target of ["PNG", "JPG", "PDF", "SVG"]) {
      const file = await save(target);
      assert.ok((await readFile(file)).length > 100);
    }
  }
  console.log("PASS all 16 input/output format combinations");
  const twoPagePdf = new jsPDF();
  twoPagePdf.text("Page one", 20, 20);
  twoPagePdf.addPage();
  twoPagePdf.text("Page two", 20, 20);
  const pdfPath = join(directory, "two-pages.pdf");
  await writeFile(pdfPath, Buffer.from(twoPagePdf.output("arraybuffer")));
  await upload(pdfPath);
  await page.getByRole("button", { name: "다음 PDF 페이지" }).click();
  await settle();
  assert.match(await page.locator(".pdf-pager").textContent(), /2 \/ 2/);
  await page.getByRole("button", { name: "이전 PDF 페이지" }).click();
  await settle();
  assert.match(await page.locator(".pdf-pager").textContent(), /1 \/ 2/);
  console.log("PASS PDF page selection");
  await page
    .getByRole("button", { name: "AI에게 물어보기", exact: true })
    .click();
  const health = await page.request.get(`${baseURL}/api/health`);
  assert.equal(health.status(), 200);
  if (!(await health.json()).aiConfigured) {
    await page.getByText("실제 AI를 연결해 주세요").waitFor();
    assert.ok(
      await page.getByRole("button", { name: "질문 보내기" }).isDisabled(),
    );
  }
  await page.getByRole("button", { name: "AI 대화 닫기" }).click();
  await page.getByRole("button", { name: "내 이미지", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(directory, "mobile.png"),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({
    path: join(directory, "mobile-export.png"),
    fullPage: true,
  });
  console.log("PASS AI setup status and mobile layout");
  assert.deepEqual(errors, [], "No uncaught browser errors");
  console.log(`Screenshots and exported fixtures: ${directory}`);
} finally {
  await browser.close();
}
