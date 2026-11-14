#!/usr/bin/env node
// 리포 관리자용 검사기. 학습자에게는 필요 없다.
// 검사: 커리큘럼 형식·선수 관계, 필수 주제, 국내 근거(R10), 조문 출처(R11), 미리 만든 시각 자료 없음(R5), 설정 JSON 유효성.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const read = (p) => readFileSync(join(root, p), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

const LEVELS = ["Explain", "Apply", "Evaluate", "Develop"];
const FIELDS = ["선수", "핵심 질문", "목표", "만들어 볼 것", "국내 근거", "글로벌 비교", "경계·연결", "근거"];
const MUST_DOMESTIC = /^[LO]/; // L·O 영역은 국내 근거를 비울 수 없다(R10)
const LAWS = ["정보통신망법", "개인정보 보호법", "공정거래법", "하도급법", "전자상거래법", "청탁금지법", "국가계약법", "조달사업법", "국제상거래뇌물방지법"];
// 필수 주제(spec.md) → 소속 영역. 그 영역 모듈의 제목·핵심 질문·목표·만들어 볼 것·국내 근거에서만 찾는다.
const TOPICS = {
  P: ["단계 정의", "전환율", "영업 속도", "예측", "CRM 위생"],
  L: ["ICP", "리드 스코어링", "MQL", "SQL", "아웃바운드", "인바운드", "시퀀스"],
  D: ["디스커버리", "SPIN", "Challenger", "MEDDPICC", "Solution Selling", "스토리", "사례", "데모"],
  O: ["마피아 제안", "제안서", "가격", "협상", "클로징", "하도급", "공정거래", "전자상거래", "청탁금지", "국가계약", "나라장터"],
  M: ["확장", "NRR", "영업 조직", "KPI", "보상"],
};
const SEARCHED = ["제목", "핵심 질문", "목표", "만들어 볼 것", "국내 근거"];
const AREAS = ["P", "L", "D", "O", "M", "X"];
const AGENCIES = ["공정거래위원회", "국민권익위원회", "개인정보보호위원회", "조달청", "나라장터", "KISA", "통계청"];
const hasDomestic = (v) => LAWS.some((l) => v.includes(l)) || AGENCIES.some((a) => v.includes(a)) || /[가-힣]+법( 시행령)? 제\d+조/.test(v);

function parseCurriculum(text) {
  const modules = new Map();
  const allFields = new Map();
  const problems = [];
  for (const a of AREAS) if (!new RegExp(`^## ${a} · `, "m").test(text)) problems.push(`영역 ${a} 머리말 없음`);
  const blocks = text.split(/^### /m).slice(1).map((b) => b.split(/^## /m)[0]);
  for (const block of blocks) {
    const head = block.split("\n")[0];
    const m = head.match(/^([PLDOMX]\d+) · (.+)$/);
    if (!m) { problems.push(`모듈 제목 형식 오류: ${head}`); continue; }
    const id = m[1];
    if (modules.has(id)) problems.push(`${id}: 중복 id`);
    const fields = { 제목: m[2] };
    for (const line of block.split("\n").slice(1)) {
      if (!line.trim()) continue;
      const f = line.match(/^- ([^:]+): (.+)$/);
      if (!f) { problems.push(`${id}: 칸 밖의 본문 줄 「${line.slice(0, 30)}」`); continue; }
      if (!FIELDS.includes(f[1])) problems.push(`${id}: 정하지 않은 칸 「${f[1]}」`);
      fields[f[1]] = f[2];
    }
    for (const name of FIELDS) if (!fields[name]) problems.push(`${id}: 「${name}」 없음`);
    if (fields["목표"] && !LEVELS.some((l) => fields["목표"].startsWith(`${l} — `))) problems.push(`${id}: 목표 수준 형식 오류`);
    if (id.startsWith("X") && fields["목표"] && !fields["목표"].startsWith("Develop — ")) problems.push(`${id}: 졸업 프로젝트는 Develop`);
    const dom = fields["국내 근거"] ?? "";
    if (MUST_DOMESTIC.test(id) && !hasDomestic(dom)) problems.push(`${id}: L·O 영역은 국내 근거에 법령·공공기관이 있어야 함`);
    if (!MUST_DOMESTIC.test(id) && !hasDomestic(dom) && !/^해당 없음 — .+/.test(dom)) problems.push(`${id}: 법령·기관이 없으면 「해당 없음 — 이유」 형식`);
    allFields.set(id, fields);
    const prereq = !fields["선수"] || fields["선수"] === "없음" ? [] : fields["선수"].split(",").map((s) => s.trim());
    modules.set(id, prereq);
  }
  for (const [id, prereq] of modules) for (const p of prereq) if (!modules.has(p)) problems.push(`${id}: 없는 선수 ${p}`);
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 2 || !modules.has(id)) return;
    if (state.get(id) === 1) { problems.push(`선수 순환: ${[...path, id].join(" → ")}`); return; }
    state.set(id, 1);
    for (const p of modules.get(id)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of modules.keys()) visit(id, []);
  for (const x of ["X1", "X2", "X3"]) if (!modules.has(x)) problems.push(`졸업 프로젝트 ${x} 없음`);
  for (const [area, topics] of Object.entries(TOPICS)) {
    const hay = [...allFields].filter(([id]) => id.startsWith(area)).map(([, f]) => SEARCHED.map((k) => f[k] ?? "").join(" ")).join(" ");
    for (const t of topics) if (!hay.includes(t)) problems.push(`필수 주제 「${t}」가 ${area} 영역 모듈에 없음`);
  }
  const domestic = [...allFields.values()].map((f) => f["국내 근거"] ?? "").join(" ");
  for (const law of LAWS) if (!domestic.includes(law)) problems.push(`법령 「${law}」가 어느 모듈 국내 근거에도 없음`);
  return { modules, problems };
}

