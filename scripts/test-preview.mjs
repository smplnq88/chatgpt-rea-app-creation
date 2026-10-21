import { chromium } from "playwright-core";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const directory = await mkdtemp(join(tmpdir(), "moa-context-"));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (/^https?:/.test(r.url())) external.push(r.url());
});
try {
  // setContent uses the actual downloaded file bytes; this cloud's browser policy blocks file:// navigation.
  await page.setContent(
    await readFile(process.env.PREVIEW_HTML_PATH || "preview.htm", "utf8"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('canvas[aria-label="편집 중인 이미지"]')?.width ===
      1200,
  );
  const fixture = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 120;
    const ctx = c.getContext("2d");
    for (let y = 0; y < 120; y++) {
      const n = y % 12 < 6 ? 55 : 205;
      ctx.fillStyle = `rgb(${n},${n + 15},${n + 25})`;
      ctx.fillRect(0, y, 160, 1);
    }
    ctx.fillStyle = "red";
    ctx.fillRect(70, 45, 20, 30);
    return c.toDataURL().split(",")[1];
  });
  const filename = join(directory, "striped-wall.png");
  await writeFile(filename, Buffer.from(fixture, "base64"));
  await page.getByLabel("이미지 파일 선택").setInputFiles(filename);
  await page.locator(".busy-overlay").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "지우기", exact: true }).click();
  const mode = page.getByRole("button", {
    name: "주변 환경에 맞추기",
    exact: true,
  });
  await mode.waitFor();
  assert.match(await mode.getAttribute("class"), /selected/);
  await page.locator("#brush").fill("40");
  const box = await page.getByLabel("지울 부분 칠하기").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page
    .getByRole("button", { name: "칠한 부분 지우기", exact: true })
    .click();
  await page
    .locator(".busy-overlay")
    .waitFor({ state: "hidden", timeout: 90000 });
  const measured = await page.getByLabel("편집 중인 이미지").evaluate((c) => {
    const ctx = c.getContext("2d");
    let error = 0;
    const levels = new Set();
    for (let y = 46; y < 74; y++)
      for (let x = 71; x < 89; x++) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        error += Math.abs(p[0] - (y % 12 < 6 ? 55 : 205));
        levels.add(p[0]);
      }
    return {
      meanError: error / (28 * 18),
      levels: levels.size,
      outer: [...ctx.getImageData(5, 5, 1, 1).data],
    };
  });
  console.log(
    "UI message:",
    await page.locator(".toast").textContent(),
    "errors:",
    errors,
  );
  assert.ok(measured.meanError < 25, JSON.stringify(measured));
  assert.ok(measured.levels > 1);
  assert.deepEqual(measured.outer, [55, 70, 80, 255]);
  await page.screenshot({
    path: join(directory, "context-after.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  assert.deepEqual(
    await page
      .getByLabel("편집 중인 이미지")
      .evaluate((c) => [...c.getContext("2d").getImageData(80, 60, 1, 1).data]),
    [255, 0, 0, 255],
  );
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await page.getByRole("button", { name: "저장하기", exact: true }).click();
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "PNG 파일 저장하기" })
    .click();
  const dl = await waiting;
  await dl.saveAs(join(directory, "result.png"));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS surrounding-environment mode: actual browser worker restores striped texture, preserves surroundings, undo/redo and PNG save work offline.",
    JSON.stringify(measured),
  );
  console.log("Screenshots:", directory);
} finally {
  await browser.close();
}
