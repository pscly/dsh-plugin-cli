#!/usr/bin/env node
/**
 * dsh-cli — scaffolding and validation for DeepSeek Harness plugins.
 *
 * `create` writes the smallest package that actually loads: a manifest with a
 * bundle patch, a patch row, a host entry and a browser entry. `check` reads an
 * existing package and reports the mistakes that make a plugin silently fail to
 * appear — the ones that cost the most time because nothing errors.
 *
 * Unofficial. Not the `dsh` CLI, which ships with DeepSeek Harness itself.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

const HELP = `dsh-cli ${VERSION} — DeepSeek Harness 插件脚手架与校验

用法
  dsh-cli create <目录> [--name 包名] [--id 插件id] [--force]
  dsh-cli check  [目录]         校验一个插件包（默认当前目录）
  dsh-cli --version

create 生成什么
  package.json        带 dsh.bundle.patch / dsh.client / exports
  cordis.patch.yml    把插件插进 profile 组合的一行
  lib/index.js        Host 入口（name / inject / apply）
  lib/client.js       Web 客户端入口（注册设置页 section）
  README.md           下一步怎么做

check 查什么
  - package.json 是否可解析、name/version 是否合法
  - dsh.bundle.patch 指向的文件是否存在
  - patch 里的 name 是否等于包的完整名（最常见的踩坑）
  - exports "." 与 "client" 指向的文件是否存在
  - 声明了 dsh.client 却没有 ./client 导出
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[name] = true;
      else {
        out[name] = next;
        i += 1;
      }
    } else out._.push(arg);
  }
  return out;
}

/** npm-safe id derived from a package name. */
function toId(name) {
  return name
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "my-plugin";
}

function template(ctx) {
  const { dirName, name, id } = ctx;

  const manifest = {
    name,
    version: "0.1.0",
    description: `${dirName} — a DeepSeek Harness plugin`,
    type: "module",
    main: "./lib/index.js",
    exports: {
      ".": "./lib/index.js",
      "./client": "./lib/client.js",
      "./package.json": "./package.json",
    },
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: {
        inject: [
          "@deepseek-ai/dsh-client-runtime",
          "@deepseek-ai/dsh-client-connection",
          "@deepseek-ai/dsh-client-ui-settings",
        ],
        platform: "web",
      },
    },
    files: ["lib", "cordis.patch.yml", "README.md"],
    peerDependencies: { "@deepseek-ai/cordis": "~4.1.0" },
    engines: { node: ">=22.19.0" },
    license: "MIT",
  };

  const patch = `# The profile composes this row. \`name\` must be the FULL package
# specifier as installed, quoted: a YAML scalar starting with \`@\` would be read
# as a directive, and a bare name that differs from the installed one fails to
# resolve at load time.
- insert:
    - id: ${id}
      name: "${name}"
`;

  const host = `/**
 * Host entry.
 *
 * \`inject\` names the services this plugin needs; an unknown one keeps the
 * plugin from mounting, so list only what you actually use. Everything
 * registered inside \`ctx.effect\` is disposed when the fiber reloads.
 */
export const name = ${JSON.stringify(id)};
export const inject = [];

/**
 * @param {any} ctx host context
 * @param {any} config the row's \`config\` object
 */
export function apply(ctx, config = {}) {
  ctx.effect(() => {
    ctx.logger?.info?.(\`[${id}] mounted\`);
    return () => {};
  }, "${id}: mount");
}
`;

  const client = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(id)},
  factory: (require) => {
    const react = require("react");
    var module = { exports: {} };
    var exports = module.exports;

    function Panel() {
      return react.createElement(
        "div",
        { style: { padding: 16, fontSize: 13 } },
        ${JSON.stringify(name)} + " 已加载",
      );
    }

    // The host fills these slots; \`settings.section\` adds a page under Settings.
    const inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          { name: "settings.section", id: ${JSON.stringify(id)}, order: 400, label: () => ${JSON.stringify(basename(name))} },
          Panel,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
`;

  const readme = `# ${name}

一个 DeepSeek Harness 插件。

## 开发

\`\`\`sh
dsh plugin --profile web add ./${dirName}
\`\`\`

装完重启 DSH，设置页里会出现「${basename(name)}」。

## 结构

| 文件 | 作用 |
|---|---|
| \`lib/index.js\` | Host 入口，导出 \`name\` / \`inject\` / \`apply\` |
| \`lib/client.js\` | 浏览器入口，通过 \`window.__ModuleLoader__\` 注册界面 |
| \`cordis.patch.yml\` | 把插件插进 profile 组合的那一行 |

## 校验

\`\`\`sh
npx dsh-cli check
\`\`\`

## 参考

- 上游：https://github.com/deepseek-ai/deepseek-harness
- 插件开发文档：见 DSH Desktop 仓库的 \`docs/plugin-development.md\`
`;

  return { manifest, patch, host, client, readme };
}

