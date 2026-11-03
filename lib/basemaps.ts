import type { RasterSourceSpecification } from "maplibre-gl";

export type Basemap = "map" | "esri";

export const BASEMAP_OPTIONS = [
  { value: "map", label: "Map", preview: "/images/basemap-previews/light.webp" },
  { value: "esri", label: "Esri Satellite", preview: "/images/basemap-previews/satellite.webp" },
] as const;

export const ESRI_IMAGERY_SOURCE: RasterSourceSpecification = {
  type: "raster",
  tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
  tileSize: 256,
  maxzoom: 18,
  attribution: 'Imagery © <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community',
};
