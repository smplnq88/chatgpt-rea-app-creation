import { useCallback, useEffect, useRef, useState } from "react";
import { runContentAware } from "./lib/runContentAware";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Crop,
  Download,
  Eraser,
  Expand,
  FileImage,
  FileText,
  ImagePlus,
  Layers3,
  Loader2,
  Maximize,
  MessageCircle,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import {
  inpaint,
  MAX_PIXELS,
  removeBackground,
  resizeCanvas,
} from "./lib/imageEngine";
import {
  downloadBlob,
  exportImage,
  loadImage,
  makeCanvas,
  openFile,
  type ExportFormat,
} from "./lib/files";

type Tool = "home" | "erase" | "background" | "resize" | "convert";
type ChatMessage = { role: "user" | "assistant"; content: string };
const TOOLS = [
  { id: "home", icon: ImagePlus, label: "내 이미지" },
  { id: "erase", icon: Eraser, label: "지우기" },
  { id: "background", icon: Layers3, label: "배경 제거" },
  { id: "resize", icon: Crop, label: "비율 변경" },
  { id: "convert", icon: FileImage, label: "파일 변환" },
] as const;
const PRESETS = [
  {
    name: "정사각형",
    label: "1:1",
    w: 1080,
    h: 1080,
    sub: "인스타그램 게시물",
  },
  { name: "세로형", label: "4:5", w: 1080, h: 1350, sub: "피드 · 제품 사진" },
  {
    name: "스토리",
    label: "9:16",
    w: 1080,
    h: 1920,
    sub: "릴스 · 모바일 배경",
  },
  {
    name: "가로형",
    label: "16:9",
    w: 1920,
    h: 1080,
    sub: "유튜브 · 프레젠테이션",
  },
];
const titles: Record<Tool, { title: string; sub: string }> = {
  home: {
    title: "나만의 이미지 작업실",
    sub: "작은 아이디어를, 마음에 드는 이미지로.",
  },
  erase: {
    title: "필요 없는 부분은 쓱 지워요",
    sub: "사진에서 지울 부분을 브러시로 칠해 주세요.",
  },
  background: {
    title: "주인공만 남겨 보세요",
    sub: "배경은 없애고, 사진 속 주인공만 남겨 보세요.",
  },
  resize: {
    title: "어디에나 딱 맞는 크기로",
    sub: "원하는 비율을 고르고 크기를 바꿔 보세요.",
  },
  convert: {
    title: "원하는 파일로 바꿔요",
    sub: "이미지 한 장으로, 다양한 형식으로 저장하세요.",
  },
};

