// Small helpers for the operator's settings files (.env.staging.local and friends). They read
// and update values in place and never print them: scripts report names and lengths only.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";

export type EnvFile = { path: string; lines: string[] };

export function readEnvFile(path: string): EnvFile {
  if (!fs.existsSync(path)) throw new Error(`${path} does not exist; copy .env.staging.example to it first`);
  return { path, lines: fs.readFileSync(path, "utf8").split(/\r?\n/) };
}

/** The last assignment wins, as when the app loads the file. Quotes around a value are removed. */
export function envValue(file: EnvFile, name: string): string | undefined {
  let value: string | undefined;
  for (const line of file.lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m && m[1] === name) value = m[2]!.trim().replace(/^"(.*)"$/, "$1");
  }
  return value === "" ? undefined : value;
}

/** Sets values (replacing every earlier line for each name) and writes the file. */
export function setEnvValues(file: EnvFile, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`${name}: values must be on one line (write a PEM with literal \\n)`);
    const kept = file.lines.filter((line) => !new RegExp(`^\\s*${name}\\s*=`).test(line));
    const at = file.lines.findIndex((line) => new RegExp(`^\\s*${name}\\s*=`).test(line));
    if (at >= 0) kept.splice(Math.min(at, kept.length), 0, `${name}=${value}`);
    else {
      while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
      kept.push(`${name}=${value}`);
    }
    file.lines = kept;
  }
  fs.writeFileSync(file.path, `${file.lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
  restrictToCurrentUser(file.path);
}

/**
 * Makes a file holding secrets or personal data readable by this user (and the operating
 * system) only. On Windows a new file otherwise inherits the folder's permissions, which can
 * let every local account read it; elsewhere mode 600 is enough.
 */
export function restrictToCurrentUser(filePath: string): void {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
    return;
  }
  const who = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  const sid = /"(S-1-[0-9-]+)"/.exec(who.stdout ?? "")?.[1];
  const user = sid ? `*${sid}` : `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ""}${process.env.USERNAME ?? ""}`;
  // *S-1-5-18 is the operating system (LocalSystem), named by its fixed id in every language.
  const result = spawnSync("icacls", [filePath, "/inheritance:r", "/grant:r", `${user}:F`, "*S-1-5-18:F"], { encoding: "utf8" });
  if (result.status !== 0) {
    console.warn(`[private-file] could not limit access to ${filePath} to this Windows user; check its permissions (Properties > Security).`);
  }
}

/** Visible one-line prompt: what is typed is not a command-line argument, so npm logs and shell history never hold it. */
export async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Hidden terminal prompt: typed characters are not echoed. Ctrl+C cancels. */
export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("run this in an interactive terminal: the value is typed at a hidden prompt");
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        // An empty Enter is ignored: the newline that started the command can arrive here.
        if ((ch === "\r" || ch === "\n") && value === "") continue;
        if (ch === "\r" || ch === "\n") return (done(), resolve(value));
        if (ch === "\u0003") return (done(), reject(new Error("cancelled")));
        if (ch === "\b" || ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
