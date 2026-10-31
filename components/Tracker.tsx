"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  stampISO,
  type ArchiveIndex,
  type LiveResponse,
  type Storm,
  type StormSummary,
} from "@/lib/types";
import { timeLabel, windLabel } from "@/lib/tracks";
import { preloadSatelliteFrames } from "@/lib/satellite-frames";
import { downloadBlob, downloadTrack } from "@/lib/downloads";
import type {
  VideoExportRequest,
  VideoExportResult,
} from "@/lib/satellite-video";
const StormMap = dynamic(() => import("./StormMap"), {
  ssr: false,
  loading: () => (
    <div className="map-host">
      <div className="map-message">Loading map…</div>
    </div>
  ),
});
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || "Could not load this data. Please retry.");
  }
  return r.json();
}
function CycloneIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M11 27C2 11 22 0 32 10M29 13c9 16-11 27-21 17"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="20" cy="20" r="5" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

export default function Tracker() {
  const [mode, setMode] = useState<"live" | "archive">("live"),
    [archive, setArchive] = useState<ArchiveIndex | null>(null),
    [archiveError, setArchiveError] = useState("");
  const [live, setLive] = useState<LiveResponse | null>(null),
    [liveError, setLiveError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [storm, setStorm] = useState<Storm | null>(null),
    [selection, setSelection] = useState(""),
    [selectionError, setSelectionError] = useState("");
  const [query, setQuery] = useState(""),
    [year, setYear] = useState("all"),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false);
  const [satellite, setSatellite] = useState(false),
    [par, setPar] = useState(true),
    [opacity, setOpacity] = useState(0.7),
    [frames, setFrames] = useState<string[]>([]),
    [frame, setFrame] = useState(""),
    [satError, setSatError] = useState("");
  const [sources, setSources] = useState(false),
    [loadedUrl, setLoadedUrl] = useState(false);
  const [satPlaying, setSatPlaying] = useState(false),
    [frameReady, setFrameReady] = useState("");
  const [videoRequest, setVideoRequest] = useState<VideoExportRequest | null>(
    null,
  );
  const [videoProgress, setVideoProgress] = useState("");
  const [videoError, setVideoError] = useState("");
  const [videoSupported, setVideoSupported] = useState(false);
  const videoController = useRef<AbortController | null>(null);
  useEffect(() => {
    setVideoSupported(
      typeof MediaRecorder !== "undefined" &&
        typeof HTMLCanvasElement.prototype.captureStream === "function",
    );
    return () => videoController.current?.abort();
  }, []);
  const finishVideo = useCallback(
    (result: VideoExportResult | null, error?: string) => {
      if (result) downloadBlob(result.blob, result.filename);
      setVideoRequest(null);
      setVideoProgress("");
      setVideoError(error || "");
    },
    [],
  );
  const startVideo = () => {
    videoController.current?.abort();
    const controller = new AbortController();
    videoController.current = controller;
    setPlaying(false);
    setSatPlaying(false);
    setVideoError("");
    setVideoProgress("Preparing video…");
    setVideoRequest({
      id: Date.now(),
      frames: [...frames],
      storm,
      opacity,
      signal: controller.signal,
    });
  };
  useEffect(() => {
    if (!satellite || !frame || frameReady !== frame || frames.length < 2)
      return;
    const controller = new AbortController();
    const index = frames.indexOf(frame);
    const upcoming = frames
      .map((_, step) => frames[(index + step + 1) % frames.length])
      .filter((stamp) => stamp !== frame);
    // Preserve bandwidth when someone only wants a still image; warm the loop on play.
    void preloadSatelliteFrames(
      satPlaying ? upcoming : upcoming.slice(0, 1),
      controller.signal,
    );
    return () => controller.abort();
  }, [satellite, frame, frameReady, frames, satPlaying]);
  useEffect(() => {
    if (!satellite || !satPlaying || frameReady !== frame || frames.length < 2)
      return;
    const timer = setTimeout(
      () => setFrame(frames[(frames.indexOf(frame) + 1) % frames.length]),
      1800,
    );
    return () => clearTimeout(timer);
  }, [satellite, satPlaying, frameReady, frame, frames]);
  const modal = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!sources) return;
    const previous = document.activeElement as HTMLElement | null;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSources(false);
      if (event.key !== "Tab") return;
      const targets =
        modal.current?.querySelectorAll<HTMLElement>("button,a[href]");
      if (!targets?.length) return;
      const first = targets[0],
        last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [sources]);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sid = params.get("storm");
    if (sid) {
      setMode(sid.startsWith("live-") ? "live" : "archive");
      setSelection(sid);
    }
    const value = Number(params.get("step"));
    if (Number.isInteger(value) && value >= 0) setPosition(value);
    setSatellite(params.get("satellite") === "1");
    setLoadedUrl(true);
  }, []);
  useEffect(() => {
    const c = new AbortController();
    json<ArchiveIndex>("/data/index.json", c.signal)
      .then(setArchive)
      .catch((e) => {
        if (e.name !== "AbortError")
          setArchiveError("The storm archive could not load.");
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLiveError("");
    json<LiveResponse>("/api/storms", c.signal)
      .then(setLive)
      .catch((e) => {
        if (e.name !== "AbortError") setLiveError(e.message);
      });
    const timer = setTimeout(() => setRefresh((n) => n + 1), 5 * 60_000);
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!satellite) return;
    const c = new AbortController();
    setSatError("");
    const load = () =>
      json<{ frames: string[] }>("/api/satellite?manifest=1", c.signal)
        .then((data) => {
          setFrames([...data.frames].reverse());
          setFrame((previous) =>
            data.frames.includes(previous) ? previous : data.frames[0] || "",
          );
        })
        .catch((e) => {
          if (e.name !== "AbortError")
            setSatError("Satellite imagery is temporarily unavailable.");
        });
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [satellite, refresh]);
  useEffect(() => {
    if (!loadedUrl) return;
    if (!selection) {
      setStorm(null);
      return;
    }
    const c = new AbortController();
    setSelectionError("");
    setStorm(null);
    if (selection.startsWith("live-")) {
      const match = live?.storms.find((s) => s.id === selection);
      if (match) {
        setStorm(match);
        setPosition((p) => Math.min(p, match.track.length - 1));
      } else if (live)
        setSelectionError(
          "This storm is no longer in the current advisory feed.",
        );
    } else if (/^\d{7}[NS]\d{5}$/.test(selection)) {
      json<Storm>(`/data/storms/${selection}.json`, c.signal)
        .then((data) => {
          setStorm(data);
          setPosition((p) => Math.min(p, data.track.length - 1));
        })
        .catch((e) => {
          if (e.name !== "AbortError")
            setSelectionError("This archived storm could not load.");
        });
    } else setSelectionError("This storm link is not valid.");
    return () => c.abort();
  }, [selection, live, loadedUrl]);
  useEffect(() => {
    if (!loadedUrl) return;
    const url = new URL(location.href);
    url.searchParams.delete("storm");
    url.searchParams.delete("step");
    url.searchParams.delete("satellite");
    if (selection) {
      url.searchParams.set("storm", selection);
      if (position) url.searchParams.set("step", String(position));
    }
    if (satellite) url.searchParams.set("satellite", "1");
    history.replaceState(null, "", url);
  }, [selection, position, satellite, loadedUrl]);
  useEffect(() => {
    if (!playing || !storm) return;
    const timer = setInterval(
      () =>
        setPosition((p) => {
          if (p >= storm.track.length - 1) {
            setPlaying(false);
            return p;
          }
          return p + 1;
        }),
      550,
    );
    return () => clearInterval(timer);
  }, [playing, storm]);
  const choose = useCallback((item: StormSummary) => {
    setPlaying(false);
    setPosition(0);
    setSelection(item.id);
  }, []);
  const move = useCallback((value: number) => {
    setPlaying(false);
    setPosition(value);
  }, []);
  const years = useMemo(
    () =>
      [...new Set(archive?.storms.map((s) => s.year) || [])].sort(
        (a, b) => b - a,
      ),
    [archive],
  );
  const filtered = useMemo(
    () =>
      archive?.storms.filter(
        (s) =>
          (year === "all" || s.year === Number(year)) &&
          `${s.name} ${s.year} ${s.id}`
            .toLowerCase()
            .includes(query.toLowerCase().trim()),
      ) || [],
    [archive, query, year],
  );
  const point = storm?.track[position];
  const windSamples = useMemo(
    () =>
      storm?.track.flatMap((p, i) =>
        p.wind === null ? [] : [{ ...p, index: i }],
      ) || [],
    [storm],
  );
  const maximumWind = Math.max(...windSamples.map((p) => p.wind || 0), 1);
  const displayed =
    mode === "live" ? live?.storms || [] : filtered.slice(0, 100);
  const highlight = archive?.storms.find(
    (s) => s.name.toLowerCase() === "haiyan" && s.year === 2013,
  );
  return (
    <main className="app">
      <header className="header">
        <a className="brand" href="/" aria-label="Bakas home">
          <CycloneIcon />
          <span>
            bakas<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-caption">Typhoon tracks, past and present</span>
        <button className="sources-button" onClick={() => setSources(true)}>
          Data & sources <span>↗</span>
        </button>
      </header>
      <div className="workspace" inert={!!videoRequest}>
        <aside className="sidebar" aria-label="Storm browser">
          <div className="sidebar-heading">
            <span className="eyebrow">WESTERN PACIFIC</span>
            <h1>Follow the storm.</h1>
            <p>See where it is. Explore where it went.</p>
          </div>
          <div className="tabs" role="tablist" aria-label="Storm collection">
            {(["live", "archive"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={mode === tab}
                onClick={() => setMode(tab)}
              >
                {tab === "live" ? (
                  <>
                    <i />
                    Current storms
                  </>
                ) : (
                  "Archive"
                )}
              </button>
            ))}
          </div>
          {mode === "archive" && (
            <div className="filters">
              <label className="search">
                <span className="sr-only">Search storm name or year</span>
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="5" />
                  <path d="m12 12 5 5" />
                </svg>
                <input
                  placeholder="Search name or year"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="year-filter">
                <label htmlFor="year">Season</label>
                <select
                  id="year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                >
                  <option value="all">All years</option>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="list-heading">
            <span>
              {mode === "live"
                ? "LATEST ADVISORIES"
                : `${filtered.length.toLocaleString()} STORMS`}
            </span>
            <span>{mode === "live" ? "PAGASA" : "IBTrACS"}</span>
          </div>
          <div className="storm-list">
            {mode === "live" && !live && !liveError && (
              <div className="empty-state" role="status">
                Checking current advisories…
              </div>
            )}
            {mode === "live" && liveError && (
              <div className="empty-state" role="alert">
                <span className="status-label">SOURCE UNAVAILABLE</span>
                <h2>We couldn’t check current storms.</h2>
                <p>{liveError}</p>
                <button onClick={() => setRefresh((n) => n + 1)}>
                  Try again ↻
                </button>
                <a
                  href="https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin"
                  target="_blank"
                  rel="noreferrer"
                >
                  PAGASA bulletins ↗
                </a>
              </div>
            )}
            {mode === "live" && live && !liveError && !live.storms.length && (
              <div className="empty-state">
                <CycloneIcon />
                <h2>No current storms in the feed.</h2>
                <p>
                  Explore a past season while we watch for the next advisory.
                </p>
                <button onClick={() => setMode("archive")}>
                  Browse the archive →
                </button>
              </div>
            )}
            {mode === "archive" && archiveError && (
              <div className="empty-state" role="alert">
                {archiveError}
              </div>
            )}
            {mode === "archive" && !archive && !archiveError && (
              <div className="empty-state">Loading the storm archive…</div>
            )}
            {mode === "archive" && archive && filtered.length === 0 && (
              <div className="empty-state">
                No matching storms. Try another name or year.
              </div>
            )}
            {!(mode === "live" && liveError) &&
              displayed.map((item) => (
                <button
                  className={`storm-row ${selection === item.id ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => choose(item)}
                >
                  <span className="storm-symbol">
                    <CycloneIcon />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.year} <span>·</span>{" "}
                      {new Date(item.start).toLocaleDateString("en-GB", {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </small>
                  </span>
                  <span className="row-end">
                    {mode === "live" ? "VIEW" : "REPLAY"}
                    <span>↗</span>
                  </span>
                </button>
              ))}
            {mode === "archive" && filtered.length > 100 && (
              <p className="list-note">
                Showing 100 results. Choose a season or search to narrow the
                list.
              </p>
            )}
          </div>
          <div className="sidebar-footer">
            <span className="tiny-dot" />
            {mode === "live" && live
              ? `Checked ${timeLabel(live.fetched)}`
              : archive
                ? `${archive.storms.length.toLocaleString()} storms · ${years.at(-1)}–${years[0]}`
                : "Public weather data"}
          </div>
        </aside>
        <section className="map-panel" aria-label="Storm explorer">
          <StormMap
            storm={storm}
            position={position}
            onPosition={move}
            satellite={satellite}
            frame={frame || null}
            opacity={opacity}
            par={par}
            onFrameReady={setFrameReady}
            videoRequest={videoRequest}
            onVideoProgress={setVideoProgress}
            onVideoComplete={finishVideo}
          />
          <div className="map-heading">
            <span className="eyebrow">
              {storm ? storm.year : "EXPLORE THE BASIN"}
            </span>
            <h2>{storm ? storm.name : "The Western Pacific"}</h2>
            <p>
              {storm
                ? point?.forecast
                  ? "Forecast position"
                  : "Observed track"
                : "Philippines & surrounding waters"}
            </p>
          </div>
          <div className="layers">
            <label>
              <input
                type="checkbox"
                checked={satellite}
                onChange={(e) => {
                  setSatellite(e.target.checked);
                  setSatPlaying(false);
                }}
              />
              Satellite<span>IR</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={par}
                onChange={(e) => setPar(e.target.checked)}
              />
              PAR boundary
            </label>
            {satellite && (
              <label className="opacity">
                <span>Opacity</span>
                <input
                  aria-label="Satellite opacity"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </label>
            )}
          </div>
          {satellite && (
            <div className="satellite-control">
              <span className="eyebrow">HIMAWARI · INFRARED</span>
              {satError ? (
                <p role="alert">
                  {satError}{" "}
                  <button onClick={() => setRefresh((n) => n + 1)}>
                    Retry
                  </button>
                </p>
              ) : (
                <>
                  <strong>
                    {frame
                      ? `${timeLabel(stampISO(frameReady || frame))} · ${(frameReady || frame).slice(0, 4)}`
                      : "Finding latest imagery…"}
                  </strong>
                  <div className="satellite-playback">
                    <button
                      aria-label={
                        satPlaying
                          ? "Pause satellite playback"
                          : "Play satellite playback"
                      }
                      disabled={frames.length < 2}
                      onClick={() => setSatPlaying((p) => !p)}
                    >
                      {satPlaying ? "Ⅱ" : "▶"}
                    </button>
                    <label>
                      <span className="sr-only">Satellite frame</span>
                      <input
                        type="range"
                        min="0"
                        max={Math.max(0, frames.length - 1)}
                        value={Math.max(0, frames.indexOf(frame))}
                        disabled={!frames.length}
                        onChange={(e) => {
                          setSatPlaying(false);
                          setFrame(frames[Number(e.target.value)]);
                        }}
                      />
                    </label>
                    <button
                      className="satellite-save"
                      onClick={startVideo}
                      disabled={
                        frames.length < 2 || !frameReady || !videoSupported
                      }
                      aria-label="Download satellite playback video"
                      title={
                        videoSupported
                          ? "Download the visible map and satellite playback"
                          : "Video export is unavailable in this browser"
                      }
                    >
                      Save ↓
                    </button>
                  </div>
                  <small>
                    Near-real-time · {frames.length} recent frames. Independent
                    of storm replay.
                  </small>
                </>
              )}
            </div>
          )}
          {selectionError && (
            <div className="selection-error" role="alert">
              {selectionError}
            </div>
          )}
          {selection && !storm && !selectionError && (
            <div className="selection-error" role="status">
              Loading storm track…
            </div>
          )}
          {!selection && highlight && (
            <div className="map-intro">
              <span className="eyebrow">FROM THE ARCHIVE</span>
              <h3>A path worth revisiting.</h3>
              <p>Replay Haiyan’s 2013 track across the Pacific.</p>
              <button
                onClick={() => {
                  setMode("archive");
                  choose(highlight);
                }}
              >
                Explore Haiyan <span>→</span>
              </button>
            </div>
          )}
          {storm && point && (
            <div className="storm-detail">
              <div className="detail-top">
                <div>
                  <span className="eyebrow">
                    {point.forecast ? "FORECAST" : "OBSERVED"} ·{" "}
                    {storm.provisional ? "PRELIMINARY" : "BEST TRACK"}
                  </span>
                  <h3>{timeLabel(point.time)}</h3>
                </div>
                <button
                  className="close"
                  aria-label="Close selected storm"
                  onClick={() => {
                    setSelection("");
                    setPlaying(false);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="metrics">
                <div>
                  <small>SUSTAINED WIND</small>
                  <strong>{windLabel(point.wind)}</strong>
                </div>
                <div>
                  <small>PRESSURE</small>
                  <strong>
                    {point.pressure === null
                      ? "Not reported"
                      : `${point.pressure} hPa`}
                  </strong>
                </div>
                <div>
                  <small>POSITION</small>
                  <strong>
                    {Math.abs(point.lat).toFixed(1)}°
                    {point.lat >= 0 ? "N" : "S"} /{" "}
                    {Math.abs(point.lon).toFixed(1)}°
                    {point.lon >= 0 ? "E" : "W"}
                  </strong>
                </div>
              </div>
              <svg
                className="intensity-chart"
                viewBox="0 0 500 52"
                role="img"
                aria-label="Reported sustained winds along the storm track"
              >
                <path d="M0 48H500" stroke="currentColor" opacity=".15" />
                {windSamples.map((p, i) => {
                  const before = windSamples[i - 1];
                  const x =
                    (p.index / Math.max(storm.track.length - 1, 1)) * 500;
                  const y = 48 - ((p.wind || 0) / maximumWind) * 40;
                  const connect =
                    before &&
                    p.agency === before.agency &&
                    p.averagingMinutes === before.averagingMinutes &&
                    Date.parse(p.time) - Date.parse(before.time) <=
                      6 * 3600_000;
                  return (
                    <g key={p.index}>
                      {connect && (
                        <path
                          d={`M${(before.index / Math.max(storm.track.length - 1, 1)) * 500} ${48 - ((before.wind || 0) / maximumWind) * 40}L${x} ${y}`}
                          stroke={p.forecast ? "#cb9465" : "#bbdfb4"}
                          strokeWidth="1.5"
                          fill="none"
                        />
                      )}
                      <circle
                        cx={x}
                        cy={y}
                        r="1.7"
                        fill={p.forecast ? "#cb9465" : "#bbdfb4"}
                      />
                    </g>
                  );
                })}
                <path
                  d={`M${(position / Math.max(storm.track.length - 1, 1)) * 500} 0v52`}
                  stroke="#f3d7a7"
                  strokeDasharray="2 3"
                />
              </svg>
              <div className="playback">
                <button
                  aria-label={
                    playing ? "Pause storm playback" : "Play storm playback"
                  }
                  onClick={() => {
                    if (position >= storm.track.length - 1) setPosition(0);
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? "Ⅱ" : "▶"}
                </button>
                <input
                  aria-label="Storm timeline"
                  type="range"
                  min="0"
                  max={storm.track.length - 1}
                  value={position}
                  onChange={(e) => move(Number(e.target.value))}
                />
                <span>
                  {position + 1} / {storm.track.length}
                </span>
              </div>
              <div className="detail-source">
                <a href={storm.sourceUrl} target="_blank" rel="noreferrer">
                  {point.agency} ·{" "}
                  {point.averagingMinutes
                    ? `${point.averagingMinutes}-min winds`
                    : "Wind averaging not reported"}{" "}
                  ↗
                </a>
                <details className="track-download">
                  <summary aria-label={`Download ${storm.name} track`}>
                    Track ↓
                  </summary>
                  <div>
                    <button
                      onClick={(event) => {
                        downloadTrack(storm, "geojson");
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      GeoJSON
                    </button>
                    <button
                      onClick={(event) => {
                        downloadTrack(storm, "csv");
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      CSV
                    </button>
                  </div>
                </details>
                <span>Times in PHT</span>
              </div>
            </div>
          )}
          <div className="map-legend">
            <span>
              <i />
              Observed
            </span>
            <span>
              <i className="forecast-key" />
              Forecast
            </span>
            {satellite && <span>Imagery: JMA / RAMMB / CIRA</span>}
          </div>
        </section>
      </div>
      {videoRequest && (
        <div className="video-export-status" role="status">
          <div>
            <span>{videoProgress}</span>
            <small>Keep this tab visible until the download starts.</small>
          </div>
          <button onClick={() => videoController.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {videoError && (
        <div className="video-export-status" role="alert">
          <span>{videoError}</span>
          <button
            aria-label="Dismiss export error"
            onClick={() => setVideoError("")}
          >
            ×
          </button>
        </div>
      )}
      <footer className="footer">
        <span>
          Built by{" "}
          <a href="https://lesterjessh.space" target="_blank" rel="noreferrer">
            Lester Heyrana ↗
          </a>
        </span>
        <span>For exploration. Refer to PAGASA for official warnings.</span>
        <button onClick={() => setSources(true)}>Sources & methodology</button>
      </footer>
      {sources && (
        <div className="modal-backdrop" onClick={() => setSources(false)}>
          <section
            ref={modal}
            className="sources-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sources-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="close"
              aria-label="Close sources"
              onClick={() => setSources(false)}
            >
              ×
            </button>
            <span className="eyebrow">ABOUT THE DATA</span>
            <h2 id="sources-title">Every track has a source.</h2>
            <p>
              Current tracks and forecast positions come from{" "}
              <a
                href="https://www.panahon.gov.ph/"
                target="_blank"
                rel="noreferrer"
              >
                DOST-PAGASA Panahon ↗
              </a>
              . The feed is checked every five minutes. An unavailable feed is
              shown separately from a successful check with no current storms.
            </p>
            <p>
              Historical tracks use{" "}
              <a
                href="https://www.ncei.noaa.gov/products/international-best-track-archive"
                target="_blank"
                rel="noreferrer"
              >
                NOAA IBTrACS v04r01 ↗
              </a>
              , Western Pacific storms from 1951 onward. We retain WMO reporting
              agencies, missing values, and wind averaging periods. Wind values
              are converted from knots to km/h for display; measurements from
              different agencies are not interchangeable.
            </p>
            <p>
              Satellite imagery is Himawari infrared, distributed through{" "}
              <a
                href="https://slider.cira.colostate.edu/"
                target="_blank"
                rel="noreferrer"
              >
                RAMMB/CIRA SLIDER ↗
              </a>{" "}
              and reprojected for the map. Frame timestamps describe when the
              satellite observed the scene. Satellite playback is independent of
              archived storm playback.
            </p>
            <p>
              Forecast tracks are preliminary. Historical best tracks can be
              revised. This app does not issue weather warnings or predict
              storms.
            </p>
            <small>
              Archive generated:{" "}
              {archive ? timeLabel(archive.generated) : "Loading…"}. No
              analytics or account required.
            </small>
          </section>
        </div>
      )}
    </main>
  );
}
