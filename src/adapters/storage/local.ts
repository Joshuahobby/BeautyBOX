import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { assertMediaKey, type MediaStorage } from "./types";

// Development storage on the local disk under .local/media/<APP_ENV>/ (git-ignored), with
// the same staging / private / public areas as hosted storage. Production configuration
// refuses it (src/server/env.ts).

type Area = "staging" | "private" | "public";

export class LocalMediaStorage implements MediaStorage {
  readonly provider = "LOCAL" as const;

  constructor(
    private readonly root: string,
    private readonly origin: string,
  ) {}

  private file(area: Area, key: string): string {
    assertMediaKey(key);
    const base = path.resolve(this.root, area);
    const full = path.resolve(base, key);
    if (!full.startsWith(base + path.sep)) throw new Error("Invalid media key");
    return full;
  }

  async uploadTarget(stagingKey: string): Promise<string> {
    assertMediaKey(stagingKey);
    const uploadId = stagingKey.slice("staging/".length);
    return `${this.origin.replace(/\/$/, "")}/api/v1/staff/media/${uploadId}/content`;
  }

  async putStaging(key: string, bytes: Buffer): Promise<void> {
    const file = this.file("staging", key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }

  async readStaging(key: string): Promise<Buffer | null> {
    return fs.readFile(this.file("staging", key)).catch(() => null);
  }

  async deleteStaging(key: string): Promise<void> {
    await fs.rm(this.file("staging", key), { force: true });
  }

  async putPrivate(key: string, bytes: Buffer): Promise<void> {
    const file = this.file("private", key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Immutable keys: never overwrite an existing object.
    await fs.writeFile(file, bytes, { flag: "wx" });
  }

  async readPrivate(key: string): Promise<Buffer | null> {
    const found = await fs.readFile(this.file("private", key)).catch(() => null);
    // Before DR-041, local product photos were written straight to the public area.
    return found ?? (await fs.readFile(this.file("public", key)).catch(() => null));
  }

  async publish(key: string): Promise<void> {
    const target = this.file("public", key);
    if (await fs.stat(target).then(() => true, () => false)) return;
    const bytes = await fs.readFile(this.file("private", key));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }

  async unpublish(key: string): Promise<void> {
    const privateFile = this.file("private", key);
    const publicFile = this.file("public", key);
    if (!(await fs.stat(privateFile).then(() => true, () => false)) && (await fs.stat(publicFile).then(() => true, () => false))) {
      // A photo stored before DR-041 lives only in the public area: keep it, privately.
      await fs.mkdir(path.dirname(privateFile), { recursive: true });
      await fs.rename(publicFile, privateFile);
      return;
    }
    await fs.rm(publicFile, { force: true });
  }

  /** Test and inspection hook: whether a public copy exists. */
  async isPublic(key: string): Promise<boolean> {
    return fs.stat(this.file("public", key)).then(() => true, () => false);
  }
}
