/** Browser-only, local image operations. No image data leaves the device. */
export const MAX_PIXELS = 32_000_000;

function dimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_PIXELS
  ) {
    throw new Error(
      "이미지가 너무 큽니다. 가로·세로 크기를 줄여 주세요. (최대 3,200만 화소)",
    );
  }
}

function clone(image: ImageData) {
  dimensions(image.width, image.height);
  return new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
}

export function computeFit(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  mode: "contain" | "cover",
) {
  dimensions(srcW, srcH);
  dimensions(targetW, targetH);
  if (mode !== "contain" && mode !== "cover")
    throw new Error("지원하지 않는 크기 조절 방식입니다.");
  const scale =
    mode === "contain"
      ? Math.min(targetW / srcW, targetH / srcH)
      : Math.max(targetW / srcW, targetH / srcH);
  if (mode === "contain") {
    const dw = srcW * scale,
      dh = srcH * scale;
    return {
      sx: 0,
      sy: 0,
      sw: srcW,
      sh: srcH,
      dx: (targetW - dw) / 2,
      dy: (targetH - dh) / 2,
      dw,
      dh,
    };
  }
  const sw = targetW / scale,
    sh = targetH / scale;
  return {
    sx: (srcW - sw) / 2,
    sy: (srcH - sh) / 2,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: targetW,
    dh: targetH,
  };
}

export function resizeCanvas(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  mode: "contain" | "cover",
) {
  const fit = computeFit(source.width, source.height, width, height, mode);
  const result = document.createElement("canvas");
  result.width = width;
  result.height = height;
  const context = result.getContext("2d");
  if (!context)
    throw new Error("브라우저에서 이미지 편집을 시작할 수 없습니다.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    fit.sx,
    fit.sy,
    fit.sw,
    fit.sh,
    fit.dx,
    fit.dy,
    fit.dw,
    fit.dh,
  );
  return result;
}

/** High quality browser resampling; this does not invent AI texture/details. */
export function upscaleCanvas(source: HTMLCanvasElement, scale: 1 | 2 | 4) {
  if (![1, 2, 4].includes(scale))
    throw new Error("확대 배율은 1배, 2배, 4배 중에서 골라 주세요.");
  return resizeCanvas(
    source,
    source.width * scale,
    source.height * scale,
    "contain",
  );
}

function neighbors(
  index: number,
  width: number,
  height: number,
  visit: (neighbor: number) => void,
) {
  if (index % width > 0) visit(index - 1);
  if (index % width < width - 1) visit(index + 1);
  if (index >= width) visit(index - width);
  if (index < width * (height - 1)) visit(index + width);
}

/** Fill the painted region from its surrounding pixels, then soften seams. */
export function inpaint(image: ImageData, mask: Uint8Array) {
  const result = clone(image);
  const { width, height } = image,
    count = width * height;
  if (mask.length !== count)
    throw new Error("지우기 영역과 사진 크기가 맞지 않습니다.");
  let painted = 0;
  for (const value of mask) if (value) painted++;
  if (!painted) return result;
  if (painted === count)
    throw new Error("사진 전체를 지울 수는 없습니다. 지울 부분만 칠해 주세요.");
  const ready = new Uint8Array(count);
  const queued = new Uint8Array(count);
  const queue = new Int32Array(painted);
  for (let i = 0; i < count; i++) ready[i] = mask[i] ? 0 : 1;
  let head = 0,
    tail = 0;
  for (let i = 0; i < count; i++) {
    if (!mask[i]) continue;
    let touches = false;
    neighbors(i, width, height, (n) => {
      if (ready[n]) touches = true;
    });
    if (touches) {
      queued[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const index = queue[head++];
    const sum = [0, 0, 0, 0];
    let weight = 0;
    neighbors(index, width, height, (n) => {
      if (!ready[n]) return;
      for (let channel = 0; channel < 4; channel++)
        sum[channel] += result.data[n * 4 + channel];
      weight++;
    });
    for (let channel = 0; channel < 4; channel++)
      result.data[index * 4 + channel] = sum[channel] / weight;
    ready[index] = 1;
    neighbors(index, width, height, (n) => {
      if (mask[n] && !queued[n]) {
        queued[n] = 1;
        queue[tail++] = n;
      }
    });
  }
  // Jacobi relaxation changes only selected pixels; preserve all original surroundings.
  const next = new Uint8ClampedArray(painted * 4);
  for (let pass = 0; pass < 8; pass++) {
    for (let q = 0; q < tail; q++) {
      const index = queue[q],
        sum = [0, 0, 0, 0];
      let weight = 0;
      neighbors(index, width, height, (n) => {
        for (let channel = 0; channel < 4; channel++)
          sum[channel] += result.data[n * 4 + channel];
        weight++;
      });
      for (let channel = 0; channel < 4; channel++)
        next[q * 4 + channel] = sum[channel] / weight;
    }
    for (let q = 0; q < tail; q++) {
      for (let channel = 0; channel < 4; channel++)
        result.data[queue[q] * 4 + channel] = next[q * 4 + channel];
    }
  }
  return result;
}

/** Remove a dominant, edge-connected background. Best on plain backgrounds. */
export function removeBackground(image: ImageData, tolerance: number) {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100)
    throw new Error("배경 제거 강도는 0부터 100까지 골라 주세요.");
  const result = clone(image);
  const { width, height } = image,
    count = width * height;
  const buckets = new Map<
    number,
    { count: number; r: number; g: number; b: number }
  >();
  const edges: number[] = [];
  for (let x = 0; x < width; x++) {
    edges.push(x);
    if (height > 1) edges.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    edges.push(y * width);
    if (width > 1) edges.push(y * width + width - 1);
  }
  for (const index of edges) {
    const o = index * 4;
    if (image.data[o + 3] < 16) continue;
    const r = image.data[o],
      g = image.data[o + 1],
      b = image.data[o + 2];
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let dominant: { count: number; r: number; g: number; b: number } | undefined;
  for (const bucket of buckets.values())
    if (!dominant || bucket.count > dominant.count) dominant = bucket;
  if (!dominant) return result;
  const background = [
    dominant.r / dominant.count,
    dominant.g / dominant.count,
    dominant.b / dominant.count,
  ];
  const limit = (tolerance / 100) * Math.sqrt(3 * 255 * 255);
  const feather = 12;
  const visited = new Uint8Array(count),
    queue = new Int32Array(count);
  let head = 0,
    tail = 0;
  const enqueue = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    const o = index * 4;
    const distance = Math.hypot(
      image.data[o] - background[0],
      image.data[o + 1] - background[1],
      image.data[o + 2] - background[2],
    );
    if (image.data[o + 3] < 16 || distance <= limit + feather) {
      result.data[o + 3] =
        image.data[o + 3] *
        Math.max(0, Math.min(1, (distance - limit) / feather));
      queue[tail++] = index;
    }
  };
  for (const index of edges) enqueue(index);
  while (head < tail) neighbors(queue[head++], width, height, enqueue);
  return result;
}
