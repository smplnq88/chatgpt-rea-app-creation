export function runContentAware(
  image: ImageData,
  mask: Uint8Array,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let revokeWorkerUrl = () => {};
    const worker = new Worker(
      new URL("./contentAware.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(() => {
      finish();
      reject(
        new Error("처리가 오래 걸려요. 지울 부분을 조금 작게 칠해 주세요."),
      );
    }, 90000);
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
      revokeWorkerUrl();
    };
    worker.onmessage = (
      event: MessageEvent<{
        pixels: Uint8ClampedArray;
        width: number;
        height: number;
        error?: string;
      }>,
    ) => {
      finish();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      const { pixels, width, height } = event.data;
      resolve(new ImageData(new Uint8ClampedArray(pixels), width, height));
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error(
          "주변 무늬 편집을 시작하지 못했어요. 최신 Chrome 또는 Edge에서 다시 열어 주세요.",
        ),
      );
    };
    worker.postMessage(
      { pixels: image.data, width: image.width, height: image.height, mask },
      [image.data.buffer, mask.buffer],
    );
  });
}