function cmdCreate(args) {
  const target = args._[0];
  if (typeof target !== "string") {
    console.error("缺少目标目录。用法：dsh-cli create <目录> [--name 包名]");
    process.exitCode = 1;
    return;
  }

  const dir = resolve(target);
  const dirName = basename(dir);
  const name = typeof args.name === "string" ? args.name : dirName;
  const id = typeof args.id === "string" ? args.id : toId(name);

  if (existsSync(dir) && readdirSync(dir).length > 0 && args.force !== true) {
    console.error(`${dir} 非空。加 --force 覆盖。`);
    process.exitCode = 1;
    return;
  }

  const files = template({ dirName, name, id });
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(files.manifest, null, 2) + "\n");
  writeFileSync(join(dir, "cordis.patch.yml"), files.patch);
  writeFileSync(join(dir, "lib", "index.js"), files.host);
  writeFileSync(join(dir, "lib", "client.js"), files.client);
  writeFileSync(join(dir, "README.md"), files.readme);

  console.log(`已创建 ${dir}`);
  console.log(`  包名 ${name}`);
  console.log(`  插件 id ${id}`);
  console.log("");
  console.log("下一步：");
  console.log(`  cd ${dirName}`);
  console.log(`  dsh plugin --profile web add ./${dirName}`);
  console.log(`  npx dsh-cli check`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function cmdCheck(args) {
  const dir = resolve(typeof args._[0] === "string" ? args._[0] : ".");
  const problems = [];
  const notes = [];

  const manifest = readJson(join(dir, "package.json"));
  if (manifest === undefined) {
    console.error(`${dir}/package.json 不存在或不是合法 JSON`);
    process.exitCode = 1;
    return;
  }

  if (typeof manifest.name !== "string" || manifest.name === "") {
    problems.push("package.json 缺少 name");
  }
  if (typeof manifest.version !== "string") problems.push("package.json 缺少 version");

  const patchRel = manifest?.dsh?.bundle?.patch;
  if (typeof patchRel !== "string") {
    problems.push("缺少 dsh.bundle.patch：DSH 不会把它当作 bundle 安装");
  } else {
    const patchPath = join(dir, patchRel);
    if (!existsSync(patchPath)) {
      problems.push(`dsh.bundle.patch 指向的 ${patchRel} 不存在`);
    } else {
      const text = readFileSync(patchPath, "utf8");
      // The row's `name` must be the installed specifier, not the row id.
      const names = [...text.matchAll(/^\s*name:\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((m) => m[1].trim());
      if (names.length === 0) problems.push(`${patchRel} 里没有 name 行`);
      else if (!names.includes(manifest.name)) {
        problems.push(`${patchRel} 里的 name (${names.join("、")}) 与包名 ${manifest.name} 不一致，装到 profile 后会 ERR_MODULE_NOT_FOUND`);
      }
      if (/^\s*name:\s*@/m.test(text)) {
        problems.push(`${patchRel} 的 name 以 @ 开头但没有引号，YAML 会解析失败`);
      }
    }
  }

  const mainRel = manifest?.exports?.["."] ?? manifest?.main;
  if (typeof mainRel !== "string") problems.push("缺少入口：exports[\".\"] 或 main");
  else if (!existsSync(join(dir, mainRel))) problems.push(`入口 ${mainRel} 不存在`);

  if (manifest?.dsh?.client !== undefined) {
    const clientRel = manifest?.exports?.["./client"];
    if (typeof clientRel !== "string") problems.push("声明了 dsh.client 却没有 exports[\"./client\"]");
    else if (!existsSync(join(dir, clientRel))) problems.push(`客户端入口 ${clientRel} 不存在`);
  }

  if (manifest?.dsh?.compatibility?.dsh !== undefined) {
    notes.push(`声明兼容 DSH ${manifest.dsh.compatibility.dsh}`);
  }

  console.log(`检查 ${dir}`);
  console.log(`  ${manifest.name ?? "?"}@${manifest.version ?? "?"}`);
  if (notes.length > 0) for (const note of notes) console.log(`  · ${note}`);
  console.log("");

  if (problems.length === 0) {
    console.log("✓ 没有发现问题");
    return;
  }
  for (const problem of problems) console.log(`✗ ${problem}`);
  console.log("");
  console.log(`${problems.length} 个问题。`);
  process.exitCode = 1;
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case "create":
      return cmdCreate(args);
    case "check":
      return cmdCheck(args);
    default:
      console.error(`未知命令：${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main();
