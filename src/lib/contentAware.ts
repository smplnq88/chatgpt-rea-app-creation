import { MAX_PIXELS } from "./imageEngine";

/** Exemplar patch synthesis: match intact neighboring texture, then copy it into the hole.
 * Bounded working resolution limits CPU use; pixels outside the painted mask never change.
 * This reconstructs visible texture and is not a generative AI model.
 */
export function contentAwareFill(
  image: ImageData,
  mask: Uint8Array,
): ImageData {
  const { width, height } = image;
  const count = width * height;
  if (count < 1 || count > MAX_PIXELS || mask.length !== count)
    throw new Error("사진과 선택 영역의 크기가 맞지 않아요.");
  let left = width,
    top = height,
    right = -1,
    bottom = -1,
    painted = 0;
  for (let i = 0; i < count; i++)
    if (mask[i]) {
      const x = i % width,
        y = Math.floor(i / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      painted++;
    }
  const output = new ImageData(
    new Uint8ClampedArray(image.data),
    width,
    height,
  );
  if (!painted) return output;
  if (painted > count * 0.4)
    throw new Error("한 번에 사진의 40%보다 작은 부분을 칠해 주세요.");
  const margin = Math.max(
    48,
    Math.min(
      160,
      Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.6),
    ),
  );
  const x0 = Math.max(0, left - margin),
    y0 = Math.max(0, top - margin);
  const rw = Math.min(width, right + margin + 1) - x0,
    rh = Math.min(height, bottom + margin + 1) - y0;
  const scale = Math.min(1, 512 / Math.max(rw, rh));
  const w = Math.max(1, Math.round(rw * scale)),
    h = Math.max(1, Math.round(rh * scale));
  const sx = rw / w,
    sy = rh / h;
  const pixels = new Uint8ClampedArray(w * h * 4),
    hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const src =
        (Math.min(height - 1, y0 + Math.floor((y + 0.5) * sy)) * width +
          Math.min(width - 1, x0 + Math.floor((x + 0.5) * sx))) *
        4;
      pixels.set(image.data.subarray(src, src + 4), (y * w + x) * 4);
    }
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++)
      if (mask[y * width + x])
        hole[
          Math.min(h - 1, Math.floor((y - y0) / sy)) * w +
            Math.min(w - 1, Math.floor((x - x0) / sx))
        ] = 1;
  const originalHole = hole.slice();
  const stride = w + 1,
    integral = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row;
    }
  }
  const radius = Math.min(3, Math.floor((Math.min(w, h) - 1) / 2));
  if (radius < 1)
    throw new Error("사진이 너무 작아요. 조금 더 큰 사진에서 사용해 주세요.");
  const clearPatch = (x: number, y: number) =>
    integral[(y + radius + 1) * stride + x + radius + 1] -
      integral[(y - radius) * stride + x + radius + 1] -
      integral[(y + radius + 1) * stride + x - radius] +
      integral[(y - radius) * stride + x - radius] ===
    0;
  const sources: number[] = [];
  for (let y = radius; y < h - radius; y++)
    for (let x = radius; x < w - radius; x++)
      if (clearPatch(x, y)) sources.push(y * w + x);
  if (!sources.length)
    throw new Error(
      "참고할 주변 무늬가 부족해요. 지울 부분을 조금 작게 칠해 주세요.",
    );
  const eachNeighbor = (i: number, visit: (n: number) => void) => {
    if (i % w) visit(i - 1);
    if (i % w < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  };
  const frontier = new Set<number>();
  let remaining = 0;
  for (let i = 0; i < hole.length; i++)
    if (hole[i]) {
      remaining++;
      eachNeighbor(i, (n) => {
        if (!hole[n]) frontier.add(i);
      });
    }
  let iteration = 0;
  while (remaining && frontier.size) {
    let target = -1,
      priority = -1;
    // Sample the frontier deterministically; do not scan the entire image per patch.
    const frontStep = Math.max(1, Math.floor(frontier.size / 96));
    let f = 0;
    for (const i of frontier) {
      if (f++ % frontStep) continue;
      const x = i % w,
        y = Math.floor(i / w);
      let known = 0,
        edge = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
          const n = yy * w + xx;
          if (!hole[n]) {
            known++;
            if (xx + 1 < w && !hole[n + 1])
              edge = Math.max(
                edge,
                Math.abs(pixels[n * 4] - pixels[(n + 1) * 4]),
              );
            if (yy + 1 < h && !hole[n + w])
              edge = Math.max(
                edge,
                Math.abs(pixels[n * 4] - pixels[(n + w) * 4]),
              );
          }
        }
      const score = known * (1 + edge / 64);
      if (score > priority) {
        priority = score;
        target = i;
      }
    }
    if (target < 0) break;
    const tx = target % w,
      ty = Math.floor(target / w);
    const knownOffsets: {
      dx: number;
      dy: number;
      index: number;
      weight: number;
    }[] = [];
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const x = tx + dx,
          y = ty + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const i = y * w + x;
        if (!hole[i])
          knownOffsets.push({
            dx,
            dy,
            index: i * 4,
            weight: originalHole[i] ? 0.4 : 1,
          });
      }
    let best = sources[0],
      bestScore = Infinity;
    const candidateStep = Math.max(1, Math.floor(sources.length / 600));
    const phase = (iteration * 37) % candidateStep;
    for (let n = phase; n < sources.length; n += candidateStep) {
      const source = sources[n],
        xx = source % w,
        yy = Math.floor(source / w);
      let score = 0,
        weight = 0;
      for (const k of knownOffsets) {
        const at = ((yy + k.dy) * w + xx + k.dx) * 4;
        for (let c = 0; c < 3; c++) {
          const d = pixels[at + c] - pixels[k.index + c];
          score += d * d * k.weight;
        }
        weight += k.weight;
      }
      score =
        score / Math.max(1, weight * 3) +
        0.00005 * ((xx - tx) ** 2 + (yy - ty) ** 2);
      if (score < bestScore) {
        bestScore = score;
        best = source;
      }
    }
    const bx = best % w,
      by = Math.floor(best / w),
      filled: number[] = [];
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const x = tx + dx,
          y = ty + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const i = y * w + x;
        if (!hole[i]) continue;
        const from = ((by + dy) * w + bx + dx) * 4;
        pixels.set(pixels.subarray(from, from + 4), i * 4);
        hole[i] = 0;
        remaining--;
        frontier.delete(i);
        filled.push(i);
      }
    for (const i of filled)
      eachNeighbor(i, (n) => {
        if (hole[n]) frontier.add(n);
      });
    iteration++;
  }
  if (remaining)
    throw new Error(
      "주변 무늬를 찾지 못했어요. 지울 부분을 더 작게 선택해 주세요.",
    );
  // Interpolate only the erased pixels back to original resolution.
  for (let y = top; y <= bottom; y++)
    for (let x = left; x <= right; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const fx = Math.max(0, Math.min(w - 1, (x - x0 + 0.5) / sx - 0.5)),
        fy = Math.max(0, Math.min(h - 1, (y - y0 + 0.5) / sy - 0.5));
      const ax = Math.floor(fx),
        ay = Math.floor(fy),
        bx = Math.min(w - 1, ax + 1),
        by = Math.min(h - 1, ay + 1),
        dx = fx - ax,
        dy = fy - ay;
      for (let c = 0; c < 4; c++)
        output.data[i * 4 + c] =
          (pixels[(ay * w + ax) * 4 + c] * (1 - dx) +
            pixels[(ay * w + bx) * 4 + c] * dx) *
            (1 - dy) +
          (pixels[(by * w + ax) * 4 + c] * (1 - dx) +
            pixels[(by * w + bx) * 4 + c] * dx) *
            dy;
    }
  return output;
}
