#!/usr/bin/env node
/**
 * postbuild.mjs — 给 dist 目录所有 .js 文件的 relative import 自动加 .js 后缀
 *
 * 背景 (v1.3.3 -> v1.3.4 fix, 2026-07-13):
 * tsconfig.json 用了 "moduleResolution": "Bundler", emit 时 tsc 不加 .js extension.
 * Node 24 ESM 严格要 .js extension, 任何 `import { X } from "./errors"` 会
 * ERR_MODULE_NOT_FOUND 除非 import path 自身带 .js.
 *
 * 解决: 走 tsconfig 不变 (开发体验保持原状),
 *       但对发布出去的 dist 目录加 .js 后缀 —— 此脚本就是为这步服务.
 *
 * 作用范围:
 *   - 扫描 dist 目录下所有 .js 文件 (recursive)
 *   - 识别 import / export / dynamic import / import.meta.resolve 的 `from "X"` 部分
 *   - 如果 X 是相对路径 ("./..." 或 "../...") 且无 .js/.json/.mjs/.cjs 后缀
 *     -> 检查目标: file (./X.js) 或 directory (./X/index.js), 选存在的那个
 *   - 不动 absolute / node:fs 之类 built-in / http URL / 已带 extension 的
 *
 * 挂接方式 (npm run build 自动 invoke):
 *   package.json: "scripts": { "build": "tsc", "postbuild": "node scripts/postbuild.mjs" }
 *
 * 副作用:
 *   - 0 副作用到 src/, dev workflow 不变
 *   - dist 是 ephemeral build 产物, postbuild 修改 OK
 *   - 脚本本身不发到 npm (per package.json files = ["dist", "README.md", "LICENSE"])
 *
 * 写于: 2026-07-13 (post 1.3.3 audit, 路径 Y 拍板; v2 修复 directory imports)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.argv[2] || 'dist';

/**
 * 匹配 ESM 4 类 source 引用的 from 子句
 */
const RX =
  /((?:^|\n|;|}\s*\n\s*)(?:import\b[^"';]*?\bfrom\s*|export\b[^"';]*?\bfrom\s*|import\s*\(|import\.meta\.resolve\s*\())(['"])([^'"\n]+)\2/g;

function shouldRewrite(src) {
  if (!src.startsWith('./') && !src.startsWith('../')) return false;
  if (/\.(js|mjs|cjs|json|node)$/.test(src)) return false;
  if (src.endsWith('/')) return false;
  if (/[?#]/.test(src)) return false;
  return true;
}

/**
 * 决定 ./X 应该 append .js (file) 还是 /index.js (directory)
 *   import "./X"  ->  ./X.js   if dist/X.js exists
 *                  ->  ./X/index.js   if dist/X/index.js exists
 *                  ->  ./X.js   (fall back — build 时应当 at least 1 个存在)
 */
async function resolveRewrite(fromFile, src) {
  const baseDir = path.dirname(fromFile);
  const targetNoExt = path.resolve(baseDir, src);

  try {
    const statFile = await fs.stat(targetNoExt + '.js');
    if (statFile.isFile()) return src + '.js';
  } catch {
    // not a file
  }

  try {
    const statDir = await fs.stat(targetNoExt + '/index.js');
    if (statDir.isFile()) return src + '/index.js';
  } catch {
    // not a directory
  }

  // fallback: 假设 file (build 应当至少一个存在)
  return src + '.js';
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

let totalFiles = 0;
let totalRewritten = 0;
let totalImportsScanned = 0;

for (const file of await walk(ROOT_DIR)) {
  const code = await fs.readFile(file, 'utf8');
  let rewrote = 0;
  let scanned = 0;
  const replacements = []; // { match, newSrc } 按 src 顺序收集, 然后再 substitute (因为 async)

  // 第 1 轮:scan + resolve
  let m;
  RX.lastIndex = 0;
  while ((m = RX.exec(code)) !== null) {
    scanned++;
    const matchText = m[0];
    const prefix = m[1];
    const quote = m[2];
    const src = m[3];
    if (!shouldRewrite(src)) continue;
    const newSrc = await resolveRewrite(file, src);
    if (newSrc !== src) {
      const replacement = prefix + quote + newSrc + quote;
      replacements.push({ start: m.index, end: m.index + matchText.length, replacement });
      rewrote++;
    }
  }

  if (rewrote === 0) {
    totalFiles++;
    totalImportsScanned += scanned;
    continue;
  }

  // 第 2 轮:按 start 倒序 substitute (避免 index 漂移)
  let newCode = code;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    newCode = newCode.slice(0, r.start) + r.replacement + newCode.slice(r.end);
  }

  await fs.writeFile(file, newCode, 'utf8');
  totalRewritten += rewrote;
  totalImportsScanned += scanned;
  totalFiles++;
}

console.log(
  `postbuild: scanned ${totalFiles} .js file(s), ${totalImportsScanned} import(s) checked, ${totalRewritten} relative path(s) resolved +.js or +/index.js`,
);
