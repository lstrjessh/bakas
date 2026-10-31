import * as maplibregl from "maplibre-gl";
import { loadSatelliteFrame, preloadSatelliteFrames } from "./satellite-frames";
import { SATELLITE_BOUNDS, stampISO, type Storm } from "./types";
import { unwrapTrack } from "./tracks";

export type VideoExportRequest = {
  id: number;
  frames: string[];
  storm: Storm | null;
  opacity: number;
  signal: AbortSignal;
};
export type VideoExportResult = { blob: Blob; filename: string };

export function recordingType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof HTMLCanvasElement.prototype.captureStream !== "function"
  )
    return null;
  return (
    [
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || null
  );
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Export cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function mapReady(
  map: maplibregl.Map,
  signal: AbortSignal,
  begin?: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      map.off("idle", ready);
      signal.removeEventListener("abort", abort);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error("The export map could not finish loading. Please retry."),
      );
    }, 25_000);
    map.once("idle", ready);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      begin?.();
      map.triggerRepaint();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function exportSatelliteVideo(
  original: maplibregl.Map,
  request: VideoExportRequest,
  progress: (message: string) => void,
): Promise<VideoExportResult> {
  const mime = recordingType();
  if (!mime)
    throw new Error(
      "Video export is not supported by this browser. Try Chrome or Edge.",
    );
  const { signal } = request;
  const stamps = [...new Set(request.frames)].sort();
  if (stamps.length < 2)
    throw new Error("At least two satellite frames are needed for a video.");
  const style = original.getStyle();
  style.layers = style.layers.filter(
    (layer) => !("source" in layer && layer.source === "satellite"),
  );
  delete style.sources.satellite;
  const center = original.getCenter(),
    zoom = original.getZoom(),
    bearing = original.getBearing(),
    pitch = original.getPitch();
  const width = original.getContainer().clientWidth,
    height = original.getContainer().clientHeight;
  progress(`Preparing ${stamps.length} satellite frames…`);
  await abortable(preloadSatelliteFrames(stamps, signal), signal);
  const blobs = await abortable(
    Promise.all(stamps.map(loadSatelliteFrame)),
    signal,
  );
  signal.throwIfAborted();
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: "none",
  });
  document.body.appendChild(container);
  let map: maplibregl.Map | undefined,
    stream: MediaStream | undefined,
    recorder: MediaRecorder | undefined;
  const urls: string[] = [];
  try {
    progress("Preparing the map…");
    map = new maplibregl.Map({
      container,
      style,
      center,
      zoom,
      bearing,
      pitch,
      interactive: false,
      attributionControl: false,
      pixelRatio: Math.min(1, 1920 / width, 1080 / height),
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    await mapReady(map, signal);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(map.getCanvas().width / 2) * 2;
    canvas.height = Math.floor(map.getCanvas().height / 2) * 2;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("The browser could not create the export canvas.");
    const chunks: Blob[] = [];
    let encodingError: Error | undefined;
    const stopped = new Promise<Blob>((resolve, reject) => {
      stream = canvas.captureStream(12);
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 4_000_000,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        encodingError = new Error("The browser could not encode this video.");
        reject(encodingError);
      };
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: recorder!.mimeType }));
    });
    // Recording can fail while a frame is loading; handle that rejection immediately.
    void stopped.catch(() => {});
    for (let i = 0; i < stamps.length; i++) {
      signal.throwIfAborted();
      progress(`Recording ${i + 1} / ${stamps.length}…`);
      const url = URL.createObjectURL(blobs[i]);
      urls.push(url);
      const image = new Image();
      image.src = url;
      await abortable(image.decode(), signal);
      const current = map;
      await mapReady(current, signal, () => {
        const source = current.getSource("satellite") as
          maplibregl.ImageSource | undefined;
        if (source) source.updateImage({ url, coordinates: SATELLITE_BOUNDS });
        else {
          current.addSource("satellite", {
            type: "image",
            url,
            coordinates: SATELLITE_BOUNDS,
          });
          current.addLayer(
            {
              id: "satellite",
              type: "raster",
              source: "satellite",
              paint: {
                "raster-opacity": request.opacity,
                "raster-fade-duration": 0,
              },
            },
            "par",
          );
        }
      });
      context.drawImage(map.getCanvas(), 0, 0, canvas.width, canvas.height);
      const font = Math.max(12, Math.min(18, canvas.width / 65)),
        margin = Math.round(font * 0.9);
      context.fillStyle = "rgba(16,27,33,.94)";
      context.fillRect(0, 0, canvas.width, font * 3.7);
      context.fillStyle = "#bbdfb4";
      context.font = `600 ${font}px Arial`;
      context.fillText("Bakas · Himawari infrared", margin, font * 1.5);
      context.fillStyle = "#edf3ee";
      context.font = `${font * 0.85}px Arial`;
      context.fillText(
        stampISO(stamps[i]).replace("T", " ").replace("Z", " UTC"),
        margin,
        font * 2.9,
      );
      if (request.storm) {
        const positions = unwrapTrack(request.storm.track);
        for (const index of [0, positions.length - 1]) {
          const point = map.project(positions[index]);
          const label =
            index === 0
              ? "START"
              : request.storm.track[index].forecast
                ? "FORECAST END"
                : request.storm.id.startsWith("live-")
                  ? "LATEST"
                  : "END";
          const x = (point.x * canvas.width) / width,
            y = (point.y * canvas.height) / height;
          context.font = `600 ${font * 0.65}px Arial`;
          const labelWidth = context.measureText(label).width + 12;
          if (
            x >= 0 &&
            x <= canvas.width &&
            y > font * 4 &&
            y < canvas.height - font * 4
          ) {
            context.fillStyle = "#f4f6f0";
            context.fillRect(
              Math.min(
                canvas.width - labelWidth,
                Math.max(0, x - labelWidth / 2),
              ),
              y - 23,
              labelWidth,
              19,
            );
            context.fillStyle = "#286357";
            context.fillText(
              label,
              Math.min(
                canvas.width - labelWidth,
                Math.max(0, x - labelWidth / 2),
              ) + 6,
              y - 10,
            );
          }
        }
      }
      const footer = [
        request.storm
          ? `Track: ${request.storm.name} (${request.storm.year}) · ${request.storm.source}`
          : "Western Pacific · near-real-time imagery",
        "Imagery: JMA / RAMMB / CIRA",
        "Map: OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors",
      ];
      const small = Math.max(8, Math.min(12, canvas.width / 75));
      context.fillStyle = "rgba(16,27,33,.94)";
      context.fillRect(0, canvas.height - small * 5, canvas.width, small * 5);
      context.font = `${small}px Arial`;
      context.fillStyle = "#d2ded6";
      footer.forEach((line, j) =>
        context.fillText(
          line,
          margin,
          canvas.height - small * (3.5 - j * 1.35),
          canvas.width - margin * 2,
        ),
      );
      if (encodingError) throw encodingError;
      if (i === 0) recorder!.start();
      // A subtle progress rule also keeps canvas frames flowing while each
      // satellite observation is held, including the final observation.
      for (let tick = 0; tick <= 10; tick++) {
        if (encodingError) throw encodingError;
        context.fillStyle = "#3a4f46";
        context.fillRect(0, canvas.height - 2, canvas.width, 2);
        context.fillStyle = "#bbdfb4";
        context.fillRect(
          0,
          canvas.height - 2,
          (canvas.width * (i + tick / 10)) / stamps.length,
          2,
        );
        (
          stream!.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
        ).requestFrame?.();
        await abortable(
          new Promise((resolve) => setTimeout(resolve, 100)),
          signal,
        );
      }
      if (encodingError) throw encodingError;
    }
    recorder!.stop();
    const blob = await abortable(stopped, signal);
    if (!blob.size)
      throw new Error("The browser produced an empty video. Please retry.");
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    return {
      blob,
      filename: `bakas-satellite-${stamps[0]}-${stamps.at(-1)}.${extension}`,
    };
  } finally {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    map?.remove();
    container.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}
