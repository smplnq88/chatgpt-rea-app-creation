import DOMPurify from "dompurify";
import { MAX_PIXELS, upscaleCanvas } from "./imageEngine";

export type ExportFormat = "PNG" | "JPG" | "PDF" | "SVG";
export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 0.94,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              new Error(
                "사진을 저장하지 못했어요. 크기를 줄여 다시 시도해 주세요.",
              ),
            ),
      type,
      quality,
    ),
  );
}
export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("이 이미지를 열 수 없어요. 다른 파일을 선택해 주세요."));
    image.src = url;
  });
}
export function makeCanvas(w: number, h: number) {
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w * h > MAX_PIXELS
  )
    throw new Error("이미지는 최대 3,200만 화소까지 만들 수 있어요.");
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
export async function openFile(
  file: File,
  page = 1,
): Promise<{ canvas: HTMLCanvasElement; pages: number }> {
  if (file.size > 40 * 1024 * 1024)
    throw new Error("40MB보다 작은 파일을 선택해 주세요.");
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pdf = await task.promise;
    try {
      const p = await pdf.getPage(Math.max(1, Math.min(page, pdf.numPages)));
      const base = p.getViewport({ scale: 1 });
      // Match standard 96-DPI image pixels to PDF's 72-point coordinates.
      const scale = Math.min(
        96 / 72,
        Math.sqrt(MAX_PIXELS / (base.width * base.height)),
      );
      const view = p.getViewport({ scale });
      const canvas = makeCanvas(
        Math.max(1, Math.floor(view.width)),
        Math.max(1, Math.floor(view.height)),
      );
      await p.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport: view,
      }).promise;
      return { canvas, pages: pdf.numPages };
    } finally {
      await task.destroy();
    }
  }
  if (!["png", "jpg", "jpeg", "webp", "svg"].includes(ext || ""))
    throw new Error("PNG, JPG, WEBP, SVG 또는 PDF 파일을 선택해 주세요.");
  let blob: Blob = file;
  if (ext === "svg") {
    const clean = DOMPurify.sanitize(await file.text(), {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["foreignObject", "script", "style", "animate", "set"],
    });
    const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
    if (
      doc.querySelector("parsererror") ||
      doc.documentElement.localName !== "svg"
    )
      throw new Error("올바른 SVG 파일이 아니에요.");
    for (const element of doc.querySelectorAll("*")) {
      for (const a of [...element.attributes]) {
        if (
          (a.localName === "href" &&
            !a.value.startsWith("#") &&
            !a.value.startsWith("data:image/")) ||
          /url\(\s*['"]?(?!#)/i.test(a.value)
        )
          element.removeAttribute(a.name);
      }
    }
    blob = new Blob([new XMLSerializer().serializeToString(doc)], {
      type: "image/svg+xml",
    });
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = makeCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext("2d")!.drawImage(img, 0, 0);
    return { canvas: c, pages: 1 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function exportImage(
  source: HTMLCanvasElement,
  format: ExportFormat,
  scale: 1 | 2 | 4,
  name: string,
  quality: number,
  transparent: boolean,
): Promise<{ blob: Blob; filename: string }> {
  const canvas = upscaleCanvas(source, scale);
  if (!transparent || format === "JPG" || format === "PDF") {
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
  }
  const filename =
    (name
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
      .trim() || "모아-이미지") +
    "." +
    format.toLowerCase();
  if (format === "PDF") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? "landscape" : "portrait",
      unit: "px",
      format: [canvas.width, canvas.height],
      hotfixes: ["px_scaling"],
    });
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return { blob: pdf.output("blob"), filename };
  }
  if (format === "SVG") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image width="${canvas.width}" height="${canvas.height}" href="${canvas.toDataURL("image/png")}"/></svg>`;
    return { blob: new Blob([svg], { type: "image/svg+xml" }), filename };
  }
  return {
    blob: await canvasBlob(
      canvas,
      format === "JPG" ? "image/jpeg" : "image/png",
      quality,
    ),
    filename,
  };
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