function closure(modules, id) {
  const seen = new Set(); const st = [...(modules.get(id) ?? [])];
  while (st.length) { const p = st.pop(); if (!seen.has(p)) { seen.add(p); st.push(...(modules.get(p) ?? [])); } }
  return seen;
}

function sameShape(a, b, path, out) {
  if (a === null || typeof a !== "object" || Array.isArray(a)) return;
  for (const k of Object.keys(a)) if (!(k in b)) out.push(`${path}.${k} 없음`);
  for (const k of Object.keys(b)) if (!(k in a)) out.push(`${path}.${k} 템플릿에 없는 키`);
  for (const k of Object.keys(a)) if (k !== "modules" && k in b && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) sameShape(a[k], b[k], `${path}.${k}`, out);
}

function findVisualAssets(files) {
  const allowedJs = /^tools\/check\.mjs$/;
  return files.filter((f) => /\.(html?|css|s[ac]ss|less|svg|png|jpe?g|gif|webp|avif|bmp|ico|tiff?)$/i.test(f) || (/\.(m?js|cjs|jsx|tsx?)$/i.test(f) && !allowedJs.test(f)));
}

function findTemplateMarkup(name, text) {
  const hits = [];
  for (const m of text.matchAll(/(`{3,}|~{3,})[\s\S]*?\1/g)) if (/<(!doctype|html|svg|style|canvas|script)\b/i.test(m[0])) hits.push(name);
  if (!name.startsWith("docs/build/") && /<(!doctype|html|svg|style|canvas|script)\b/i.test(text)) hits.push(`${name}(본문)`);
  return hits;
}

// 「법령 약칭 제N조(의M)」 쌍을 뽑는다. 출처 표(sources.md)에 같은 쌍이 있어야 한다(R11).
const CITE = /([가-힣]+법(?: 시행령)?) 제(\d+)조(의\d+)?/g;
const cites = (text) => new Set([...text.matchAll(CITE)].map((m) => `${m[1]} 제${m[2]}조${m[3] ?? ""}`));
// 법령 약칭이 바로 앞에 붙지 않은 조문(「제 45 조」, 「제45조·제46조」의 뒤, 「같은 법 제N조」)은 대조할 수 없으므로 실패로 본다.
const bare = (text) => [...text.matchAll(/(.{0,12})제\s*\d+\s*조/g)].filter((m) => !/[가-힣]+법(?: 시행령)? $/.test(m[1])).map((m) => m[0].trim());

function main() {
  const { modules, problems } = parseCurriculum(read("curriculum/map.md"));
  errors.push(...problems);
  if (modules.size === 0) errors.push("모듈을 찾지 못함");

  const known = cites(read("docs/build/sources.md"));
  const skillFiles = readdirSync(join(root, ".claude/skills")).map((s) => `.claude/skills/${s}/SKILL.md`).filter((f) => existsSync(join(root, f)));
  for (const f of ["curriculum/map.md", "CLAUDE.md", "README.md", ...readdirSync(join(root, "tutor")).map((x) => `tutor/${x}`), ...skillFiles]) {
    const t = read(f);
    for (const c of cites(t)) if (!known.has(c)) errors.push(`${f}: 출처 표에 없는 조문 ${c}`);
    for (const b of bare(t)) errors.push(`${f}: 법령 약칭이 붙지 않은 조문 「${b}」`);
  }

  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const f of findVisualAssets(files)) errors.push(`미리 만든 시각 자료 금지: ${f}`);
  for (const f of files.filter((x) => x.endsWith(".md") && existsSync(join(root, x)))) for (const n of findTemplateMarkup(f, read(f))) errors.push(`복사용 마크업 금지: ${n}`);

  const json = {};
  for (const p of [".claude/settings.json", "learner-template/state.json", "docs/build/fixtures/graduation-state.json"]) {
    try { json[p] = JSON.parse(read(p)); } catch (e) { errors.push(`${p}: JSON 오류 ${e.constructor.name}`); }
  }
  const tpl = json["learner-template/state.json"], seed = json["docs/build/fixtures/graduation-state.json"];
  if (tpl && seed) {
    const shape = []; sameShape(tpl, seed, "state", shape); errors.push(...shape.map((x) => `졸업 시드: ${x}`));
    for (const p of closure(modules, "X3")) if (!["done", "verified_skip"].includes(seed.modules?.[p]?.status)) errors.push(`졸업 시드: X3 선수 ${p}가 done·verified_skip 아님`);
  }
  if (!existsSync(join(root, "learner-template/log.md"))) errors.push("learner-template/log.md 없음");
  for (const s of readdirSync(join(root, ".claude/skills"))) {
    if (statSync(join(root, ".claude/skills", s)).isDirectory() && !existsSync(join(root, ".claude/skills", s, "SKILL.md"))) errors.push(`스킬 ${s}: SKILL.md 없음`);
  }
  if (!read(".gitignore").split("\n").includes("learner/")) errors.push(".gitignore에 learner/ 없음");

  if (errors.length) { console.error(errors.map((e) => `FAIL ${e}`).join("\n")); process.exit(1); }
  console.log(`OK 모듈 ${modules.size}개, 파일 ${files.length}개 검사`);
}

main();
