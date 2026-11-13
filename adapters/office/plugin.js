// adapters/office/plugin.ts
import { tool } from "@opencode-ai/plugin";
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync2, readFileSync as readFileSync2, realpathSync as realpathSync2 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { join as join2 } from "node:path";

// adapters/office/validate.ts
import { spawn } from "node:child_process";
import { existsSync, lstatSync, realpathSync, statSync, readFileSync } from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, win32 } from "node:path";
import { fileURLToPath } from "node:url";
var script = fileURLToPath(new URL("../../office/qa-html.mjs", import.meta.url));
var inside = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/"));
};
function segments(path) {
  if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\x00") || isAbsolute(path) || win32.isAbsolute(path) || path.split(/[\\/]/).some((p) => p === ".." || p === ""))
    throw new Error("Expected bounded project-relative path without empty or parent segments");
  return path.split(/[\\/]/);
}
function validateHtmlPaths(root, input, output) {
  root = realpathSync(root);
  const inputPath = realpathSync(join(root, ...segments(input)));
  if (!inside(root, inputPath) || !statSync(inputPath).isFile() || extname(inputPath).toLowerCase() !== ".html")
    throw new Error("HTML input must be an existing .html file inside the project");
  const proposed = join(root, ...segments(output));
  const parent = realpathSync(dirname(proposed));
  if (!inside(root, parent))
    throw new Error("Evidence directory parent escapes project");
  const outputPath = join(parent, basename(proposed));
  try {
    lstatSync(outputPath);
    throw new Error("Evidence directory already exists; use a new path");
  } catch (e) {
    if (e.code !== "ENOENT")
      throw e;
  }
  return { root, inputPath, outputPath };
}
function nodeExecutable() {
  const configured = process.env.OPENCODE_OFFICE_NODE;
  if (configured) {
    if (!isAbsolute(configured) || !existsSync(configured))
      throw new Error("OPENCODE_OFFICE_NODE must identify a preinstalled absolute Node executable");
    return realpathSync(configured);
  }
  if (/^node(?:\.exe)?$/i.test(basename(process.execPath)))
    return process.execPath;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(dir))
      continue;
    const candidate = join(dir, process.platform === "win32" ? "node.exe" : "node");
    if (existsSync(candidate) && statSync(candidate).isFile())
      return realpathSync(candidate);
  }
  throw new Error("Preinstalled Node unavailable; no runtime download attempted");
}
function environment() {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_CHROMIUM_EXECUTABLE"])
    if (process.env[key] !== undefined)
      env[key] = process.env[key];
  return env;
}
async function executeHtmlValidation(root, input, output, signal) {
  const failed = (status, error) => JSON.stringify({ ok: false, status, error: error.slice(0, 2048), evidence_directory: output, warning: "Inspect partial evidence before retry; use a new output directory." });
  if (signal?.aborted)
    return failed("cancelled", "Validation cancelled before execution");
  let paths, node;
  try {
    paths = validateHtmlPaths(root, input, output);
    node = nodeExecutable();
  } catch (error) {
    return failed("failed", String(error));
  }
  return new Promise((resolve) => {
    const child = spawn(node, [script, paths.inputPath, paths.outputPath, "--timeout-ms", "90000"], { cwd: paths.root, shell: false, detached: process.platform !== "win32", env: environment(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", terminal, settled = false;
    let forceTimer;
    const finish = (value) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer)
        clearTimeout(forceTimer);
      signal?.removeEventListener("abort", cancel);
      resolve(value);
    };
    const stop = (reason) => {
      if (terminal)
        return;
      terminal = reason;
      if (child.pid) {
        if (process.platform === "win32") {
          const system = process.env.SystemRoot || process.env.SYSTEMROOT;
          if (system) {
            const killer = spawn(join(system, "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { shell: false, stdio: "ignore", env: environment() });
            killer.on("error", () => child.kill("SIGKILL"));
          } else
            child.kill("SIGKILL");
        } else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }
      forceTimer = setTimeout(() => finish(failed("failed", reason + "; process termination could not be confirmed")), 3000);
    };
    const cancel = () => stop("Validation cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => stop("Validation exceeded 95 second host deadline"), 95000);
    child.stdout.on("data", (chunk) => {
      if (terminal)
        return;
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 1048576)
        stop("Validation report exceeds 1 MiB");
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(0, 2048);
    });
    child.on("error", (error) => finish(failed("failed", String(error))));
    child.on("close", (code) => {
      if (terminal) {
        finish(failed(terminal.includes("cancelled") ? "cancelled" : "failed", terminal));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.version !== 2 || typeof result.passed !== "boolean" || !Array.isArray(result.evidence) || !["passed", "failed", "blocked", "unsupported", "limited"].includes(result.status))
          throw new Error("Invalid QA result schema");
        if (code === 0 !== result.passed)
          throw new Error("QA exit/result mismatch");
        for (const e of result.evidence)
          if (typeof e.filename !== "string" || basename(e.filename) !== e.filename || /[\\/]/.test(e.filename))
            throw new Error("Unsafe evidence filename");
        if (result.passed) {
          if (!existsSync(paths.outputPath) || lstatSync(paths.outputPath).isSymbolicLink() || !statSync(paths.outputPath).isDirectory())
            throw new Error("Missing or unsafe evidence directory");
          const canonical = realpathSync(paths.outputPath);
          if (!inside(paths.root, canonical))
            throw new Error("Evidence directory escapes project");
          for (const item of [{ filename: "report.json", max: 1048576 }, ...result.evidence.map((e) => ({ filename: e.filename, max: 16777216, bytes: e.bytes }))]) {
            const file = join(canonical, item.filename), info = lstatSync(file);
            if (!info.isFile() || info.isSymbolicLink() || !inside(canonical, realpathSync(file)) || info.size > item.max || "bytes" in item && info.size !== item.bytes)
              throw new Error("Missing, unsafe or inconsistent evidence file: " + item.filename);
          }
          if (JSON.stringify(JSON.parse(readFileSync(join(canonical, "report.json"), "utf8"))) !== JSON.stringify(result))
            throw new Error("Persisted QA report differs from stdout");
        }
        finish(JSON.stringify({ ok: result.passed, status: result.status, evidence_directory: output, report: result }));
      } catch (error) {
        finish(failed("failed", `Invalid validation response (${code}): ${String(error)} ${stderr}`));
      }
    });
    if (signal?.aborted)
      cancel();
  });
}

// adapters/office/plugin.ts
var engine = fileURLToPath2(new URL("../../office/", import.meta.url));
var localPython = join2(engine, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
function workerEnvironment() {
  const env = { PYTHONPATH: engine, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" };
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "LANG", "LC_ALL"])
    if (process.env[key] !== undefined)
      env[key] = process.env[key];
  return env;
}
async function executeOffice(root, request, signal) {
  if (signal?.aborted)
    throw new Error("Office operation cancelled before execution");
  const encoded = JSON.stringify(request);
  if (Buffer.byteLength(encoded) > 1048576)
    throw new Error("Office request exceeds 1 MiB");
  const python = process.env.OPENCODE_OFFICE_PYTHON || localPython;
  if (!existsSync2(python))
    throw new Error("Office Python environment missing. Follow docs/OFFICE.md offline setup.");
  return await new Promise((accept, reject) => {
    const child = spawn2(python, ["-m", "office_engine", "--root", realpathSync2(root)], {
      cwd: engine,
      shell: false,
      env: workerEnvironment(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "", err = "", settled = false;
    const finish = (error) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error)
        reject(error);
      else
        accept(out);
    };
    const cancel = () => {
      child.kill("SIGKILL");
      finish(new Error("Office operation cancelled; inspect output before retry"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Office execution exceeded 120 seconds; check output before retry"));
    }, 120000);
    child.stdout.on("data", (bytes) => {
      out += bytes;
      if (Buffer.byteLength(out) > 8388608) {
        child.kill("SIGKILL");
        finish(new Error("Office report exceeds 8 MiB"));
      }
    });
    child.stderr.on("data", (bytes) => {
      if (err.length < 2048)
        err += bytes;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(out || `Office engine failed (${code}): ${err}`));
        return;
      }
      try {
        const result = JSON.parse(out);
        if (result.ok !== true)
          throw new Error("Invalid office result");
        finish();
      } catch {
        finish(new Error("Invalid office engine response"));
      }
    });
    child.stdin.on("error", () => {});
    if (signal?.aborted)
      cancel();
    else
      child.stdin.end(encoded);
  });
}
var OfficeArtifacts = async (ctx) => ({ tool: {
  office_validate_html: tool({ description: "Validate an existing project HTML in fresh static offline Chromium contexts. Requests and JavaScript disabled. Writes NEW screenshot/PDF/JSON evidence directory. Browser-context isolation, not OS sandbox. Script-dependent HTML is unsupported; screenshots require visual review.", args: { input: tool.schema.string().max(4096), output: tool.schema.string().max(4096).describe("New project-relative evidence directory; parent must exist") }, execute: async (args, context) => {
    validateHtmlPaths(ctx.directory, args.input, args.output);
    await context.ask({ permission: "read", patterns: [args.input], always: [], metadata: { operation: "office_validate_html" } });
    if (context.abort.aborted)
      return JSON.stringify({ ok: false, status: "cancelled", error: "Cancelled before output approval" });
    await context.ask({ permission: "edit", patterns: [args.output + "/**"], always: [], metadata: { operation: "office_validate_html" } });
    return executeHtmlValidation(ctx.directory, args.input, args.output, context.abort);
  } }),
  office_capabilities: tool({ description: "Read the local versioned office protocol, supported fields and complete runnable examples BEFORE generating specs. No project files or network access.", args: { topic: tool.schema.enum(["overview", "inspect", "excel", "html"]).default("overview"), example: tool.schema.enum(["dashboard", "research", "project", "comparison", "operations"]).optional() }, execute: async (args) => {
    const protocol = JSON.parse(readFileSync2(join2(engine, "capabilities.json"), "utf8"));
    const result = args.topic === "overview" ? protocol : { protocol_version: protocol.protocol_version, [args.topic]: protocol[args.topic], shared_chart: protocol.shared_chart, outputs: protocol.outputs };
    if (args.example)
      result.example = JSON.parse(readFileSync2(join2(engine, "examples", args.example + ".json"), "utf8"));
    return JSON.stringify(result);
  } }),
  office_inspect_excel: tool({ description: "Read-only local workbook analysis with charts, formulas, cached values and feature risk inventory. Never executes macros or recalculates formulas.", args: { input: tool.schema.string(), options: tool.schema.string().optional().describe("Optional bounded inspection options as JSON") }, execute: async (args, context) => {
    await context.ask({ permission: "read", patterns: [args.input], always: [], metadata: { operation: "office_inspect_excel" } });
    if (context.abort.aborted)
      throw new Error("Office operation cancelled");
    return executeOffice(ctx.directory, { operation: "inspect_excel", input: args.input, options: args.options ? JSON.parse(args.options) : undefined }, context.abort);
  } }),
  office_generate_excel: tool({ description: "Generate a NEW local XLSX from validated JSON: multiple sheets, native charts, formulas and styles. Never overwrites. Formula cache is not a calculation engine.", args: { spec: tool.schema.string().max(1e6), output: tool.schema.string() }, execute: async (args, context) => {
    await context.ask({ permission: "edit", patterns: [args.output], always: [], metadata: { operation: "office_generate_excel" } });
    if (context.abort.aborted)
      throw new Error("Office operation cancelled");
    return executeOffice(ctx.directory, { operation: "generate_excel", spec: JSON.parse(args.spec), output: args.output }, context.abort);
  } }),
  office_render_html: tool({ description: "Render a NEW self-contained offline HTML report using scenario layouts, structured sections and SVG charts. No PPT conversion or external requests.", args: { spec: tool.schema.string().max(1e6), output: tool.schema.string() }, execute: async (args, context) => {
    await context.ask({ permission: "edit", patterns: [args.output], always: [], metadata: { operation: "office_render_html" } });
    if (context.abort.aborted)
      throw new Error("Office operation cancelled");
    return executeOffice(ctx.directory, { operation: "render_html", spec: JSON.parse(args.spec), output: args.output }, context.abort);
  } })
} });
export {
  executeOffice,
  OfficeArtifacts
};
