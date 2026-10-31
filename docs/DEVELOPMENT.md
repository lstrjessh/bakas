# Development

Node 22.12+ and Python 3.10+ are required. Run `npm install`, `npm run dev`; the app serves at http://localhost:3002. The MapLibre worker is copied locally on install. `npm run build` and `npm test` validate the app. `python -m unittest discover -s tests -p "test_*.py"` checks archive ingestion.

Run `npm run ingest` to refresh the full Western Pacific archive. This streams the upstream CSV and writes a compact index and one JSON file per storm. Existing data is replaced only after the complete upstream download parses successfully. Commit the resulting files to make them available in a deployment.

## Deployment

Import this repository into Vercel as a Next.js app. Use the default build command and output settings. No database or environment variables are required for the base app. Server routes require Node (not static export). Satellite rendering uses Sharp, so keep the Node runtime.

CDN caching shares rendered satellite frames among visitors. Process caches deduplicate work within an instance. A best-effort PNG cache in the system temporary directory retains frames for two hours across local reloads; serverless temporary storage is ephemeral and not shared across instances. A new instance may still render a cold frame. The browser keeps up to ten downloaded frames, preloads the next frame after the current one is ready, and warms the rest of the loop with at most two preload workers when playback starts. Previous imagery stays visible with its actual timestamp while the next frame loads. The resolution remains 1800 × 1180. Recent satellite images cover the Philippines crop; archived track replay covers the wider Western Pacific.

Automation templates are in `docs/automation/`. Copy them into `.github/workflows/` using a GitHub credential with the `workflow` scope to activate them. The archive template refreshes three times weekly and commits updated static data; GitHub Actions write permission must be enabled. The templates are not active in this repository by default.

## Optional durable advisory snapshots

The live API works without storage. To retain forecast revisions, activate the `snapshot-advisories` template, configure an S3-compatible bucket, and set its secrets: `BAKAS_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, and optionally `S3_ENDPOINT_URL`. The workflow stores timestamped current-advisory JSON every 30 minutes. It skips storage when the required configuration is absent; no storage account is created automatically. Keep the bucket private unless you deliberately expose the files. This first UI does not browse saved forecast revisions.

Official sources can be unavailable or change their formats. The app exposes separate feed, archive, and satellite errors. A storm link stores its ID and replay step in the URL; there are no user accounts, analytics, or application cookies.
