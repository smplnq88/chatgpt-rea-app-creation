import { contentAwareFill } from "./contentAware";
self.onmessage = (
  event: MessageEvent<{
    pixels: Uint8ClampedArray;
    width: number;
    height: number;
    mask: Uint8Array;
  }>,
) => {
  try {
    const { pixels, width, height, mask } = event.data;
    const result = contentAwareFill(
      new ImageData(new Uint8ClampedArray(pixels), width, height),
      mask,
    );
    self.postMessage(
      { pixels: result.data, width, height },
      { transfer: [result.data.buffer] },
    );
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "주변 무늬를 채우지 못했어요.",
    });
  }
};
