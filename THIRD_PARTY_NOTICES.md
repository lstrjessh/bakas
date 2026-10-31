# Source provenance

Reused with the project owner's authorization from the local GAKIT codebase:

- `lib/server/himawari.ts`: `project-gakit-client-2026/lib/server/himawariSlider.ts` (Himawari acquisition and reprojection).
- `lib/server/cache.ts`: `project-gakit-client-2026/lib/backend/apiCache.ts` (request deduplication).
- `app/api/satellite/route.ts`: `project-gakit-client-2026/app/api/himawari-proxy/route.ts`.
- `lib/server/cyclones.ts`: TypeScript adaptation of the Panahon session and track parsing in `project-gakit-server-2026/src/modules/typhoon/ports.py`.

External data and projection references are documented in [Data provenance](docs/DATA.md). This notice does not grant redistribution rights to upstream GAKIT source.
