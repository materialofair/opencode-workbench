// adapters/office/plugin.ts
import { tool } from "@opencode-ai/plugin";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
var engine = fileURLToPath(new URL("../../office/", import.meta.url));
var localPython = join(engine, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
async function executeOffice(root, request, signal) {
  if (signal?.aborted)
    throw new Error("Office operation cancelled before execution");
  const encoded = JSON.stringify(request);
  if (Buffer.byteLength(encoded) > 1048576)
    throw new Error("Office request exceeds 1 MiB");
  const python = process.env.OPENCODE_OFFICE_PYTHON || localPython;
  if (!existsSync(python))
    throw new Error("Office Python environment missing. Follow docs/OFFICE.md offline setup.");
  return await new Promise((accept, reject) => {
    const child = spawn(python, ["-m", "office_engine", "--root", realpathSync(root)], {
      cwd: engine,
      shell: false,
      env: { ...process.env, PYTHONPATH: engine, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1" },
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
  office_capabilities: tool({ description: "Read the local versioned office protocol, supported fields and complete runnable examples BEFORE generating specs. No project files or network access.", args: { topic: tool.schema.enum(["overview", "inspect", "excel", "html"]).default("overview"), example: tool.schema.enum(["dashboard", "research", "project", "comparison", "operations"]).optional() }, execute: async (args) => {
    const protocol = JSON.parse(readFileSync(join(engine, "capabilities.json"), "utf8"));
    const result = args.topic === "overview" ? protocol : { protocol_version: protocol.protocol_version, [args.topic]: protocol[args.topic], shared_chart: protocol.shared_chart, outputs: protocol.outputs };
    if (args.example)
      result.example = JSON.parse(readFileSync(join(engine, "examples", args.example + ".json"), "utf8"));
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
