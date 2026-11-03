"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { PAR, SATELLITE_BOUNDS, type Storm } from "@/lib/types";
import { timeLabel, unwrapTrack } from "@/lib/tracks";
import { loadSatelliteFrame } from "@/lib/satellite-frames";
import { ESRI_IMAGERY_SOURCE, type Basemap } from "@/lib/basemaps";
import { trackPointStyle } from "@/lib/track-style";
import {
  exportSatelliteVideo,
  type VideoExportRequest,
  type VideoExportResult,
} from "@/lib/satellite-video";
import "maplibre-gl/dist/maplibre-gl.css";

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
type Props = {
  basemap: Basemap;
  storm: Storm | null;
  position: number;
  onPosition: (value: number) => void;
  frame: string | null;
  satellite: boolean;
  opacity: number;
  par: boolean;
  onFrameReady: (frame: string) => void;
  onImageStatus?: (message: string, loading: boolean) => void;
  videoRequest: VideoExportRequest | null;
  onVideoProgress: (message: string) => void;
  onVideoComplete: (result: VideoExportResult | null, error?: string) => void;
};

export default function StormMap({
  basemap,
  storm,
  position,
  onPosition,
  frame,
  satellite,
  opacity,
  par,
  onFrameReady,
  onImageStatus,
  videoRequest,
  onVideoProgress,
  onVideoComplete,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null);
  const baseLayers = useRef<{ id: string; visibility: "visible" | "none" }[]>([]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [imageLoading, setImageLoading] = useState(false),
    [imageError, setImageError] = useState("");
  useEffect(() => {
    onImageStatus?.(satellite ? imageError : "", satellite && imageLoading);
  }, [satellite, imageLoading, imageError, onImageStatus]);
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
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    instance.on("load", () => {
      baseLayers.current = instance.getStyle().layers.map((layer) => ({
        id: layer.id,
        visibility: layer.layout?.visibility === "none" ? "none" : "visible",
      }));
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
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "classified"], true]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#fff", "line-width": 4.5, "line-opacity": 0.55 },
      });
      instance.addLayer({
        id: "track-glow", type: "line", source: "track",
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "classified"], true]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 6, "line-blur": 1.5, "line-opacity": 0.35 },
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
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"],
          "line-width": ["case", ["get", "classified"], 2.2, 1],
          "line-opacity": ["case", ["get", "classified"], 0.95, 0.6] },
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
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["get", "classified"], 2.2, 1],
          "line-dasharray": [4, 2],
          "line-opacity": 0.85,
        },
      });
      instance.addLayer({
        id: "positions",
        type: "circle",
        source: "track",
        filter: ["all", ["==", ["geometry-type"], "Point"],
          ["any", ["==", ["get", "classified"], true], ["==", ["get", "selected"], true]]],
        paint: {
          "circle-radius": ["case", ["get", "selected"], 6, 3.5],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
      instance.addLayer({
        id: "selected-position", type: "circle", source: "track",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "selected"], true]],
        paint: { "circle-radius": 12, "circle-color": ["get", "color"], "circle-opacity": 0.15,
          "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
      });
      instance.addLayer({
        id: "category-icons", type: "symbol", source: "track",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "category"], ""]],
        layout: {
          "icon-image": ["concat", "pagasa-", ["get", "category"]],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 6, 0.8, 9, 1],
          "icon-allow-overlap": true, "icon-ignore-placement": true,
          "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport",
        },
      });
      instance.addLayer({
        id: "category-labels", type: "symbol", source: "track",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "category"], ""]],
        layout: { "text-field": ["get", "categoryLabel"], "text-size": 10,
          "text-font": ["Noto Sans Regular"], "text-offset": [0, 1.6], "text-anchor": "top" },
        paint: { "text-color": "#1e293b", "text-halo-color": "#fffffff2", "text-halo-width": 1.5 },
      });
      instance.on("click", ["positions", "category-icons"], (e) => {
        const i = e.features?.[0]?.properties?.index;
        if (typeof i === "number") click.current(i);
      });
      instance.on("mouseenter", ["positions", "category-icons"], () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", ["positions", "category-icons"], () => {
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
    const imagery = basemap === "esri";
    if (imagery && !instance.getSource("esri-basemap")) {
      instance.addSource("esri-basemap", ESRI_IMAGERY_SOURCE);
      instance.addLayer({ id: "esri-basemap", type: "raster", source: "esri-basemap" },
        instance.getLayer("satellite") ? "satellite" : "par");
    }
    if (instance.getLayer("esri-basemap"))
      instance.setLayoutProperty("esri-basemap", "visibility", imagery ? "visible" : "none");
    for (const layer of baseLayers.current)
      instance.setLayoutProperty(layer.id, "visibility", imagery ? "none" : layer.visibility);
  }, [ready, basemap]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const coordinates = unwrapTrack(storm?.track || []);
    const features: FeatureCollection["features"] = [];
    if (storm) {
      storm.track.forEach((p, i) => {
        const style = trackPointStyle(p);
        if (i > 0) features.push({
          type: "Feature",
          properties: { forecast: !!p.forecast, color: style.color, classified: style.classified },
          geometry: { type: "LineString", coordinates: [coordinates[i - 1], coordinates[i]] },
        });
        features.push({
          type: "Feature",
          properties: {
            index: i,
            selected: i === position,
            forecast: !!p.forecast,
            ...style,
          },
          geometry: { type: "Point", coordinates: coordinates[i] },
        });
      });
    }
    (instance.getSource("track") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });
  }, [storm, position, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !storm) return;
    let cancelled = false;
    const categories = new Set(storm.track.map((p) => trackPointStyle(p).category));
    for (const category of categories) {
      if (!category || instance.hasImage(`pagasa-${category}`)) continue;
      void instance.loadImage(`/icons/pagasa/${category}.png`).then(async ({ data }) => {
        const pixels = typeof createImageBitmap === "function"
          ? await createImageBitmap(data, { resizeWidth: 96, resizeHeight: 96, resizeQuality: "high" })
          : data;
        try {
          if (!cancelled && !instance.hasImage(`pagasa-${category}`))
            instance.addImage(`pagasa-${category}`, pixels, { pixelRatio: pixels.width / 30 });
        } finally {
          if (pixels instanceof ImageBitmap) pixels.close();
        }
      }).catch(() => { /* The category-coloured circle remains as a fallback. */ });
    }
    return () => { cancelled = true; };
  }, [ready, storm]);
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
    map.current.fitBounds(bounds, { padding: 70, maxZoom: 4.5, duration: 700 });
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
          source.updateImage({ image, coordinates: SATELLITE_BOUNDS });
          instance.setLayoutProperty("satellite", "visibility", "visible");
        } else {
          instance.addSource("satellite", {
            type: "image",
            coordinates: SATELLITE_BOUNDS,
          });
          (instance.getSource("satellite") as maplibregl.ImageSource).updateImage({ image });
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
      {!onImageStatus && satellite && (imageLoading || imageError) && (
        <div className="image-status" role="status">
          {imageError || <>
            <span className="loading-spinner" aria-hidden="true" />
            <span className="sr-only">Loading satellite frame</span>
          </>}
        </div>
      )}
    </div>
  );
}
