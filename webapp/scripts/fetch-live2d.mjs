// 下载自托管 Live2D 资产到 public/live2d/（W10-d）。
// 不把 Cubism Core / 模型二进制提交进 git（许可证 + 仓库体积），改为一条命令重获取：
//   node scripts/fetch-live2d.mjs
// 失败也不致命：Live2DStage 会优雅降级到呼吸占位。
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const OUT = join(ROOT, "public", "live2d");
const BASE = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/";
const CORE = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

async function get(url, dst) {
  const r = await fetch(url);
  if (!r.ok) {
    console.warn(`FAIL ${r.status} ${url}`);
    return false;
  }
  const buf = Buffer.from(await r.arrayBuffer());
  await mkdir(dirname(dst), { recursive: true });
  await writeFile(dst, buf);
  console.log(`ok ${buf.length.toString().padStart(8)} ${dst.replace(OUT, "live2d")}`);
  return true;
}

await get(CORE, join(OUT, "core", "live2dcubismcore.min.js"));
const modelRel = "haru_greeter_t03.model3.json";
await get(BASE + modelRel, join(OUT, "haru", modelRel));
const m = JSON.parse(await (await fetch(BASE + modelRel)).text());
const fr = m.FileReferences;
const files = [];
for (const k of ["Moc", "Physics", "Pose", "UserData"]) if (typeof fr[k] === "string") files.push(fr[k]);
for (const t of fr.Textures ?? []) files.push(t);
for (const e of fr.Expressions ?? []) if (e.File) files.push(e.File);
for (const grp of Object.values(fr.Motions ?? {})) for (const mo of grp) if (mo.File) files.push(mo.File);
let fails = 0;
for (const f of files) if (!(await get(BASE + f, join(OUT, "haru", f)))) fails++;
console.log(`=== 完成，失败 ${fails}/${files.length}（DisplayInfo 可缺省）===`);