export default function App() {
  const [tool, setTool] = useState<Tool>("home");
  const [name, setName] = useState("morning-calm");
  const [dims, setDims] = useState({ w: 1200, h: 1200 });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [brush, setBrush] = useState(45);
  const [hasMask, setHasMask] = useState(false);
  const [tolerance, setTolerance] = useState(22);
  const [backgroundAi, setBackgroundAi] = useState(false);
  const [inpaintReady, setInpaintReady] = useState(false);
  const [bgMode, setBgMode] = useState<"simple" | "ai">("simple");
  const [eraseMode, setEraseMode] = useState<"context" | "simple" | "smart">(
    "context",
  );
  const [size, setSize] = useState({ w: 1080, h: 1080 });
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [preset, setPreset] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("PNG");
  const [scale, setScale] = useState<1 | 2 | 4>(1);
  const [quality, setQuality] = useState(94);
  const [transparent, setTransparent] = useState(true);
  const [exportName, setExportName] = useState("morning-calm");
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const [pdf, setPdf] = useState<{
    file: File;
    page: number;
    pages: number;
  } | null>(null);
  const [drag, setDrag] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [attach, setAttach] = useState(false);
  const [help, setHelp] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLCanvasElement | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const past = useRef<ImageData[]>([]);
  const future = useRef<ImageData[]>([]);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ w: 700, h: 650 });
  const chatEnd = useRef<HTMLDivElement>(null);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((r) => {
        setAiConfigured(r.aiConfigured === true);
        setBackgroundAi(r.backgroundAiConfigured === true);
        setInpaintReady(r.inpaintConfigured === true);
      })
      .catch(() => setAiConfigured(false));
  }, [aiOpen]);
  useEffect(() => {
    if (backgroundAi) setBgMode("ai");
  }, [backgroundAi]);
  useEffect(() => {
    if (!exportOpen && !help) return;
    const prior = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const first = modal?.querySelector<HTMLElement>("input,button");
    const timer = setTimeout(() => first?.focus(), 0);
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setExportOpen(false);
        setHelp(false);
      }
      if (event.key !== "Tab" || !modal) return;
      const elements = [
        ...modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ];
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handler);
      prior?.focus();
    };
  }, [exportOpen, help, busy]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, sending]);
  useEffect(() => {
    const target = workspace.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const repaint = useCallback(() => {
    if (!doc.current || !view.current) return;
    view.current.width = doc.current.width;
    view.current.height = doc.current.height;
    view.current.getContext("2d")!.drawImage(doc.current, 0, 0);
  }, []);
  const clearMask = useCallback(() => {
    const c = overlay.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasMask(false);
  }, []);
  const updateCounts = () =>
    setHistoryCounts({
      past: past.current.length,
      future: future.current.length,
    });
  const pushHistory = () => {
    if (!doc.current) return;
    const c = doc.current;
    past.current.push(
      c.getContext("2d")!.getImageData(0, 0, c.width, c.height),
    );
    const max = Math.max(
      1,
      Math.min(6, Math.floor((128 * 1024 * 1024) / (c.width * c.height * 4))),
    );
    while (past.current.length > max) past.current.shift();
    future.current = [];
    updateCounts();
  };
  const setDocument = useCallback(
    (canvas: HTMLCanvasElement) => {
      doc.current = canvas;
      setDims({ w: canvas.width, h: canvas.height });
      setLoaded(true);
      clearMask();
      repaint();
    },
    [clearMask, repaint],
  );
  useEffect(() => {
    let cancelled = false;
    loadImage("/sample.svg")
      .then((img) => {
        if (cancelled) return;
        const c = makeCanvas(img.naturalWidth, img.naturalHeight);
        c.getContext("2d")!.drawImage(img, 0, 0);
        setDocument(c);
      })
      .catch((e) => notify(e.message, true));
    return () => {
      cancelled = true;
    };
  }, [setDocument, notify]);
  useEffect(() => {
    if (overlay.current) {
      overlay.current.width = dims.w;
      overlay.current.height = dims.h;
    }
    setHasMask(false);
  }, [dims.w, dims.h]);
  useEffect(() => {
    if (tool !== "erase") {
      clearMask();
      setCursor(null);
    }
  }, [tool, clearMask]);
  const run = async (label: string, task: () => Promise<void> | void) => {
    setBusy(label);
    await new Promise((r) => setTimeout(r, 30));
    try {
      await task();
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "문제가 생겼어요. 다시 시도해 주세요.",
        true,
      );
    } finally {
      setBusy("");
    }
  };
  const undo = (redo = false) => {
    if (busy || !doc.current) return;
    const from = redo ? future.current : past.current;
    const to = redo ? past.current : future.current;
    const target = from.pop();
    if (!target) return;
    to.push(
      doc.current
        .getContext("2d")!
        .getImageData(0, 0, doc.current.width, doc.current.height),
    );
    const c = makeCanvas(target.width, target.height);
    c.getContext("2d")!.putImageData(target, 0, 0);
    setDocument(c);
    clearMask();
    updateCounts();
  };
  const importFile = (file: File, page = 1) =>
    run("이미지를 여는 중이에요", async () => {
      const result = await openFile(file, page);
      past.current = [];
      future.current = [];
      updateCounts();
      setDocument(result.canvas);
      clearMask();
      setName(file.name.replace(/\.[^.]+$/, ""));
      setExportName(file.name.replace(/\.[^.]+$/, ""));
      setZoom(1);
      setPdf(
        file.name.toLowerCase().endsWith(".pdf")
          ? { file, page, pages: result.pages }
          : null,
      );
      notify(
        `${file.name}${result.pages > 1 ? ` · ${page}/${result.pages}쪽` : ""}을 열었어요.`,
      );
    });
  const brushPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * dims.w) / rect.width,
      y: ((event.clientY - rect.top) * dims.h) / rect.height,
    };
  };
  const paint = (p: { x: number; y: number }) => {
    const ctx = overlay.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "rgba(142,88,255,0.7)";
    ctx.fillStyle = "rgba(142,88,255,0.7)";
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (lastPoint.current) {
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, brush / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPoint.current = p;
    setHasMask(true);
  };
  const serverEdit = async (endpoint: string, mask?: HTMLCanvasElement) => {
    if (!doc.current) throw new Error("사진을 먼저 올려 주세요.");
    const image = doc.current.toDataURL("image/png");
    if (image.length > 10_000_000)
      throw new Error("고급 편집을 위해 사진 크기를 먼저 줄여 주세요.");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        ...(mask ? { mask: mask.toDataURL("image/png") } : {}),
      }),
      signal: AbortSignal.timeout(125_000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "사진을 처리하지 못했어요.");
    const img = await loadImage(result.image);
    const canvas = makeCanvas(img.naturalWidth, img.naturalHeight);
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas;
  };
  const erase = () =>
    run("선택한 부분을 자연스럽게 채우는 중이에요", async () => {
      if (!doc.current || !overlay.current || !hasMask) return;
      const c = doc.current;
      const data = overlay.current
        .getContext("2d")!
        .getImageData(0, 0, dims.w, dims.h);
      const mask = new Uint8Array(dims.w * dims.h);
      for (let i = 0; i < mask.length; i++)
        mask[i] = data.data[i * 4 + 3] > 0 ? 1 : 0;
      const count = mask.reduce((a, b) => a + b, 0);
      if (count > mask.length * 0.4)
        throw new Error("한 번에 사진의 40%보다 작은 부분을 칠해 주세요.");
      if (eraseMode === "context") {
        const result = await runContentAware(
          c.getContext("2d")!.getImageData(0, 0, dims.w, dims.h),
          mask,
        );
        pushHistory();
        c.getContext("2d")!.putImageData(result, 0, 0);
        repaint();
      } else if (eraseMode === "smart" && inpaintReady) {
        const m = makeCanvas(dims.w, dims.h);
        const ctx = m.getContext("2d")!;
        ctx.drawImage(overlay.current, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, dims.w, dims.h);
        const result = await serverEdit("/api/erase", m);
        pushHistory();
        setDocument(result);
      } else {
        const result = inpaint(
          c.getContext("2d")!.getImageData(0, 0, dims.w, dims.h),
          mask,
        );
        pushHistory();
        c.getContext("2d")!.putImageData(result, 0, 0);
        repaint();
      }
      clearMask();
      notify("선택한 부분을 지웠어요. 마음에 들지 않으면 되돌릴 수 있어요.");
    });
  const removeBg = () =>
    run(
      bgMode === "ai"
        ? "AI가 사진의 주인공을 찾는 중이에요"
        : "가장자리 배경을 없애는 중이에요",
      async () => {
        if (!doc.current) return;
        if (bgMode === "ai") {
          const result = await serverEdit("/api/remove-background");
          pushHistory();
          setDocument(result);
          notify("AI가 배경을 없앴어요. 투명한 PNG로 저장해 보세요.");
          return;
        }
        const c = doc.current;
        const original = c.getContext("2d")!.getImageData(0, 0, dims.w, dims.h);
        const result = removeBackground(original, tolerance);
        let changed = false;
        for (let i = 3; i < result.data.length; i += 4)
          if (result.data[i] !== original.data[i]) {
            changed = true;
            break;
          }
        if (!changed) {
          notify(
            "제거할 단색 배경을 찾지 못했어요. 비슷한 색 범위를 넓혀 보세요.",
            true,
          );
          return;
        }
        pushHistory();
        c.getContext("2d")!.putImageData(result, 0, 0);
        repaint();
        notify("배경을 없앴어요. 투명하게 저장하려면 PNG를 선택하세요.");
      },
    );
  const resize = () =>
    run("이미지 크기를 바꾸는 중이에요", () => {
      if (!doc.current) return;
      const c = resizeCanvas(doc.current, size.w, size.h, fitMode);
      pushHistory();
      setDocument(c);
      clearMask();
      setZoom(1);
      notify(`${size.w} × ${size.h} 크기로 바꿨어요.`);
    });
  const openExport = (f?: ExportFormat) => {
    if (f) setFormat(f);
    setExportName(name);
    setExportOpen(true);
  };
  const download = () =>
    run("저장할 파일을 만드는 중이에요", async () => {
      if (!doc.current) return;
      const result = await exportImage(
        doc.current,
        format,
        scale,
        exportName,
        quality / 100,
        transparent,
      );
      downloadBlob(result.blob, result.filename);
      setExportOpen(false);
      notify(`${result.filename} 파일을 저장했어요.`);
    });
  const ask = async (text = question) => {
    if (!text.trim() || sending) return;
    if (!aiConfigured) {
      notify(
        "AI 연결이 아직 필요해요. 오른쪽의 연결 안내를 확인해 주세요.",
        true,
      );
      return;
    }
    const current = text.trim();
    setQuestion("");
    setSending(true);
    setChat((m) => [...m, { role: "user", content: current }]);
    try {
      let image: string | undefined;
      if (attach && doc.current) {
        const small = makeCanvas(
          Math.max(
            1,
            Math.round(dims.w * Math.min(1, 768 / Math.max(dims.w, dims.h))),
          ),
          Math.max(
            1,
            Math.round(dims.h * Math.min(1, 768 / Math.max(dims.w, dims.h))),
          ),
        );
        small
          .getContext("2d")!
          .drawImage(doc.current, 0, 0, small.width, small.height);
        image = small.toDataURL("image/jpeg", 0.8);
      }
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: current,
          image,
          history: chat.slice(-12),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "AI와 연결하지 못했어요.");
      setChat((m) => [...m, { role: "assistant", content: result.reply }]);
    } catch (e) {
      notify(e instanceof Error ? e.message : "AI에 연결하지 못했어요.", true);
      setQuestion(current);
      setChat((m) => m.slice(0, -1));
    } finally {
      setSending(false);
    }
  };
  const fit =
    Math.min((available.w - 90) / dims.w, (available.h - 90) / dims.h, 1) *
    zoom;
  const displayW = Math.max(40, dims.w * Math.max(0.04, fit));
  const displayH = Math.max(40, dims.h * Math.max(0.04, fit));
  const sizeValid =
    Number.isInteger(size.w) &&
    Number.isInteger(size.h) &&
    size.w > 0 &&
    size.h > 0 &&
    size.w * size.h <= MAX_PIXELS;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDrag(true);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!busy && e.dataTransfer.files[0])
          void importFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg,.pdf"
        aria-label="이미지 파일 선택"
        disabled={!!busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <a
          href="#"
          className="brand"
          aria-label="모아 스튜디오 홈"
          onClick={(e) => {
            e.preventDefault();
            setTool("home");
          }}
        >
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            모아<span className="brand-light">스튜디오</span>
            <small>MOA STUDIO</small>
          </span>
        </a>
        <div className="document-name">
          <span className="header-divider" />
          <input
            aria-label="작업 이름"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="draft-tag">내 작업</span>
        </div>
        <div className="top-actions">
          <span className="local-badge">
            <ShieldCheck size={14} />
            원본을 지키는 편집
          </span>
          <button
            className="button quiet ai-top"
            onClick={() => setAiOpen((v) => !v)}
          >
            <Sparkles size={16} />
            AI에게 물어보기
          </button>
          <button
            className="button primary"
            disabled={!loaded || !!busy}
            onClick={() => openExport()}
          >
            <Download size={16} />
            저장하기
            <ChevronDown size={14} />
          </button>
        </div>
      </header>
      <div className="main-layout">
        <nav className="rail" aria-label="편집 도구">
          {TOOLS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              className={`rail-item ${tool === id ? "active" : ""}`}
              onClick={() => setTool(id)}
              disabled={!!busy}
            >
              <span className="rail-icon">
                <Icon size={21} />
              </span>
              <span>{label}</span>
              {tool === id && <i />}
            </button>
          ))}
          <div className="rail-bottom">
            <button className="rail-item" onClick={() => setHelp(true)}>
              <span className="rail-icon">
                <CircleHelp size={21} />
              </span>
              <span>사용 안내</span>
            </button>
            <span className="avatar">나</span>
          </div>
        </nav>
        <aside className="tool-panel">
          <div className="panel-heading">
            <span className="eyebrow">YOUR CREATIVE SPACE</span>
            <h2>
              {tool === "home"
                ? "이미지 편집"
                : tool === "erase"
                  ? "매직 지우개"
                  : tool === "background"
                    ? "배경 제거"
                    : tool === "resize"
                      ? "크기 · 비율 변경"
                      : "파일 형식 변환"}
            </h2>
            <p>
              {tool === "home"
                ? "어려운 편집도, 여기서는 가볍게."
                : tool === "erase"
                  ? "없애고 싶은 부분만 칠해 주세요."
                  : tool === "background"
                    ? "복잡한 과정 없이, 배경만 쏙."
                    : tool === "resize"
                      ? "사진을 사용할 곳에 맞춰 보세요."
                      : "파일 형식 걱정 없이 자유롭게."}
            </p>
          </div>
          <div className="panel-content">
            {tool === "home" && (
              <>
                <button
                  className="upload-box"
                  onClick={() => fileInput.current?.click()}
                  disabled={!!busy}
                >
                  <span className="upload-icon">
                    <Upload size={24} />
                  </span>
                  <strong>이미지 올리기</strong>
                  <span>파일을 끌어 놓거나 눌러서 선택</span>
                  <small>JPG, PNG, WEBP, SVG, PDF · 최대 40MB</small>
                </button>
                <div className="section-label">
                  무엇을 해 볼까요?<span>TOOLS</span>
                </div>
                <div className="quick-tools">
                  {[
                    {
                      t: "erase",
                      icon: WandSparkles,
                      title: "쓱, 지우기",
                      desc: "필요 없는 부분 없애기",
                      color: "purple",
                    },
                    {
                      t: "background",
                      icon: Layers3,
                      title: "배경 없이 깔끔하게",
                      desc: "AI로 주인공만 남기기",
                      color: "pink",
                    },
                    {
                      t: "resize",
                      icon: Expand,
                      title: "딱 맞는 비율로",
                      desc: "SNS부터 프레젠테이션까지",
                      color: "blue",
                    },
                    {
                      t: "convert",
                      icon: ArrowDownToLine,
                      title: "어떤 파일이든 자유롭게",
                      desc: "PNG · JPG · PDF · SVG",
                      color: "orange",
                    },
                  ].map(({ t, icon: Icon, title, desc, color }) => (
                    <button
                      className="quick-card"
                      key={t}
                      onClick={() => setTool(t as Tool)}
                    >
                      <span className={`quick-icon ${color}`}>
                        <Icon size={20} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{desc}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
                <div className="tip-card">
                  <span className="tip-spark">
                    <Sparkles size={18} />
                  </span>
                  <strong>처음이라도 괜찮아요.</strong>
                  <p>
                    예시 이미지로 먼저 연습해 보세요.
                    <br />
                    마음에 안 들면 언제든 되돌릴 수 있어요.
                  </p>
                  <button onClick={() => setHelp(true)}>
                    간단한 사용법 보기
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              </>
            )}
            {tool === "erase" && (
              <>
                <div className="feature-illustration erase-illustration">
                  <Eraser size={42} />
                  <span className="spark a">✦</span>
                  <span className="spark b">✧</span>
                  <i />
                </div>
                <div className="segmented erase-modes">
                  <button
                    className={eraseMode === "context" ? "selected" : ""}
                    onClick={() => setEraseMode("context")}
                  >
                    주변 환경에 맞추기
                  </button>
                  <button
                    className={eraseMode === "simple" ? "selected" : ""}
                    onClick={() => setEraseMode("simple")}
                  >
                    주변색 채우기
                  </button>
                </div>
                {inpaintReady && (
                  <button
                    className={`button secondary full ${eraseMode === "smart" ? "server-erase-selected" : ""}`}
                    onClick={() => setEraseMode("smart")}
                  >
                    자연스럽게 지우기
                  </button>
                )}
                <p className="field-help">
                  {eraseMode === "context"
                    ? "주변의 무늬와 색을 참고해서 지운 자리를 채워요. 이 파일만으로 작동하고 사진을 서버로 보내지 않아요."
                    : eraseMode === "smart"
                      ? "이 앱의 서버에서 주변 무늬를 이어서 채워요. 사진을 저장하지 않아요."
                      : "내 기기에서 주변 색을 섞어 채워요. 단순한 배경에 사용해 보세요."}
                </p>
                <div className="step-note">
                  <span>1</span>
                  <p>
                    사진에서 <strong>지울 부분을 칠하고</strong>
                    <br />
                    아래 지우기 버튼을 눌러 주세요.
                  </p>
                </div>
                <label className="control-label" htmlFor="brush">
                  브러시 크기<span>{brush}px</span>
                </label>
                <input
                  id="brush"
                  type="range"
                  min="8"
                  max="180"
                  value={brush}
                  onChange={(e) => setBrush(+e.target.value)}
                />
                <div className="range-labels">
                  <span>작게</span>
                  <span>크게</span>
                </div>
                <button
                  className="button primary full"
                  onClick={() => void erase()}
                  disabled={!hasMask || !!busy}
                >
                  <WandSparkles size={17} />
                  칠한 부분 지우기
                </button>
                <button
                  className="button secondary full"
                  onClick={clearMask}
                  disabled={!hasMask || !!busy}
                >
                  칠한 부분 초기화
                </button>
                <div className="info-box">
                  <CircleHelp size={16} />
                  <p>
                    작은 얼룩이나 물체에 사용해 보세요. 주변 색으로 채우는
                    방식이라 복잡한 무늬는 자연스럽지 않을 수 있어요.
                  </p>
                </div>
              </>
            )}
            {tool === "background" && (
              <>
                <div className="feature-illustration bg-illustration checker">
                  <Layers3 size={48} />
                  <span className="spark a">✦</span>
                </div>
                {backgroundAi && (
                  <>
                    <div className="segmented">
                      <button
                        className={bgMode === "ai" ? "selected" : ""}
                        onClick={() => setBgMode("ai")}
                      >
                        AI로 배경 제거
                      </button>
                      <button
                        className={bgMode === "simple" ? "selected" : ""}
                        onClick={() => setBgMode("simple")}
                      >
                        단색 배경 제거
                      </button>
                    </div>
                    <p className="field-help">
                      {bgMode === "ai"
                        ? "사진 속 주인공을 찾아 배경을 제거해요. 별도 이용 키가 필요 없어요."
                        : "내 기기에서 가장자리와 연결된 비슷한 색을 없애요."}
                    </p>
                  </>
                )}
                <div className="step-note">
                  <span>1</span>
                  <p>
                    배경 제거를 누르면
                    <br />
                    <strong>
                      {bgMode === "ai"
                        ? "주인공만 남기고 투명해져요."
                        : "가장자리 배경이 투명해져요."}
                    </strong>
                  </p>
                </div>
                {bgMode === "simple" && (
                  <>
                    <label className="control-label" htmlFor="tolerance">
                      비슷한 색 범위<span>{tolerance}%</span>
                    </label>
                    <input
                      id="tolerance"
                      type="range"
                      min="5"
                      max="70"
                      value={tolerance}
                      onChange={(e) => setTolerance(+e.target.value)}
                    />
                    <div className="range-labels">
                      <span>정교하게</span>
                      <span>넓게 제거</span>
                    </div>
                  </>
                )}
                <button
                  className="button primary full"
                  onClick={() => void removeBg()}
                  disabled={!loaded || !!busy}
                >
                  <Layers3 size={17} />
                  배경 없애기
                </button>
                <div className="info-box">
                  <CircleHelp size={16} />
                  <p>
                    {bgMode === "ai"
                      ? "AI 결과는 사진에 따라 달라요. 복잡한 머리카락이나 작은 물체는 일부 남거나 지워질 수 있어요. 잘못되면 되돌리기를 누르세요."
                      : "흰색·단색 배경의 제품 사진에 잘 맞아요. 복잡한 풍경은 AI 배경 제거를 사용해 보세요."}
                  </p>
                </div>
                <div className="mini-tip">
                  <ShieldCheck size={17} />
                  <span>
                    {bgMode === "ai"
                      ? "이 앱의 서버에서 처리하고 저장하지 않아요."
                      : "사진을 외부 서버로 보내지 않아요."}
                  </span>
                </div>
              </>
            )}
            {tool === "resize" && (
              <>
                <div className="section-label first">자주 쓰는 비율</div>
                <div className="preset-grid">
                  {PRESETS.map((p, i) => (
                    <button
                      className={`preset ${preset === i ? "selected" : ""}`}
                      key={p.label}
                      onClick={() => {
                        setPreset(i);
                        setSize({ w: p.w, h: p.h });
                      }}
                    >
                      <span
                        className="ratio-icon"
                        style={{
                          width: p.w > p.h ? 34 : p.w === p.h ? 26 : 20,
                          height: p.h > p.w ? 34 : p.w === p.h ? 26 : 20,
                        }}
                      />
                      <strong>{p.label}</strong>
                      <span>{p.name}</span>
                      {preset === i && (
                        <CheckCircle2 className="preset-check" size={14} />
                      )}
                    </button>
                  ))}
                </div>
                <label className="control-label">
                  직접 크기 입력<span>픽셀(px)</span>
                </label>
                <div className="dimension-inputs">
                  <label>
                    가로
                    <input
                      type="number"
                      aria-label="가로 픽셀"
                      min="1"
                      max="16000"
                      value={size.w || ""}
                      onChange={(e) => {
                        setPreset(-1);
                        setSize((s) => ({ ...s, w: Number(e.target.value) }));
                      }}
                    />
                  </label>
                  <X size={13} />
                  <label>
                    세로
                    <input
                      type="number"
                      aria-label="세로 픽셀"
                      min="1"
                      max="16000"
                      value={size.h || ""}
                      onChange={(e) => {
                        setPreset(-1);
                        setSize((s) => ({ ...s, h: Number(e.target.value) }));
                      }}
                    />
                  </label>
                </div>
                <div className="control-label">사진 맞추기</div>
                <div className="segmented">
                  <button
                    className={fitMode === "contain" ? "selected" : ""}
                    onClick={() => setFitMode("contain")}
                  >
                    전체 보이기
                  </button>
                  <button
                    className={fitMode === "cover" ? "selected" : ""}
                    onClick={() => setFitMode("cover")}
                  >
                    빈틈없이 채우기
                  </button>
                </div>
                <p className="field-help">
                  {fitMode === "contain"
                    ? "원본 비율을 유지하고 남는 공간은 투명하게 채워요."
                    : "원본 비율을 유지하고 넘치는 부분은 가운데 기준으로 잘라요."}
                </p>
                <button
                  className="button primary full"
                  onClick={() => void resize()}
                  disabled={!loaded || !!busy || !sizeValid}
                >
                  <Crop size={17} />
                  크기 바꾸기
                </button>
                {!sizeValid && (
                  <p className="error-text">
                    가로·세로를 입력해 주세요. 최대 3,200만 화소까지 가능해요.
                  </p>
                )}
              </>
            )}
            {tool === "convert" && (
              <>
                <div className="section-label first">
                  저장할 형식을 선택하세요
                </div>
                <div className="format-cards">
                  {(
                    [
                      {
                        id: "PNG",
                        desc: "배경을 투명하게 · 선명한 이미지",
                        icon: FileImage,
                      },
                      {
                        id: "JPG",
                        desc: "작은 용량 · 사진 공유에 추천",
                        icon: FileImage,
                      },
                      {
                        id: "PDF",
                        desc: "문서 공유 · 인쇄용 페이지",
                        icon: FileText,
                      },
                      {
                        id: "SVG",
                        desc: "이미지를 담은 SVG 파일",
                        icon: FileImage,
                      },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      className={`format-card ${format === f.id ? "selected" : ""}`}
                      onClick={() => setFormat(f.id)}
                    >
                      <f.icon size={23} />
                      <span>
                        <strong>{f.id}</strong>
                        <small>{f.desc}</small>
                      </span>
                      {format === f.id ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <span className="radio" />
                      )}
                    </button>
                  ))}
                </div>
                <button
                  className="button primary full"
                  disabled={!loaded || !!busy}
                  onClick={() => openExport()}
                >
                  <Download size={17} />
                  {format}로 저장하기
                </button>
                <div className="info-box">
                  <CircleHelp size={16} />
                  <p>
                    다른 형식의 파일을 올리고 원하는 형식으로 저장하면 변환돼요.
                    PDF는 한 쪽씩 편집하며, SVG는 이미지가 포함된 형식으로
                    저장해요.
                  </p>
                </div>
                <button
                  className="button secondary full"
                  onClick={() => fileInput.current?.click()}
                  disabled={!!busy}
                >
                  <Upload size={16} />
                  다른 파일 올리기
                </button>
              </>
            )}
          </div>
          <div className="panel-footer">
            <span className="status-dot" />내 이미지, 내 공간에서 안전하게
          </div>
        </aside>
        <main className="editor-main">
          <div className="workspace-heading">
            <div>
              <div className="workspace-eyebrow">
                <span />
                CREATE SOMETHING YOU LOVE
              </div>
              <h1>
                {titles[tool].title}
                <span className="title-dot">.</span>
              </h1>
              <p>{titles[tool].sub}</p>
            </div>
            <button
              className="icon-button help-circle"
              aria-label="사용 방법 보기"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={20} />
            </button>
          </div>
          <section className="editor-card" aria-label="이미지 편집 영역">
            <div className="canvas-toolbar">
              <div className="toolbar-start">
                <span className="file-chip">
                  <FileImage size={14} />
                  <span>{name || "이름 없는 이미지"}</span>
                </span>
                <span className="dot-separator">·</span>
                <span className="dimensions">
                  {dims.w} × {dims.h} px
                </span>
              </div>
              <div className="toolbar-actions">
                <button
                  className="icon-button"
                  aria-label="되돌리기"
                  title="되돌리기"
                  disabled={!historyCounts.past || !!busy}
                  onClick={() => undo()}
                >
                  <Undo2 size={17} />
                </button>
                <button
                  className="icon-button"
                  aria-label="다시 실행"
                  title="다시 실행"
                  disabled={!historyCounts.future || !!busy}
                  onClick={() => undo(true)}
                >
                  <Redo2 size={17} />
                </button>
                <span className="toolbar-divider" />
                <button
                  className="icon-button"
                  aria-label="새 이미지 올리기"
                  title="새 이미지 올리기"
                  disabled={!!busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={17} />
                </button>
              </div>
            </div>
            <div
              className={`canvas-workspace ${tool === "erase" ? "erase-mode" : ""}`}
              ref={workspace}
            >
              <div
                className="canvas-position"
                style={{ width: displayW, height: displayH }}
              >
                <div
                  className="image-canvas checker"
                  style={{ width: displayW, height: displayH }}
                >
                  <canvas ref={view} aria-label="편집 중인 이미지" />
                  <canvas
                    ref={overlay}
                    className="mask-canvas"
                    aria-label="지울 부분 칠하기"
                    style={{
                      pointerEvents:
                        tool === "erase" && !busy ? "auto" : "none",
                      cursor: tool === "erase" ? "none" : "default",
                    }}
                    onPointerDown={(e) => {
                      if (tool !== "erase" || busy) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drawing.current = true;
                      lastPoint.current = null;
                      paint(brushPoint(e));
                    }}
                    onPointerMove={(e) => {
                      const p = brushPoint(e);
                      setCursor(p);
                      if (drawing.current) paint(p);
                    }}
                    onPointerUp={() => {
                      drawing.current = false;
                      lastPoint.current = null;
                    }}
                    onPointerCancel={() => {
                      drawing.current = false;
                      lastPoint.current = null;
                    }}
                    onLostPointerCapture={() => {
                      drawing.current = false;
                      lastPoint.current = null;
                    }}
                    onPointerLeave={() => {
                      setCursor(null);
                    }}
                  />
                  {tool === "erase" && cursor && (
                    <span
                      className="brush-cursor"
                      style={{
                        left: (cursor.x / dims.w) * displayW,
                        top: (cursor.y / dims.h) * displayH,
                        width: (brush / dims.w) * displayW,
                        height: (brush / dims.h) * displayH,
                      }}
                    />
                  )}
                </div>
              </div>
              {busy && (
                <div className="busy-overlay" role="status">
                  <Loader2 className="spin" size={28} />
                  <strong>{busy}</strong>
                  <small>잠시만 기다려 주세요.</small>
                </div>
              )}
            </div>
            <div className="canvas-bottom">
              <span className="canvas-hint">
                <MousePointer2 size={13} />
                {tool === "erase"
                  ? "드래그해서 지울 부분을 칠하세요"
                  : "내 이미지로 바꿔서 자유롭게 편집해 보세요"}
              </span>
              {pdf && pdf.pages > 1 && (
                <div className="pdf-pager">
                  <button
                    className="icon-button"
                    disabled={pdf.page === 1 || !!busy}
                    aria-label="이전 PDF 페이지"
                    onClick={() => void importFile(pdf.file, pdf.page - 1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <span>
                    {pdf.page} / {pdf.pages}쪽
                  </span>
                  <button
                    className="icon-button"
                    disabled={pdf.page === pdf.pages || !!busy}
                    aria-label="다음 PDF 페이지"
                    onClick={() => void importFile(pdf.file, pdf.page + 1)}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              )}
              <div className="zoom-controls">
                <button
                  className="icon-button"
                  aria-label="축소"
                  onClick={() => setZoom((v) => Math.max(0.25, v - 0.25))}
                >
                  <Minus size={14} />
                </button>
                <button
                  className="zoom-value"
                  onClick={() => setZoom(1)}
                  title="화면에 맞추기"
                >
                  {Math.round(Math.max(0.04, fit) * 100)}%
                </button>
                <button
                  className="icon-button"
                  aria-label="확대"
                  onClick={() => setZoom((v) => Math.min(3, v + 0.25))}
                >
                  <Plus size={14} />
                </button>
                <span className="toolbar-divider" />
                <button
                  className="icon-button"
                  aria-label="화면에 맞추기"
                  onClick={() => setZoom(1)}
                >
                  <Maximize size={14} />
                </button>
              </div>
            </div>
          </section>
          <div className="under-canvas">
            <div>
              <span className="tiny-icon">
                <Check size={13} />
              </span>
              자유롭게 시도해 보세요. 원본 파일은 바뀌지 않아요.
            </div>
            <span className="formats-caption">PNG · JPG · PDF · SVG</span>
          </div>
          <div className="idea-banner">
            <span className="idea-icon">
              <Sparkles size={22} />
            </span>
            <div>
              <strong>아이디어가 필요할 때도, 막막할 때도.</strong>
              <p>
                어떤 비율이 좋을지, 이미지를 어떻게 활용할지 AI에게 물어보세요.
              </p>
            </div>
            <button onClick={() => setAiOpen(true)}>
              AI와 이야기하기
              <ArrowUpRight size={16} />
            </button>
            <span className="banner-star">✦</span>
          </div>
          <footer className="workspace-footer">
            <span>조금 더 쉽게, 조금 더 나답게.</span>
            <span>
              Made for your everyday creativity <span>✦</span>
            </span>
          </footer>
        </main>
        {aiOpen && (
          <aside className="ai-panel" aria-label="AI에게 물어보기">
            <div className="ai-panel-heading">
              <span className="ai-symbol">
                <Sparkles size={19} />
              </span>
              <div>
                <h2>AI에게 물어보기</h2>
                <span>
                  <i className={aiConfigured ? "online" : ""} />
                  {aiConfigured ? "연결됨" : "연결 설정 필요"}
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="AI 대화 닫기"
                onClick={() => setAiOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="chat-scroll">
              {!chat.length && (
                <div className="chat-welcome">
                  <span>✦</span>
                  <h3>
                    함께 아이디어를
                    <br />
                    만들어 볼까요?
                  </h3>
                  <p>
                    이미지 활용법, 디자인 고민,
                    <br />
                    편집 방법을 편하게 물어보세요.
                  </p>
                  {[
                    "인스타그램 게시물은 어떤 비율이 좋아?",
                    "이 사진을 더 멋지게 활용하려면?",
                    "PNG와 JPG는 어떻게 달라?",
                  ].map((q) => (
                    <button key={q} onClick={() => void ask(q)}>
                      {q}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              {!aiConfigured && (
                <div className="ai-connect-note">
                  <strong>
                    <Settings2 size={16} />
                    실제 AI를 연결해 주세요
                  </strong>
                  <p>
                    AI 답변에는 별도의 이용 키가 필요해요. 아직 연결하지 않아
                    대화 기능은 꺼져 있어요.
                  </p>
                  <details>
                    <summary>연결 방법 보기</summary>
                    <p>
                      프로젝트의 <code>.env</code> 파일에{" "}
                      <code>AI_API_KEY</code>를 설정하고 서버를 다시 시작하면
                      돼요. 키는 채팅에 쓰지 마세요. 연결 후 이 창을 다시 열어
                      주세요.
                    </p>
                    <p>
                      AI 이용료가 발생할 수 있어요. 연결이 어렵다면 앱을 만든
                      사람에게 도움을 요청하세요.
                    </p>
                  </details>
                </div>
              )}
              {chat.map((m, i) => (
                <div className={`chat-message ${m.role}`} key={i}>
                  {m.role === "assistant" && <Sparkles size={15} />}
                  <p>{m.content}</p>
                </div>
              ))}
              {sending && (
                <div className="chat-thinking">
                  <Loader2 size={16} className="spin" />
                  생각을 정리하고 있어요…
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <label className="attach-check">
                <input
                  type="checkbox"
                  checked={attach}
                  onChange={(e) => setAttach(e.target.checked)}
                />
                현재 사진도 함께 보내기
              </label>
              <div>
                <textarea
                  aria-label="AI에게 질문"
                  rows={2}
                  maxLength={4000}
                  value={question}
                  placeholder="어떤 점이 궁금하세요?"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                />
                <button
                  aria-label="질문 보내기"
                  disabled={!question.trim() || sending || !aiConfigured}
                >
                  <Send size={17} />
                </button>
              </div>
              <small>
                {attach
                  ? "선택한 사진과 질문이 OpenAI로 전송돼요."
                  : "사진은 보내지 않고 질문만 전송해요."}
              </small>
            </form>
          </aside>
        )}
      </div>
      {drag && (
        <div className="drop-overlay" onDragLeave={() => setDrag(false)}>
          <div>
            <Upload size={40} />
            <h2>여기에 파일을 놓아 주세요</h2>
            <p>JPG, PNG, WEBP, SVG, PDF</p>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button aria-label="알림 닫기" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {exportOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setExportOpen(false);
          }}
        >
          <section
            className="export-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setExportOpen(false);
            }}
          >
            <div className="modal-header">
              <div className="modal-icon">
                <Download size={23} />
              </div>
              <button
                className="icon-button"
                aria-label="저장 창 닫기"
                disabled={!!busy}
                onClick={() => setExportOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="export-title">마음에 드는 모습 그대로.</h2>
            <p className="modal-subtitle">
              필요한 형식과 크기로 이미지를 저장하세요.
            </p>
            <label className="control-label" htmlFor="export-name">
              파일 이름
            </label>
            <input
              autoFocus
              className="text-input"
              id="export-name"
              value={exportName}
              maxLength={100}
              onChange={(e) => setExportName(e.target.value)}
            />
            <div className="control-label">파일 형식</div>
            <div className="export-formats">
              {(["PNG", "JPG", "PDF", "SVG"] as ExportFormat[]).map((f) => (
                <button
                  className={format === f ? "selected" : ""}
                  key={f}
                  onClick={() => setFormat(f)}
                >
                  {f}
                  {format === f && <Check size={13} />}
                </button>
              ))}
            </div>
            <label className="control-label" htmlFor="upscale">
              크기 늘려서 저장<span>최대 4배</span>
            </label>
            <div className="scale-options" id="upscale">
              {([1, 2, 4] as const).map((s) => (
                <button
                  key={s}
                  className={scale === s ? "selected" : ""}
                  disabled={dims.w * dims.h * s * s > MAX_PIXELS}
                  onClick={() => setScale(s)}
                >
                  <strong>{s}×</strong>
                  <small>
                    {s === 1 ? "원래 크기" : s === 2 ? "2배 확대" : "4배 확대"}
                  </small>
                  {scale === s && <CheckCircle2 size={15} />}
                </button>
              ))}
            </div>
            <p className="field-help">
              {dims.w * scale} × {dims.h * scale} px · 부드럽게 확대해요. AI로
              새 디테일을 만드는 방식은 아니에요.
            </p>
            {format === "JPG" && (
              <>
                <label className="control-label" htmlFor="quality">
                  이미지 품질<span>{quality}%</span>
                </label>
                <input
                  id="quality"
                  type="range"
                  min="50"
                  max="100"
                  value={quality}
                  onChange={(e) => setQuality(+e.target.value)}
                />
              </>
            )}
            {(format === "PNG" || format === "SVG") && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                <span>투명한 부분 유지하기</span>
              </label>
            )}
            {format === "SVG" && (
              <p className="export-notice">
                SVG 안에 편집된 이미지를 담아요. 도형과 선으로 바꾸는 벡터
                변환은 아니에요.
              </p>
            )}
            {format === "PDF" && (
              <p className="export-notice">
                현재 보이는 한 쪽을 이미지로 담은 PDF로 저장해요.
              </p>
            )}
            {format === "JPG" && (
              <p className="export-notice">
                JPG는 투명한 부분을 흰색으로 저장해요.
              </p>
            )}
            <button
              className="button primary full download-button"
              disabled={!!busy || dims.w * dims.h * scale * scale > MAX_PIXELS}
              onClick={() => void download()}
            >
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <Download size={18} />
              )}{" "}
              {busy ? "파일 만드는 중…" : `${format} 파일 저장하기`}
            </button>
            <div className="download-safe">
              <ShieldCheck size={13} />
              편집한 이미지는 내 기기에만 저장돼요.
            </div>
          </section>
        </div>
      )}
      {help && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelp(false);
          }}
        >
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <button
              className="icon-button close-help"
              aria-label="사용 안내 닫기"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">HELLO, CREATOR</span>
            <h2 id="help-title">세 단계면 충분해요.</h2>
            <ol>
              <li>
                <span>1</span>
                <div>
                  <strong>사진이나 파일을 올려 주세요.</strong>
                  <p>
                    왼쪽의 ‘이미지 올리기’를 누르세요.
                    <br />
                    PDF는 한 쪽씩 골라서 편집할 수 있어요.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>원하는 도구로 편집해 보세요.</strong>
                  <p>
                    지우기는 칠한 부분을 주변 무늬로 채워요.
                    <br />
                    AI 배경 제거는 주인공을 찾아 남겨 줘요.
                    <br />
                    잘못 편집해도 위쪽 화살표로 되돌릴 수 있어요.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>오른쪽 위 ‘저장하기’를 누르세요.</strong>
                  <p>
                    파일 형식과 확대 크기를 선택하면 끝!
                    <br />
                    원본 파일은 그대로 남아 있어요.
                  </p>
                </div>
              </li>
            </ol>
            <button
              className="button primary full"
              onClick={() => setHelp(false)}
            >
              좋아요, 시작할게요
              <ArrowRight size={17} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
