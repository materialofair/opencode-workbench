// adapters/feishu/plugin.ts
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// src/platform.ts
import { win32, posix } from "node:path";
import { mkdirSync, chmodSync, statSync } from "node:fs";
import { homedir } from "node:os";
function directoryKey(directory, platform = process.platform) {
  if (platform !== "win32")
    return directory;
  const normal = win32.normalize(directory).replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  return normal.toLowerCase();
}
function sameOwnerDirectory(left, right, platform = process.platform, identify = (path) => statSync(path, { bigint: true })) {
  if (directoryKey(left, platform) === directoryKey(right, platform))
    return true;
  if (platform !== "win32")
    return false;
  try {
    const a = identify(left), b = identify(right);
    return a.isDirectory() && b.isDirectory() && a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}
function expandOwnerDirectory(value, env = process.env, home = homedir()) {
  return value.replace(/^~(?=[\\/]|$)/, () => home).replace(/\$\{(\w+)\}/g, (_, key) => env[key] ?? "");
}

// adapters/feishu/plugin.ts
var FeishuDesktop = async (ctx) => {
  const config = process.env.OPENCODE_WORKBENCH_FEISHU_CONFIG || join(homedir2(), ".config", "opencode", "plugins", "feishu.json");
  if (!existsSync(config))
    return {};
  const parsed = JSON.parse(readFileSync(config, "utf8"));
  if (typeof parsed.directory !== "string" || !parsed.directory.trim())
    throw new Error("Feishu adapter requires an explicit owner directory to avoid duplicate gateway connections");
  const owner = expandOwnerDirectory(parsed.directory);
  if (!sameOwnerDirectory(realpathSync(owner), realpathSync(ctx.directory)))
    return {};
  const browserConfig = process.env.OPENCODE_WORKBENCH_BROWSER_CONFIG || join(ctx.directory, ".opencode", "workbench-browser.json");
  if (existsSync(browserConfig) && JSON.parse(readFileSync(browserConfig, "utf8")).enabled === true) {
    if (!Array.isArray(parsed.allowedSenderIDs) || !parsed.allowedSenderIDs.length || !Array.isArray(parsed.allowedChatIDs) || !parsed.allowedChatIDs.length)
      throw new Error("Feishu browser projects require explicit allowedSenderIDs and allowedChatIDs in the private bot configuration");
  }
  const built = fileURLToPath(new URL("../../.data/feishu/dist/index.desktop.js", import.meta.url));
  if (!existsSync(built))
    throw new Error("Run bun scripts/prepare-feishu.ts before enabling the Feishu adapter");
  const module = await import(pathToFileURL(built).href);
  return module.FeishuPlugin(ctx);
};
export {
  FeishuDesktop
};
