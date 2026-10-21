import { beforeAll, describe, expect, it } from "vitest";
import {
  computeFit,
  inpaint,
  MAX_PIXELS,
  removeBackground,
} from "./imageEngine";

beforeAll(() => {
  if (typeof ImageData === "undefined") {
    class TestImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }
    Object.defineProperty(globalThis, "ImageData", {
      value: TestImageData,
      configurable: true,
    });
  }
});

function image(width: number, height: number, color: number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(color, i * 4);
  return new ImageData(data, width, height);
}

describe("image sizing", () => {
  it("contains an entire landscape photo with transparent vertical padding", () => {
    expect(computeFit(400, 200, 200, 200, "contain")).toEqual({
      sx: 0,
      sy: 0,
      sw: 400,
      sh: 200,
      dx: 0,
      dy: 50,
      dw: 200,
      dh: 100,
    });
  });
  it("crops the center when filling a square", () => {
    expect(computeFit(400, 200, 200, 200, "cover")).toEqual({
      sx: 100,
      sy: 0,
      sw: 200,
      sh: 200,
      dx: 0,
      dy: 0,
      dw: 200,
      dh: 200,
    });
  });
  it("rejects invalid sizes before allocating canvas memory", () => {
    expect(() => computeFit(400, 200, MAX_PIXELS, 2, "contain")).toThrow();
    expect(() => computeFit(0, 200, 200, 200, "contain")).toThrow();
    expect(() => computeFit(400, 200, 200.5, 200, "contain")).toThrow();
  });
});

describe("magic eraser inpainting", () => {
  it("reconstructs a painted region from surrounding color without altering unpainted pixels", () => {
    const source = image(5, 5, [180, 120, 60, 255]);
    source.data.set([10, 240, 5, 255], 12 * 4);
    const mask = new Uint8Array(25);
    mask[12] = 255;
    const result = inpaint(source, mask);
    expect([...result.data.slice(48, 52)]).toEqual([180, 120, 60, 255]);
    expect([...result.data.slice(0, 48)]).toEqual([
      ...source.data.slice(0, 48),
    ]);
    expect(source.data[48]).toBe(10);
  });
  it("propagates through a selected region wider than one pixel", () => {
    const source = image(7, 7, [20, 70, 120, 255]);
    const mask = new Uint8Array(49);
    for (let y = 1; y < 6; y++)
      for (let x = 1; x < 6; x++) {
        mask[y * 7 + x] = 1;
        source.data.set([255, 0, 0, 255], (y * 7 + x) * 4);
      }
    expect([...inpaint(source, mask).data.slice(24 * 4, 24 * 4 + 4)]).toEqual([
      20, 70, 120, 255,
    ]);
  });
  it("rejects masks with no usable source boundary", () => {
    expect(() =>
      inpaint(image(2, 2, [255, 255, 255, 255]), new Uint8Array([1, 1, 1, 1])),
    ).toThrow();
    expect(() =>
      inpaint(image(2, 2, [255, 255, 255, 255]), new Uint8Array(3)),
    ).toThrow();
  });
});

describe("plain background removal", () => {
  it("removes edge-connected background and preserves the subject and enclosed same-color details", () => {
    const source = image(7, 7, [255, 255, 255, 255]);
    for (let y = 1; y < 6; y++)
      for (let x = 1; x < 6; x++)
        source.data.set([0, 0, 0, 255], (y * 7 + x) * 4);
    source.data.set([255, 255, 255, 255], 24 * 4);
    const result = removeBackground(source, 15);
    expect(result.data[3]).toBe(0);
    expect(result.data[(1 * 7 + 1) * 4 + 3]).toBe(255);
    expect(result.data[24 * 4 + 3]).toBe(255);
    expect(source.data[3]).toBe(255);
  });
  it("leaves an already transparent image unchanged", () => {
    const source = image(3, 3, [0, 0, 0, 0]);
    expect(removeBackground(source, 10).data).toEqual(source.data);
  });
  it("rejects unsupported tolerance values", () => {
    expect(() =>
      removeBackground(image(2, 2, [255, 255, 255, 255]), NaN),
    ).toThrow();
  });
});
