"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { PAR, SATELLITE_BOUNDS, type Storm } from "@/lib/types";
import { timeLabel, unwrapTrack } from "@/lib/tracks";
import { loadSatelliteFrame } from "@/lib/satellite-frames";
import {
  exportSatelliteVideo,
  type VideoExportRequest,
  type VideoExportResult,
} from "@/lib/satellite-video";
import "maplibre-gl/dist/maplibre-gl.css";

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
type Props = {
  storm: Storm | null;
  position: number;
  onPosition: (value: number) => void;
  frame: string | null;
  satellite: boolean;
  opacity: number;
  par: boolean;
  onFrameReady: (frame: string) => void;
  videoRequest: VideoExportRequest | null;
  onVideoProgress: (message: string) => void;
  onVideoComplete: (result: VideoExportResult | null, error?: string) => void;
};

export default function StormMap({
  storm,
  position,
  onPosition,
  frame,
  satellite,
  opacity,
  par,
  onFrameReady,
  videoRequest,
  onVideoProgress,
  onVideoComplete,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [imageLoading, setImageLoading] = useState(false),
    [imageError, setImageError] = useState("");
  const click = useRef(onPosition);
  useEffect(() => {
    click.current = onPosition;
  }, [onPosition]);
  useEffect(() => {
    if (!videoRequest || !ready || !map.current) return;
    const controller = new AbortController();
    const request = {
      ...videoRequest,
      signal: AbortSignal.any([videoRequest.signal, controller.signal]),
    };
    void exportSatelliteVideo(map.current, request, onVideoProgress)
      .then((result) => onVideoComplete(result))
      .catch((error) =>
        onVideoComplete(
          null,
          error.name === "AbortError" ? undefined : error.message,
        ),
      );
    return () => controller.abort();
  }, [videoRequest, ready, onVideoProgress, onVideoComplete]);
  useEffect(() => {
    if (!host.current) return;
    maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
    const instance = new maplibregl.Map({
      container: host.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [130, 17],
      zoom: 4.1,
      attributionControl: false,
    });
    map.current = instance;
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    instance.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    instance.on("load", () => {
      instance.addSource("par", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: PAR },
        },
      });
      instance.addLayer({
        id: "par",
        type: "line",
        source: "par",
        paint: {
          "line-color": "#437786",
          "line-width": 1.2,
          "line-dasharray": [5, 5],
          "line-opacity": 0.7,
        },
      });
      instance.addSource("track", { type: "geojson", data: empty });
      instance.addLayer({
        id: "track-shadow",
        type: "line",
        source: "track",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#fff", "line-width": 5, "line-opacity": 0.8 },
      });
      instance.addLayer({
        id: "observed",
        type: "line",
        source: "track",
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          ["==", ["get", "forecast"], false],
        ],
        paint: { "line-color": "#286357", "line-width": 2.5 },
      });
      instance.addLayer({
        id: "forecast",
        type: "line",
        source: "track",
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          ["==", ["get", "forecast"], true],
        ],
        paint: {
          "line-color": "#b66f42",
          "line-width": 2.5,
          "line-dasharray": [3, 2],
        },
      });
      instance.addLayer({
        id: "positions",
        type: "circle",
        source: "track",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["case", ["get", "selected"], 8, 3.5],
          "circle-color": [
            "case",
            ["get", "selected"],
            "#e9ad69",
            ["get", "forecast"],
            "#b66f42",
            "#286357",
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
      instance.on("click", "positions", (e) => {
        const i = e.features?.[0]?.properties?.index;
        if (typeof i === "number") click.current(i);
      });
      instance.on("mouseenter", "positions", () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "positions", () => {
        instance.getCanvas().style.cursor = "";
      });
      setReady(true);
    });
    instance.on("error", (e) => {
      if (!instance.isStyleLoaded()) setError(e.error.message);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const coordinates = unwrapTrack(storm?.track || []);
    const features: FeatureCollection["features"] = [];
    if (storm) {
      const observed = storm.track.flatMap((p, i) =>
        !p.forecast ? [coordinates[i]] : [],
      );
      const forecast = storm.track.flatMap((p, i) =>
        p.forecast ? [coordinates[i]] : [],
      );
      if (observed.length > 1)
        features.push({
          type: "Feature",
          properties: { forecast: false },
          geometry: { type: "LineString", coordinates: observed },
        });
      if (forecast.length && observed.length)
        forecast.unshift(observed.at(-1)!);
      if (forecast.length > 1)
        features.push({
          type: "Feature",
          properties: { forecast: true },
          geometry: { type: "LineString", coordinates: forecast },
        });
      storm.track.forEach((p, i) =>
        features.push({
          type: "Feature",
          properties: {
            index: i,
            selected: i === position,
            forecast: !!p.forecast,
          },
          geometry: { type: "Point", coordinates: coordinates[i] },
        }),
      );
    }
    (instance.getSource("track") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });
  }, [storm, position, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !storm?.track.length) return;
    const coordinates = unwrapTrack(storm.track);
    const last = storm.track.length - 1;
    const endLabel = storm.track[last].forecast
      ? "Forecast end"
      : storm.id.startsWith("live-")
        ? "Latest"
        : "End";
    const endpoints =
      last === 0
        ? [{ index: 0, label: `Start / ${endLabel.toLowerCase()}`, end: false }]
        : [
            { index: 0, label: "Start", end: false },
            { index: last, label: endLabel, end: true },
          ];
    const markers = endpoints.map(({ index, label, end }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `track-endpoint${end ? " track-endpoint-end" : ""}`;
      button.textContent = label;
      button.title = `${label} · ${timeLabel(storm.track[index].time)}`;
      button.setAttribute("aria-label", `${label} of ${storm.name} track`);
      button.addEventListener("click", () => click.current(index));
      return new maplibregl.Marker({
        element: button,
        anchor: end ? "top" : "bottom",
        offset: [0, end ? 13 : -13],
      })
        .setLngLat(coordinates[index])
        .addTo(instance);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [storm, ready]);
  useEffect(() => {
    if (!ready || !map.current || !storm) return;
    const coords = unwrapTrack(storm.track);
    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    map.current.fitBounds(bounds, { padding: 70, maxZoom: 6, duration: 700 });
  }, [storm, ready]);
  useEffect(() => {
    if (ready)
      map.current?.setLayoutProperty(
        "par",
        "visibility",
        par ? "visible" : "none",
      );
  }, [par, ready]);
  useEffect(() => {
    if (ready && map.current?.getLayer("satellite"))
      map.current.setPaintProperty("satellite", "raster-opacity", opacity);
  }, [opacity, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (!satellite || !frame) {
      if (instance.getLayer("satellite"))
        instance.setLayoutProperty("satellite", "visibility", "none");
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    setImageLoading(true);
    setImageError("");
    loadSatelliteFrame(frame)
      .then(async (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        if (cancelled) return;
        const source = instance.getSource("satellite") as
          maplibregl.ImageSource | undefined;
        if (source) {
          source.updateImage({ url: objectUrl, coordinates: SATELLITE_BOUNDS });
          instance.setLayoutProperty("satellite", "visibility", "visible");
        } else {
          instance.addSource("satellite", {
            type: "image",
            url: objectUrl,
            coordinates: SATELLITE_BOUNDS,
          });
          instance.addLayer(
            {
              id: "satellite",
              type: "raster",
              source: "satellite",
              paint: { "raster-opacity": opacity, "raster-fade-duration": 250 },
            },
            "par",
          );
        }
        setImageLoading(false);
        onFrameReady(frame);
      })
      .catch((e) => {
        if (!cancelled) {
          setImageError(e.message);
          setImageLoading(false);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Opacity changes update the paint without reloading the image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, satellite, frame, onFrameReady]);
  return (
    <div
      className="map-host"
      ref={host}
      data-ready={ready}
      aria-label="Interactive typhoon track map"
    >
      {(!ready || error) && (
        <div className="map-message" role="status">
          {error
            ? "The basemap could not load. Check your connection."
            : "Loading the Western Pacific…"}
        </div>
      )}
      {satellite && (imageLoading || imageError) && (
        <div className="image-status" role="status">
          {imageError || "Loading satellite frame…"}
        </div>
      )}
    </div>
  );
}
