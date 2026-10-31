import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const directory = join(tmpdir(), "bakas-himawari-v2");
const retention = 2 * 60 * 60_000;
let lastSweep = 0;
const valid = (stamp: number) => /^\d{14}$/.test(String(stamp));

/** Best-effort local cache: survives dev reloads; shared CDN caching covers visitors. */
export async function readStoredFrame(stamp: number): Promise<Buffer | null> {
  if (!valid(stamp)) return null;
  try {
    const path = join(directory, `${stamp}.png`);
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > retention || info.size > 8_000_000)
      return null;
    const png = await readFile(path);
    return png
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? png
      : null;
  } catch {
    return null;
  }
}

export async function storeFrame(stamp: number, png: Buffer): Promise<void> {
  if (!valid(stamp)) return;
  const temporary = join(directory, `${stamp}-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, png);
    await rename(temporary, join(directory, `${stamp}.png`));
    if (Date.now() - lastSweep < 30 * 60_000) return;
    lastSweep = Date.now();
    for (const name of await readdir(directory)) {
      if (!/^\d{14}(?:-[a-f0-9-]+)?\.(png|tmp)$/.test(name)) continue;
      const path = join(directory, name);
      try {
        if (Date.now() - (await stat(path)).mtimeMs > retention)
          await unlink(path);
      } catch {
        /* Another instance may have cleaned it. */
      }
    }
  } catch {
    await unlink(temporary).catch(() => {});
  }
}
