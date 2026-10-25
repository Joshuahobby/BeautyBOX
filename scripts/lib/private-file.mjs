// Limits a new file holding secrets to the current user (and the operating system). On Windows a
// new file otherwise inherits the folder's permissions, which can let every local account read
// it; `mode: 0o600` does nothing there. Same rule as restrictToCurrentUser in env-file.ts.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

export function restrictToCurrentUser(filePath) {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
    return;
  }
  const who = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  const sid = /"(S-1-[0-9-]+)"/.exec(who.stdout ?? "")?.[1];
  const user = sid ? `*${sid}` : `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ""}${process.env.USERNAME ?? ""}`;
  // *S-1-5-18 is the operating system (LocalSystem), named by its fixed id in every language.
  const result = spawnSync("icacls", [filePath, "/inheritance:r", "/grant:r", `${user}:F`, "*S-1-5-18:F"], { encoding: "utf8" });
  if (result.status !== 0) console.warn(`[private-file] could not limit access to ${filePath} to this Windows user; check its permissions (Properties > Security).`);
}

/** Writes a file holding secrets; a file created here is limited to this user before anything is in it. */
export function writePrivateFile(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", { mode: 0o600 });
    restrictToCurrentUser(filePath);
  }
  fs.writeFileSync(filePath, content, { mode: 0o600 });
}
