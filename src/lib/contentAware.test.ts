import { beforeAll, describe, it, expect } from "vitest";
import { contentAwareFill } from "./contentAware";
import { inpaint } from "./imageEngine";
beforeAll(() => {
  if (typeof ImageData === "undefined")
    Object.defineProperty(globalThis, "ImageData", {
      value: class {
        constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number,
        ) {}
      },
      configurable: true,
    });
});
function fixture() {
  const w = 96,
    h = 80,
    data = new Uint8ClampedArray(w * h * 4),
    mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const value = y % 12 < 6 ? 55 : 205;
      data.set([value, value + 15, value + 25, 255], (y * w + x) * 4);
      if (x >= 38 && x < 58 && y >= 24 && y < 56) mask[y * w + x] = 1;
    }
  return { original: new ImageData(data, w, h), mask };
}
describe("surrounding texture reconstruction", () => {
  it("restores repeating background texture instead of smearing its colors", () => {
    const { original, mask } = fixture();
    const damaged = new ImageData(
      original.data.slice(),
      original.width,
      original.height,
    );
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) damaged.data.set([255, 0, 0, 255], i * 4);
    const result = contentAwareFill(damaged, mask),
      simple = inpaint(damaged, mask);
    let textureError = 0,
      simpleError = 0;
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        textureError += Math.abs(result.data[i * 4] - original.data[i * 4]);
        simpleError += Math.abs(simple.data[i * 4] - original.data[i * 4]);
      }
    expect(textureError).toBeLessThan(simpleError * 0.5);
    const levels = new Set<number>();
    for (let y = 28; y < 52; y++) levels.add(result.data[(y * 96 + 48) * 4]);
    expect(levels.size).toBeGreaterThan(1);
  });
  it("keeps every unselected pixel and the input unchanged", () => {
    const { original, mask } = fixture();
    const before = original.data.slice();
    const result = contentAwareFill(original, mask);
    for (let i = 0; i < mask.length; i++)
      if (!mask[i])
        expect([...result.data.subarray(i * 4, i * 4 + 4)]).toEqual([
          ...before.subarray(i * 4, i * 4 + 4),
        ]);
    expect(original.data).toEqual(before);
  });
  it("does not change an image when nothing is selected", () => {
    const { original, mask } = fixture();
    mask.fill(0);
    expect(contentAwareFill(original, mask).data).toEqual(original.data);
  });
  it("rejects an oversized selection and mismatched mask", () => {
    const { original, mask } = fixture();
    mask.fill(1);
    expect(() => contentAwareFill(original, mask)).toThrow("40%");
    expect(() => contentAwareFill(original, new Uint8Array(1))).toThrow();
  });
});
