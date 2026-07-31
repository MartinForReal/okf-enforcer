var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => OkfPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// validator.ts
var import_obsidian = require("obsidian");

// portent.ts
var PORTENT_TYPES = [
  "Project",
  "Operation",
  "Responsibility",
  "Task",
  "Event",
  "Note",
  "Topic",
  "Person"
];
var PORTENT_STATUSES = ["captured", "organized", "archived"];
var PORTENT_DEFAULTS = {
  enablePortent: false,
  portentTypes: [...PORTENT_TYPES],
  portentStatusField: "status",
  portentStatuses: [...PORTENT_STATUSES],
  portentOrganizedField: "organized",
  portentArchivedField: "archived",
  portentBelongsToField: "belongs_to",
  portentRelatedToField: "related_to",
  portentCheckTypeVocab: true,
  portentCheckLifecycle: true,
  portentCheckBelongsTo: true,
  portentCheckRelatedTo: true
};
var WIKILINK_RE = /^\[\[[^[\]]+?\]\]$/;
function hasNonEmpty(data, key) {
  const v = data[key];
  if (v === void 0 || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function validatePortent(data, settings) {
  const issues = [];
  const type = data["type"];
  const types = settings.portentTypes.length ? settings.portentTypes : [...PORTENT_TYPES];
  const statuses = settings.portentStatuses.length ? settings.portentStatuses : [...PORTENT_STATUSES];
  const statusField = settings.portentStatusField || "status";
  const organizedField = settings.portentOrganizedField || "organized";
  const archivedField = settings.portentArchivedField || "archived";
  const belongsToField = settings.portentBelongsToField || "belongs_to";
  const relatedToField = settings.portentRelatedToField || "related_to";
  if (settings.portentCheckTypeVocab && typeof type === "string" && type.trim().length > 0) {
    const t = type.trim();
    if (!types.includes(t)) {
      issues.push({
        severity: "warning",
        rule: "portent/types",
        message: `\`type: ${t}\` is not one of the Portent types (${types.join(
          ", "
        )}). Extend intentionally or switch to a configured type.`
      });
    }
  }
  if (settings.portentCheckLifecycle && statusField in data) {
    const s = data[statusField];
    if (typeof s !== "string" || !statuses.includes(s.trim())) {
      issues.push({
        severity: "warning",
        rule: "portent/lifecycle",
        message: `\`${statusField}\` should map to one of ${statuses.join(
          " | "
        )}.`
      });
    }
  }
  if (settings.portentCheckLifecycle && organizedField in data && typeof data[organizedField] !== "boolean") {
    issues.push({
      severity: "warning",
      rule: "portent/lifecycle",
      message: `\`${organizedField}\` should be a boolean (true/false).`
    });
  }
  if (settings.portentCheckLifecycle && archivedField in data && typeof data[archivedField] !== "boolean") {
    issues.push({
      severity: "warning",
      rule: "portent/lifecycle",
      message: `\`${archivedField}\` should be a boolean (true/false).`
    });
  }
  if (settings.portentCheckBelongsTo && belongsToField in data) {
    const bt = data[belongsToField];
    if (hasNonEmpty(data, belongsToField)) {
      if (typeof bt === "string") {
        if (!WIKILINK_RE.test(bt.trim())) {
          issues.push({
            severity: "warning",
            rule: "portent/relationships",
            message: `\`${belongsToField}\` should be a single wikilink like \`"[[Parent Note]]"\`.`
          });
        }
      } else {
        issues.push({
          severity: "warning",
          rule: "portent/relationships",
          message: `\`${belongsToField}\` denotes a single primary parent \u2014 expected one wikilink string, not a list or object.`
        });
      }
    }
  }
  if (settings.portentCheckRelatedTo && relatedToField in data) {
    const rt = data[relatedToField];
    if (hasNonEmpty(data, relatedToField)) {
      if (!Array.isArray(rt)) {
        issues.push({
          severity: "warning",
          rule: "portent/relationships",
          message: `\`${relatedToField}\` should be a YAML list of wikilinks (may be empty).`
        });
      } else {
        const bad = rt.filter(
          (v) => typeof v !== "string" || !WIKILINK_RE.test(v.trim())
        );
        if (bad.length > 0) {
          issues.push({
            severity: "warning",
            rule: "portent/relationships",
            message: `\`${relatedToField}\` entries should be wikilinks like \`"[[Other Note]]"\` (${bad.length} entr${bad.length === 1 ? "y is" : "ies are"} not).`
          });
        }
      }
    }
  }
  return issues;
}

// validator.ts
var OKF_VERSION = "0.2";
var OKF_KNOWN_VERSIONS = ["0.1", "0.2"];
var OKF_STATUSES = ["draft", "stable", "deprecated"];
var ACTOR_RE = /^(human:.+|process:.+|[^/\s]+\/[^/\s]+)$/;
var ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;
var DEFAULT_SETTINGS = {
  defaultType: "Concept",
  defaultActor: "okf-enforcer/0.5",
  warnRecommendedFields: true,
  warnTrustFields: false,
  checkAttestedComputation: true,
  warnTagsField: false,
  warnBrokenLinks: false,
  liveCheckOnSave: true,
  scanOnStartup: true,
  fixOnSave: true,
  autoGenerateIndex: true,
  generateIndexOnStartup: false,
  overwriteExistingIndex: false,
  indexSubdirDescSection: "",
  autoMigrateOnFix: true,
  batchSize: 50,
  excludeFolders: ["Templates"],
  ...PORTENT_DEFAULTS
};
var FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeVerified(data) {
  const v = data["verified"];
  if (v === void 0 || v === null) return [];
  if (Array.isArray(v)) return v.filter((e) => e && typeof e === "object");
  if (typeof v === "object") return [v];
  return [];
}
function trustTier(data) {
  var _a;
  const events = normalizeVerified(data);
  if (events.length === 0) return "unverified";
  for (const e of events) {
    if (String((_a = e["by"]) != null ? _a : "").startsWith("human:")) return "human-reviewed";
  }
  return "machine-confirmed";
}
function trustTierOfContent(content) {
  const { hasFm, raw } = splitFrontmatter(content);
  if (!hasFm) return null;
  try {
    const parsed = (0, import_obsidian.parseYaml)(raw);
    if (parsed && typeof parsed === "object") {
      return trustTier(parsed);
    }
  } catch (e) {
    return null;
  }
  return null;
}
function isStale(data, today = /* @__PURE__ */ new Date()) {
  const raw = data["stale_after"];
  if (!raw) return false;
  const s = String(raw).slice(0, 10);
  if (!ISO_DATE_RE.test(s)) return false;
  const t = today.toISOString().slice(0, 10);
  return t >= s;
}
function basename(path) {
  const f = path.split("/").pop() || path;
  return f.replace(/\.md$/i, "");
}
function parentPath(path) {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "/" : path.slice(0, cut);
}
function isReserved(path) {
  const f = (path.split("/").pop() || "").toLowerCase();
  if (f === "index.md") return "index";
  if (f === "log.md") return "log";
  return null;
}
function isExcluded(path, settings) {
  return settings.excludeFolders.some(
    (folder) => folder && (path === folder || path.startsWith(folder + "/"))
  );
}
function splitFrontmatter(content) {
  const m = content.match(FM_RE);
  if (!m) return { hasFm: false, raw: "", body: content };
  return { hasFm: true, raw: m[1], body: content.slice(m[0].length) };
}
function oneLine(text, max = 200) {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "\u2026" : s;
}
function headingIndex(lines, section) {
  const wanted = section.trim().toLowerCase();
  if (!wanted) return -1;
  return lines.findIndex((l) => {
    const m = l.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    return !!m && m[1].trim().toLowerCase() === wanted;
  });
}
function sectionSummary(content, section) {
  const lines = splitFrontmatter(content).body.split(/\r?\n/);
  let i = headingIndex(lines, section);
  if (i < 0) return "";
  const para = [];
  for (i++; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s+\S/.test(line)) break;
    if (!line.trim()) {
      if (para.length) break;
      continue;
    }
    para.push(line.trim().replace(/^([*\-+]|>|\d+\.)\s+/, ""));
  }
  return oneLine(para.join(" "));
}
function sectionBlock(content, section) {
  const lines = splitFrontmatter(content).body.split(/\r?\n/);
  const start = headingIndex(lines, section);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^#{1,6}\s+\S/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n").trim();
}
function escapeLinkText(text) {
  return text.replace(/([\\[\]])/g, "\\$1");
}
function encodeLink(name) {
  return encodeURI(name).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/#/g, "%23").replace(/\?/g, "%3F");
}
function renderEntry(e) {
  return `* [${escapeLinkText(e.title)}](${e.link})${e.desc ? ` - ${e.desc}` : ""}`;
}
var INDEX_SECTIONS = {
  subdirs: "Subdirectories",
  untyped: "Untyped",
  files: "Files"
};
var IRREGULAR_PLURALS = {
  person: "people",
  child: "children"
};
function pluralize(word) {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) {
    return word[0] === lower[0] ? irregular : irregular[0].toUpperCase() + irregular.slice(1);
  }
  if (/[a-z]{2}is$/i.test(word)) return word.slice(0, -2) + "es";
  if (/[^su]s$/i.test(word)) return word;
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}
function headingCase(word) {
  return word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}
function sectionForType(type) {
  if (typeof type !== "string") return INDEX_SECTIONS.untyped;
  const t = oneLine(type, 80).replace(/^#+\s*/, "").trim();
  if (!t) return INDEX_SECTIONS.untyped;
  const words = t.split(/\s+/).map(headingCase);
  words[words.length - 1] = pluralize(words[words.length - 1]);
  return words.join(" ");
}
var BULLET_RE = /^\s*[*\-+]\s+\S/;
var BULLET_MARKER_RE = /^(\s*[*\-+]\s+)/;
var LIST_MARKER_RE = /^(\s*(?:[*\-+]|\d{1,9}[.)])\s+)/;
var ORDINAL_RE = /^\s*(\d{1,9})[.)]\s/;
var PLACEHOLDER_RE = /^\s*_No .+ yet\._\s*$/;
var BULLET_WIKILINK_RE = /^\s*(?:[*\-+]|\d{1,9}[.)])\s+\[\[([^\]|#^]*)/;
function readDest(line, open) {
  let j = open;
  for (let depth = 1; j < line.length; j++) {
    const c = line[j];
    if (c === "\\") j++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) break;
  }
  return line[j] === ")" ? { dest: line.slice(open, j), end: j } : null;
}
function parseBulletLink(line) {
  var _a;
  const marker = line.match(LIST_MARKER_RE);
  if (!marker || line[marker[0].length] !== "[") return null;
  const start = marker[0].length + 1;
  let nested;
  let i = start;
  for (let depth = 1; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === "[") depth++;
    else if (c === "]") {
      if (depth > 1 && nested === void 0 && line[i + 1] === "(") {
        nested = (_a = readDest(line, i + 2)) == null ? void 0 : _a.dest;
      }
      if (--depth === 0) break;
    }
  }
  if (line[i] !== "]" || line[i + 1] !== "(") {
    const first = line.indexOf("]", start);
    if (first < 0 || line[first + 1] !== "(") return null;
    i = first;
    nested = void 0;
  }
  const open = i + 2;
  const dest = readDest(line, open);
  if (!dest) return null;
  return {
    prefix: line.slice(0, open),
    dest: dest.dest,
    suffix: line.slice(dest.end),
    ordered: !BULLET_MARKER_RE.test(marker[0]),
    nested
  };
}
function splitDest(dest) {
  const rest = dest.replace(/^\s+/, "");
  const angled = rest.match(/^<([^>]*)>/);
  if (angled) {
    return { target: angled[1], trailer: rest.slice(angled[0].length) };
  }
  const title = rest.search(/\s+["'(]/);
  return title < 0 ? { target: rest.trimEnd(), trailer: "" } : { target: rest.slice(0, title), trailer: rest.slice(title) };
}
function decodePath(target) {
  const t = target.replace(/^\.\//, "");
  const literal = (s) => s.replace(/%23/gi, "#").replace(/%3F/gi, "?");
  try {
    return decodeURI(literal(t));
  } catch (e) {
    return literal(t);
  }
}
function splitFragment(target) {
  const at = target.slice(1).search(/[#?]/);
  return at < 0 ? { path: target, fragment: "" } : { path: target.slice(0, at + 1), fragment: target.slice(at + 1) };
}
function sameTarget(a, b) {
  return decodePath(splitFragment(a).path) === decodePath(splitFragment(b).path);
}
function pathKey(path) {
  return decodePath(path).replace(/\/index\.md$/i, "").replace(/\/+$/, "").toLowerCase();
}
function linkKey(dest) {
  return pathKey(splitFragment(splitDest(dest).target).path);
}
function wikilinkKeys(target, canonical) {
  const t = target.trim();
  if (!t) return [];
  if (/\.[a-z0-9]+$/i.test(t) || t.endsWith("/")) return [pathKey(t)];
  const md = pathKey(`${t}.md`);
  return canonical.has(md) ? [md] : [pathKey(t)];
}
function renderIndex(entries, keep = "") {
  if (entries.length === 0) return keep ? `${keep}
` : "";
  let out = keep ? `${keep}

` : "";
  let section = "";
  for (const e of entries) {
    if (e.section !== section) {
      if (section) out += "\n";
      section = e.section;
      out += `# ${section}

`;
    }
    out += `${renderEntry(e)}
`;
  }
  return out;
}
var FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
function fencedLines(lines) {
  const mask = [];
  let fence = "";
  for (const line of lines) {
    const open = line.match(FENCE_RE);
    if (open) {
      if (!fence) fence = open[1][0];
      else if (open[1][0] === fence) fence = "";
      mask.push(true);
      continue;
    }
    mask.push(fence !== "");
  }
  return mask;
}
function ordinalOpensList(lines, i) {
  const n = lines[i].match(ORDINAL_RE);
  if (!n || n[1] === "1") return true;
  for (let j = i - 1; j >= 0; j--) {
    if (LIST_MARKER_RE.test(lines[j]) || /^\s{2,}\S/.test(lines[j])) return true;
    if (!lines[j].trim() || /^#{1,6}\s/.test(lines[j])) return j === i - 1;
  }
  return i === 0;
}
function isOwnEntry(target) {
  if (!target || target.startsWith("/") || target.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  const parts = target.replace(/\/+$/, "").split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  if (parts.length === 1) return true;
  return parts.length === 2 && parts[1].toLowerCase() === "index.md";
}
function mergeIndex(existing, entries, exists) {
  const { body } = splitFrontmatter(existing);
  const prefix = existing.slice(0, existing.length - body.length);
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const canonical = /* @__PURE__ */ new Map();
  for (const e of entries) canonical.set(linkKey(e.link), e.link);
  const listed = /* @__PURE__ */ new Set();
  const stale = [];
  const emptied = /* @__PURE__ */ new Set();
  const fenced = fencedLines(lines);
  let section = "";
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const head = lines[i].match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (head) {
      section = head[1].trim();
      continue;
    }
    if (!ordinalOpensList(lines, i)) continue;
    const link = parseBulletLink(lines[i]);
    if (!link) {
      const wiki = lines[i].match(BULLET_WIKILINK_RE);
      if (wiki) for (const key2 of wikilinkKeys(wiki[1], canonical)) listed.add(key2);
      continue;
    }
    const { target, trailer } = splitDest(link.dest);
    const split = splitFragment(target);
    const wholeKey = pathKey(target);
    const splitKey = pathKey(split.path);
    let names = false;
    if (wholeKey !== splitKey) {
      if (canonical.has(wholeKey) || !isOwnEntry(target)) {
        names = true;
      } else {
        const alt = canonical.get(splitKey);
        const risky = alt === void 0 ? !!exists && isOwnEntry(split.path) : !sameTarget(split.path, alt);
        names = risky && !!exists && exists(decodePath(target).replace(/\/+$/, ""));
      }
    }
    const targetPath = names ? target : split.path;
    const fragment = names ? "" : split.fragment;
    if (link.nested !== void 0) {
      listed.add(linkKey(link.nested));
      continue;
    }
    const key = pathKey(targetPath);
    listed.add(key);
    if (link.ordered) continue;
    const want = canonical.get(key);
    if (want === void 0) {
      const whole = decodePath(target).replace(/\/+$/, "");
      const path = decodePath(targetPath).replace(/\/+$/, "");
      if (exists && isOwnEntry(target) && !exists(whole) && (path === whole || !exists(path))) {
        stale.push(i);
        emptied.add(section);
      }
      continue;
    }
    if (!sameTarget(targetPath, want)) {
      lines[i] = link.prefix + want + fragment + trailer + link.suffix;
      changed = true;
    }
  }
  for (let i = stale.length - 1; i >= 0; i--) {
    const at = stale[i];
    lines.splice(at, 1);
    if (at > 0 && at < lines.length && !lines[at - 1].trim() && !lines[at].trim()) {
      lines.splice(at, 1);
    }
    changed = true;
  }
  const owned = new Set(
    Object.values(INDEX_SECTIONS).map((s) => s.toLowerCase())
  );
  for (const e of entries) owned.add(e.section.trim().toLowerCase());
  for (const name of emptied) {
    if (!name || !owned.has(name.trim().toLowerCase())) continue;
    const at = headingIndex(lines, name);
    if (at < 0) continue;
    let end = at + 1;
    while (end < lines.length && !/^#{1,6}\s+\S/.test(lines[end])) end++;
    if (lines.slice(at + 1, end).every((l) => !l.trim())) lines.splice(at, end - at);
  }
  const missing = entries.filter((e) => !listed.has(linkKey(e.link)));
  if (missing.length > 0) {
    const sections = [];
    for (const e of missing) {
      if (!sections.includes(e.section)) sections.push(e.section);
    }
    for (const section2 of sections) {
      appendToSection(
        lines,
        section2,
        missing.filter((e) => e.section === section2).map(renderEntry)
      );
    }
    changed = true;
  }
  if (!changed) return existing;
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (prefix && lines.length && lines[0].trim()) lines.unshift("", "");
  if (lines.length === 0) return prefix ? prefix + eol : "";
  return prefix + lines.join(eol) + eol;
}
function fenceOpenAtEnd(lines) {
  let fence = "";
  for (const line of lines) {
    const open = line.match(FENCE_RE);
    if (!open) continue;
    if (!fence) fence = open[1][0];
    else if (open[1][0] === fence) fence = "";
  }
  return fence !== "";
}
function writableEnd(lines) {
  if (!fenceOpenAtEnd(lines)) return lines.length;
  const fenced = fencedLines(lines);
  let end = lines.length;
  while (end > 0 && fenced[end - 1]) end--;
  return end;
}
function appendToSection(lines, section, items) {
  const limit = writableEnd(lines);
  const start = headingIndex(lines.slice(0, limit), section);
  if (start < 0) {
    let at2 = limit;
    while (at2 > 0 && !lines[at2 - 1].trim()) at2--;
    const drop = limit === lines.length ? limit - at2 : 0;
    const head = at2 > 0 ? ["", `# ${section}`, ""] : [`# ${section}`, ""];
    lines.splice(at2, drop, ...head, ...items);
    return;
  }
  let end = start + 1;
  while (end < limit && !/^#{1,6}\s+\S/.test(lines[end])) end++;
  const fenced = fencedLines(lines);
  for (let i = end - 1; i > start; i--) {
    if (!fenced[i] && PLACEHOLDER_RE.test(lines[i])) {
      lines.splice(i, 1);
      fenced.splice(i, 1);
      end--;
    }
  }
  let at = -1;
  for (let i = start + 1; i < end; i++) {
    if (!fenced[i] && BULLET_RE.test(lines[i])) at = i + 1;
  }
  if (at < 0) {
    at = end;
    while (at > start + 1 && !lines[at - 1].trim()) at--;
    items = ["", ...items];
  }
  lines.splice(at, 0, ...items);
}
function validateContent(path, content, isRoot, settings) {
  const reserved = isReserved(path);
  if (reserved === "index") return validateIndex(content, isRoot);
  if (reserved === "log") return validateLog(content);
  return validateConcept(path, content, settings);
}
function validateConcept(path, content, settings) {
  const issues = [];
  const { hasFm, raw } = splitFrontmatter(content);
  if (!hasFm) {
    issues.push({
      severity: "error",
      rule: "\xA711",
      message: "No YAML frontmatter block. Every OKF concept must begin with a `---` delimited frontmatter block.",
      fix: "add-frontmatter"
    });
    return issues;
  }
  let data = {};
  try {
    const parsed = (0, import_obsidian.parseYaml)(raw);
    if (parsed && typeof parsed === "object") {
      data = parsed;
    }
  } catch (e) {
    issues.push({
      severity: "error",
      rule: "\xA711",
      message: `Frontmatter is not parseable YAML: ${e.message || e}`
    });
    return issues;
  }
  const type = data["type"];
  const typeOk = typeof type === "string" && type.trim().length > 0;
  if (!typeOk) {
    const issue = {
      severity: "error",
      rule: "\xA711",
      message: "`type` field is present but empty. It must be a non-empty string."
    };
    if (type === void 0) {
      issue.message = "Missing required `type` field.";
      issue.fix = "add-type";
    } else if (Array.isArray(type)) {
      issue.message = "`type` must be a single string, not a list (OKF \xA74.1 \u2014 only `tags` is list-valued).";
    } else if (typeof type !== "string") {
      issue.message = "`type` must be a non-empty string (OKF \xA74.1).";
    } else {
      issue.fix = "add-type";
    }
    issues.push(issue);
  }
  if (settings.warnRecommendedFields) {
    if (!hasNonEmpty2(data, "title")) {
      issues.push({
        severity: "warning",
        rule: "\xA74.1",
        message: "Recommended `title` missing. Consumers may fall back to the filename.",
        fix: "add-title"
      });
    }
    if (!hasNonEmpty2(data, "description")) {
      issues.push({
        severity: "warning",
        rule: "\xA74.1",
        message: "Recommended `description` (one-line summary) missing. Used in index listings, search snippets, and previews."
      });
    }
    const generated = data["generated"];
    const hasGenerated = generated !== null && typeof generated === "object";
    const legacyTs = data["timestamp"];
    const hasLegacyTs = typeof legacyTs === "string" && legacyTs.length > 0;
    if (hasGenerated) {
      const g = generated;
      if (!hasNonEmpty2(g, "by")) {
        issues.push({
          severity: "warning",
          rule: "\xA75.2",
          message: "`generated.by` (an actor) is required within `generated`."
        });
      } else if (!ACTOR_RE.test(String(g["by"]).trim())) {
        issues.push({
          severity: "warning",
          rule: "\xA77",
          message: "`generated.by` should follow the actor convention: `<producer>/<version>`, `human:<id>`, or `process:<id>`."
        });
      }
      if (g["at"] !== void 0 && !ISO_DATETIME_RE.test(String(g["at"]))) {
        issues.push({
          severity: "warning",
          rule: "\xA75.2",
          message: "`generated.at` is not a parseable ISO 8601 datetime."
        });
      }
    } else if (hasLegacyTs) {
      issues.push({
        severity: "warning",
        rule: "\xA713.1",
        message: 'Legacy `timestamp` found. OKF v0.2 records this as `generated: { by, at }` \u2014 run "Migrate note to OKF v0.2".',
        fix: "migrate-timestamp"
      });
    } else {
      issues.push({
        severity: "warning",
        rule: "\xA75.2",
        message: "Recommended `generated: { by, at }` missing (records who produced the content and when).",
        fix: "add-generated"
      });
    }
  }
  if (settings.warnTagsField && !("tags" in data)) {
    issues.push({
      severity: "warning",
      rule: "\xA74.1",
      message: "Recommended `tags` list missing."
    });
  }
  if (/^#{1,6}\s+Citations\s*$/m.test(content) && !("sources" in data)) {
    issues.push({
      severity: "warning",
      rule: "\xA713.1",
      message: 'Legacy `# Citations` section found. OKF v0.2 records provenance in the `sources` frontmatter field \u2014 run "Migrate note to OKF v0.2".',
      fix: "migrate-citations"
    });
  }
  if (settings.warnTrustFields) {
    issues.push(...validateTrustFamilies(data));
  }
  if (settings.checkAttestedComputation && typeof type === "string" && type.trim() === "Attested Computation") {
    issues.push(...validateAttestedComputation(data, content));
  }
  if (settings.enablePortent) {
    issues.push(...validatePortent(data, settings));
  }
  return issues;
}
function validateTrustFamilies(data) {
  const issues = [];
  if ("verified" in data && data["verified"] !== null) {
    const events = normalizeVerified(data);
    const raw = data["verified"];
    if (events.length === 0 && raw !== void 0) {
      issues.push({
        severity: "warning",
        rule: "\xA75.2",
        message: "`verified` should be a `{ by, at }` mapping or a list of them."
      });
    }
    for (const e of events) {
      if (!hasNonEmpty2(e, "by")) {
        issues.push({
          severity: "warning",
          rule: "\xA75.2",
          message: "A `verified` entry is missing its `by` actor."
        });
      } else if (!ACTOR_RE.test(String(e["by"]).trim())) {
        issues.push({
          severity: "warning",
          rule: "\xA77",
          message: `\`verified\` actor \`${String(
            e["by"]
          )}\` should follow the actor convention (\`<producer>/<version>\`, \`human:<id>\`, \`process:<id>\`).`
        });
      }
      if (e["at"] !== void 0 && !ISO_DATETIME_RE.test(String(e["at"]))) {
        issues.push({
          severity: "warning",
          rule: "\xA75.2",
          message: "A `verified` entry's `at` is not a parseable ISO 8601 datetime."
        });
      }
    }
  }
  if ("status" in data) {
    const s = data["status"];
    if (typeof s !== "string" || !OKF_STATUSES.includes(s.trim())) {
      issues.push({
        severity: "warning",
        rule: "\xA75.4",
        message: `\`status\` should be one of ${OKF_STATUSES.join(" | ")}.`
      });
    }
  }
  if ("stale_after" in data && data["stale_after"] != null) {
    const s = String(data["stale_after"]).slice(0, 10);
    if (!ISO_DATE_RE.test(s)) {
      issues.push({
        severity: "warning",
        rule: "\xA75.5",
        message: "`stale_after` should be an absolute date (`YYYY-MM-DD`)."
      });
    } else if (isStale(data)) {
      issues.push({
        severity: "warning",
        rule: "\xA75.5",
        message: `\`stale_after\` (${s}) has passed; this concept is due for review.`
      });
    }
  }
  if ("sources" in data && data["sources"] != null) {
    const src = data["sources"];
    if (!Array.isArray(src)) {
      issues.push({
        severity: "warning",
        rule: "\xA75.1",
        message: "`sources` should be a YAML list of source entries."
      });
    } else {
      src.forEach((entry, i) => {
        if (!entry || typeof entry !== "object") {
          issues.push({
            severity: "warning",
            rule: "\xA75.1",
            message: `\`sources[${i}]\` should be a mapping with at least a \`resource\`.`
          });
          return;
        }
        const e = entry;
        if (!hasNonEmpty2(e, "resource")) {
          issues.push({
            severity: "warning",
            rule: "\xA75.1",
            message: `\`sources[${i}]\` is missing the required \`resource\`.`
          });
        }
        if ("author" in e && (typeof e["author"] !== "string" || e["author"].trim().length === 0)) {
          issues.push({
            severity: "warning",
            rule: "\xA75.1",
            message: `\`sources[${i}].author\` should be a non-empty string.`
          });
        }
        if ("usage_count" in e && typeof e["usage_count"] !== "number") {
          issues.push({
            severity: "warning",
            rule: "\xA75.1",
            message: `\`sources[${i}].usage_count\` should be a number.`
          });
        }
        if ("last_modified" in e && e["last_modified"] != null && !ISO_DATE_RE.test(String(e["last_modified"]).slice(0, 10))) {
          issues.push({
            severity: "warning",
            rule: "\xA75.1",
            message: `\`sources[${i}].last_modified\` should be an absolute date (\`YYYY-MM-DD\`).`
          });
        }
      });
    }
  }
  return issues;
}
function validateAttestedComputation(data, content) {
  const issues = [];
  if (!hasNonEmpty2(data, "runtime")) {
    issues.push({
      severity: "error",
      rule: "\xA710.2",
      message: "`runtime` is required for an Attested Computation (e.g. `bigquery`, `dbt`, `python`)."
    });
  }
  if ("parameters" in data && data["parameters"] != null) {
    const params = data["parameters"];
    if (!Array.isArray(params)) {
      issues.push({
        severity: "warning",
        rule: "\xA710.2",
        message: "`parameters` should be a list of `{ name, type, required }`."
      });
    } else {
      params.forEach((p, i) => {
        if (!p || typeof p !== "object" || !hasNonEmpty2(p, "name")) {
          issues.push({
            severity: "warning",
            rule: "\xA710.2",
            message: `\`parameters[${i}]\` should have at least a \`name\`.`
          });
        }
      });
    }
  }
  const hasComputationHeading = /^#{1,6}\s+Computation\s*$/m.test(content);
  if (!hasComputationHeading && !hasNonEmpty2(data, "computation")) {
    issues.push({
      severity: "warning",
      rule: "\xA710.3",
      message: "An Attested Computation needs its computation \u2014 either a body `# Computation` fenced block or a `computation` path."
    });
  }
  if ("executor" in data && data["executor"] != null) {
    const ex = data["executor"];
    if (!ex || typeof ex !== "object") {
      issues.push({
        severity: "warning",
        rule: "\xA710.2",
        message: "`executor` should be a mapping with `resource` and `receipt`."
      });
    } else {
      const e = ex;
      if (!hasNonEmpty2(e, "resource")) {
        issues.push({
          severity: "warning",
          rule: "\xA710.2",
          message: "`executor.resource` (run instructions or code) is missing."
        });
      }
      if ("receipt" in e && !Array.isArray(e["receipt"])) {
        issues.push({
          severity: "warning",
          rule: "\xA710.2",
          message: "`executor.receipt` should be a list of fields a run must return."
        });
      }
    }
  }
  if ("attester" in data && data["attester"] != null) {
    const at = data["attester"];
    if (!at || typeof at !== "object" || !hasNonEmpty2(at, "resource")) {
      issues.push({
        severity: "warning",
        rule: "\xA710.2",
        message: "`attester.resource` (deterministic check code) is missing."
      });
    }
  }
  return issues;
}
function validateIndex(content, isRoot) {
  const issues = [];
  const split = splitFrontmatter(content);
  const hasFm = split.hasFm;
  const raw = split.raw;
  if (hasFm) {
    if (!isRoot) {
      issues.push({
        severity: "error",
        rule: "\xA78",
        message: "Non-root `index.md` must not contain frontmatter (\xA78). Only the bundle-root index.md may, and only for `okf_version`."
      });
    } else {
      let data = {};
      try {
        const parsed = (0, import_obsidian.parseYaml)(raw);
        if (parsed && typeof parsed === "object") {
          data = parsed;
        }
      } catch (e) {
        issues.push({
          severity: "error",
          rule: "\xA712",
          message: "Root `index.md` frontmatter is not parseable YAML."
        });
        return issues;
      }
      const keys = Object.keys(data);
      const extra = keys.filter((k) => k !== "okf_version");
      if (extra.length > 0) {
        issues.push({
          severity: "error",
          rule: "\xA712",
          message: `Root index.md frontmatter may only contain \`okf_version\`. Unexpected key(s): ${extra.join(
            ", "
          )}.`
        });
      }
      if ("okf_version" in data && !OKF_KNOWN_VERSIONS.includes(String(data["okf_version"]))) {
        issues.push({
          severity: "warning",
          rule: "\xA712",
          message: `Declared okf_version "${data["okf_version"]}" is not one of ${OKF_KNOWN_VERSIONS.join(
            " / "
          )} (this validator targets v${OKF_VERSION}).`
        });
      }
    }
  }
  const body = hasFm ? split.body : content;
  const hasHeading = /^#{1,6}\s+\S/m.test(body);
  const hasLinkBullet = body.split(/\r?\n/).some((l) => parseBulletLink(l) !== null || BULLET_WIKILINK_RE.test(l));
  const saysEmpty = body.split(/\r?\n/).every(
    (l) => !l.trim() || /^#{1,6}\s+\S/.test(l) || PLACEHOLDER_RE.test(l)
  );
  if (body.trim().length > 0 && !hasLinkBullet && !saysEmpty) {
    issues.push({
      severity: "warning",
      rule: "\xA78",
      message: "`index.md` should list directory contents as bulleted markdown links grouped under section headings (progressive disclosure)."
    });
  } else if (hasLinkBullet && !hasHeading) {
    issues.push({
      severity: "warning",
      rule: "\xA78",
      message: "`index.md` entries should be grouped under at least one section heading."
    });
  }
  return issues;
}
function validateLog(content) {
  const issues = [];
  const { hasFm } = splitFrontmatter(content);
  if (hasFm) {
    issues.push({
      severity: "warning",
      rule: "\xA79",
      message: "`log.md` is not expected to contain frontmatter."
    });
  }
  const h2s = [];
  const h2Re = /^##\s+(.+?)\s*$/gm;
  let h2Match;
  while ((h2Match = h2Re.exec(content)) !== null) {
    h2s.push(h2Match[1].trim());
  }
  if (h2s.length === 0) {
    issues.push({
      severity: "warning",
      rule: "\xA79",
      message: "`log.md` should contain date-grouped entries under `## YYYY-MM-DD` headings."
    });
    return issues;
  }
  const dates = [];
  for (const h of h2s) {
    if (!ISO_DATE_RE.test(h)) {
      issues.push({
        severity: "error",
        rule: "\xA79",
        message: `Log date heading "## ${h}" must be ISO 8601 \`YYYY-MM-DD\`.`
      });
    } else {
      dates.push(h);
    }
  }
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) {
      issues.push({
        severity: "warning",
        rule: "\xA79",
        message: `Log entries should be newest-first; "${dates[i]}" appears after "${dates[i - 1]}".`
      });
      break;
    }
  }
  return issues;
}
function hasNonEmpty2(data, key) {
  const v = data[key];
  if (v === void 0 || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function applyFixes(path, content, issues, settings, includeMigrations = false) {
  const applied = [];
  const MIGRATIONS = ["migrate-timestamp", "migrate-citations"];
  const fixes = new Set(
    issues.map((i) => i.fix).filter(
      (f) => !!f && (includeMigrations || !MIGRATIONS.includes(f))
    )
  );
  if (fixes.size === 0) return { content, applied };
  const nowIso = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const actor = settings.defaultActor || "okf-enforcer/0.5";
  const title = basename(path);
  const split = splitFrontmatter(content);
  if (!split.hasFm) {
    const lines = [
      `type: ${settings.defaultType}`,
      `title: ${title}`,
      `generated: { by: ${actor}, at: ${nowIso} }`
    ];
    const fm = `---
${lines.join("\n")}
---

`;
    applied.push("added frontmatter (type, title, generated)");
    return { content: fm + content.replace(/^\s+/, ""), applied };
  }
  const fmLines = split.raw.split(/\r?\n/);
  let body = split.body;
  const hasKey = (k) => fmLines.some((l) => new RegExp(`^${k}\\s*:`).test(l.trim()));
  if (fixes.has("add-type") && !hasKey("type")) {
    fmLines.unshift(`type: ${settings.defaultType}`);
    applied.push(`added type: ${settings.defaultType}`);
  }
  if (fixes.has("add-title") && !hasKey("title")) {
    fmLines.push(`title: ${title}`);
    applied.push("added title");
  }
  if (fixes.has("add-generated") && !hasKey("generated")) {
    fmLines.push(`generated: { by: ${actor}, at: ${nowIso} }`);
    applied.push("added generated");
  }
  if (fixes.has("migrate-timestamp") && hasKey("timestamp") && !hasKey("generated")) {
    for (let i = 0; i < fmLines.length; i++) {
      const m = fmLines[i].match(/^(\s*)timestamp\s*:\s*(.+?)\s*$/);
      if (m) {
        const at = m[2].replace(/^["']|["']$/g, "");
        fmLines[i] = `${m[1]}generated: { by: ${actor}, at: ${at} }`;
        applied.push("migrated timestamp \u2192 generated");
        break;
      }
    }
  }
  if (fixes.has("migrate-citations") && !hasKey("sources")) {
    const migrated = migrateCitations(body);
    if (migrated) {
      body = migrated.body;
      fmLines.push("sources:");
      for (const r of migrated.resources) fmLines.push(`  - resource: ${r}`);
      applied.push(`migrated # Citations \u2192 sources (${migrated.resources.length})`);
    }
  }
  const rebuilt = `---
${fmLines.join("\n")}
---${body}`;
  return { content: rebuilt, applied };
}
function migrateCitations(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+Citations\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const resources = [];
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^\s*[-*]\s+(.+?)\s*$/);
    if (m) resources.push(m[1].replace(/^["']|["']$/g, ""));
  }
  if (resources.length === 0) return null;
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  const newBody = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  return { body: newBody, resources };
}

// report-view.ts
var import_obsidian2 = require("obsidian");
var OKF_VIEW_TYPE = "okf-report-view";
var OkfReportView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.results = [];
    this.scanned = 0;
    /** Paths whose group is expanded. Default collapsed → empty set. */
    this.expanded = /* @__PURE__ */ new Set();
    // Persistent skeleton elements (built once, survive list re-renders).
    this.progressWrap = null;
    this.progressBar = null;
    this.progressLabel = null;
    this.bodyEl = null;
    this.plugin = plugin;
  }
  getViewType() {
    return OKF_VIEW_TYPE;
  }
  getDisplayText() {
    return "OKF conformance";
  }
  getIcon() {
    return "shield-check";
  }
  async onOpen() {
    this.buildSkeleton();
    this.renderBody();
  }
  /** Build the parts that persist across scans (toolbar + progress + body host). */
  buildSkeleton() {
    const c = this.contentEl;
    c.empty();
    c.addClass("okf-report");
    const toolbar = c.createDiv({ cls: "okf-toolbar" });
    const rescan = toolbar.createEl("button", { text: "Rescan" });
    rescan.setAttribute("aria-label", "Re-scan the whole vault");
    rescan.onclick = () => {
      void this.plugin.scanVault();
    };
    const fixAll = toolbar.createEl("button", { text: "Fix all" });
    fixAll.setAttribute("aria-label", "Auto-fix every fixable issue in the vault");
    fixAll.onclick = () => {
      void this.plugin.fixAll();
    };
    this.progressWrap = c.createDiv({ cls: "okf-progress is-hidden" });
    const track = this.progressWrap.createDiv({ cls: "okf-progress-track" });
    this.progressBar = track.createDiv({ cls: "okf-progress-bar" });
    this.progressLabel = this.progressWrap.createDiv({ cls: "okf-progress-label" });
    this.bodyEl = c.createDiv({ cls: "okf-body" });
  }
  // ---- progress API (driven by the plugin's processQueue) ----
  showProgress(label) {
    var _a;
    if (!this.progressWrap) this.buildSkeleton();
    (_a = this.progressWrap) == null ? void 0 : _a.removeClass("is-hidden");
    this.setProgress(0, label);
  }
  setProgress(fraction, label) {
    const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    if (this.progressBar)
      this.progressBar.style.setProperty("--okf-pct", `${pct}%`);
    if (this.progressWrap)
      this.progressWrap.setAttribute("aria-valuenow", String(pct));
    if (label && this.progressLabel)
      this.progressLabel.setText(`${label} \u2014 ${pct}%`);
  }
  hideProgress() {
    var _a;
    (_a = this.progressWrap) == null ? void 0 : _a.addClass("is-hidden");
  }
  setResults(results, scanned) {
    this.results = results;
    this.scanned = scanned;
    const paths = new Set(results.map((r) => r.path));
    for (const p of [...this.expanded]) if (!paths.has(p)) this.expanded.delete(p);
    this.renderBody();
  }
  /** Re-render only the summary + file list (leaves toolbar/progress intact). */
  renderBody() {
    if (!this.bodyEl) {
      this.buildSkeleton();
    }
    const b = this.bodyEl;
    b.empty();
    const errorFiles = this.results.filter(
      (r) => r.issues.some((i) => i.severity === "error")
    ).length;
    const warnFiles = this.results.length - errorFiles;
    const passFiles = this.scanned - this.results.length;
    const summary = b.createDiv({ cls: "okf-summary" });
    summary.createSpan({ cls: "okf-chip okf-pass", text: `\u2713 ${passFiles}` });
    summary.createSpan({ cls: "okf-chip okf-error", text: `\u2716 ${errorFiles}` });
    summary.createSpan({ cls: "okf-chip okf-warn", text: `\u26A0 ${warnFiles}` });
    if (this.scanned === 0) {
      b.createDiv({ cls: "okf-empty", text: "No scan yet \u2014 click Rescan." });
      return;
    }
    if (this.results.length === 0) {
      b.createDiv({ cls: "okf-empty", text: "\u2713 All notes conform." });
      return;
    }
    const sorted = [...this.results].sort((a, b2) => {
      const ae = a.issues.some((i) => i.severity === "error") ? 0 : 1;
      const be = b2.issues.some((i) => i.severity === "error") ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.path.localeCompare(b2.path);
    });
    const list = b.createDiv({ cls: "okf-list" });
    for (const r of sorted) {
      const isErr = r.issues.some((i) => i.severity === "error");
      const isOpen = this.expanded.has(r.path);
      const block = list.createDiv({ cls: "okf-file-block" });
      const head = block.createDiv({ cls: "okf-file-head" });
      head.setAttribute("aria-label", r.path);
      head.createSpan({ cls: "okf-caret", text: isOpen ? "\u25BE" : "\u25B8" });
      head.createSpan({ cls: `okf-dot ${isErr ? "error" : "warning"}` });
      const name = r.path.split("/").pop() || r.path;
      head.createSpan({ cls: "okf-file-name", text: name });
      head.createSpan({ cls: "okf-count", text: String(r.issues.length) });
      head.onclick = () => {
        if (this.expanded.has(r.path)) this.expanded.delete(r.path);
        else this.expanded.add(r.path);
        this.renderBody();
      };
      if (isOpen) {
        const body = block.createDiv({ cls: "okf-issues" });
        for (const issue of r.issues) {
          const row = body.createDiv({ cls: "okf-issue" });
          row.createSpan({
            cls: `okf-sev ${issue.severity}`,
            text: issue.severity === "error" ? "\u2716" : "\u26A0"
          });
          const txt = row.createSpan({ cls: "okf-issue-text" });
          txt.createSpan({ text: issue.message + " " });
          txt.createSpan({ cls: "okf-rule", text: issue.rule });
          if (issue.fix) txt.createSpan({ cls: "okf-fixable", text: " \xB7 fixable" });
        }
        const open = block.createEl("a", {
          cls: "okf-open-link",
          text: "Open note \u2192"
        });
        open.onclick = (e) => {
          e.preventDefault();
          const f = this.app.vault.getAbstractFileByPath(r.path);
          if (f instanceof import_obsidian2.TFile) void this.app.workspace.getLeaf(false).openFile(f);
        };
      }
    }
  }
};

// main.ts
function folderDepth(path) {
  return path === "/" || path === "" ? 0 : path.split("/").length;
}
var OkfPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.selfWrites = /* @__PURE__ */ new Set();
    this.dirtyIndexFolders = /* @__PURE__ */ new Set();
    this.busy = false;
    this.layoutReady = false;
    this.lastSummary = null;
    this.pendingResults = null;
    this.flushIndexes = (0, import_obsidian3.debounce)(
      async () => {
        if (!this.settings.autoGenerateIndex) return;
        const folders = [...this.dirtyIndexFolders].sort(
          (a, b) => folderDepth(b) - folderDepth(a)
        );
        this.dirtyIndexFolders.clear();
        for (const path of folders) {
          const folder = path === "/" || path === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
          if (folder instanceof import_obsidian3.TFolder && this.folderIsIndexable(folder)) {
            await this.generateIndexForFolder(folder, false);
          }
        }
      },
      1500,
      true
    );
  }
  onload() {
    this.settings = { ...DEFAULT_SETTINGS };
    void this.loadSettings();
    this.registerView(OKF_VIEW_TYPE, (leaf) => new OkfReportView(leaf, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.setText("OKF: \u2014");
    this.statusEl.addClass("mod-clickable");
    this.statusEl.setAttribute(
      "aria-label",
      "OKF \u2014 click to auto-fix this note"
    );
    this.statusEl.onClickEvent(() => {
      void this.onStatusClick();
    });
    this.addCommand({
      id: "okf-validate-vault",
      name: "Validate vault (full report)",
      callback: () => {
        void this.scanVault();
      }
    });
    this.addCommand({
      id: "okf-validate-active",
      name: "Validate active note",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void this.validateActive(f, true);
        return true;
      }
    });
    this.addCommand({
      id: "okf-fix-active",
      name: "Fix active note (add missing OKF fields)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void this.fixFile(f, true);
        return true;
      }
    });
    this.addCommand({
      id: "okf-fix-all",
      name: "Fix all auto-fixable issues in vault",
      callback: () => {
        void this.fixAll();
      }
    });
    this.addCommand({
      id: "okf-generate-index",
      name: "Generate/refresh index.md for a folder",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !(f.parent instanceof import_obsidian3.TFolder)) return false;
        if (!checking) void this.generateIndexForFolder(f.parent);
        return true;
      }
    });
    this.addCommand({
      id: "okf-generate-all-indexes",
      name: "Generate/refresh index.md for ALL folders",
      callback: () => {
        void this.generateAllIndexes();
      }
    });
    this.addCommand({
      id: "okf-add-log-entry",
      name: "Add log.md entry (current folder)",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || !(f.parent instanceof import_obsidian3.TFolder)) return false;
        if (!checking) void this.addLogEntry(f.parent);
        return true;
      }
    });
    this.addCommand({
      id: "okf-migrate-v01-v02",
      name: "Migrate note to latest OKF",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md" || isReserved(f.path)) return false;
        if (!checking) void this.migrateActive(f);
        return true;
      }
    });
    const liveCheck = (0, import_obsidian3.debounce)(
      (file) => {
        void this.onFileChanged(file);
      },
      500,
      true
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian3.TFile && file.extension === "md") {
          if (this.selfWrites.has(file.path)) {
            this.selfWrites.delete(file.path);
            return;
          }
          liveCheck(file);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file && file.extension === "md") void this.validateActive(file, false);
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!this.layoutReady) return;
        if (file instanceof import_obsidian3.TFolder) {
          this.markIndexDirty(file.path);
          return;
        }
        if (file instanceof import_obsidian3.TFile && file.extension === "md") {
          if (this.selfWrites.has(file.path)) {
            this.selfWrites.delete(file.path);
            return;
          }
          window.setTimeout(() => {
            void this.onFileChanged(file);
          }, 300);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!this.layoutReady) return;
        if (file instanceof import_obsidian3.TFile && file.extension !== "md") return;
        this.markIndexDirty(parentPath(file.path));
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!this.layoutReady) return;
        if (file instanceof import_obsidian3.TFile && file.extension !== "md") return;
        this.markIndexDirty(parentPath(oldPath));
        this.markIndexDirty(parentPath(file.path));
      })
    );
    this.addSettingTab(new OkfSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      window.setTimeout(() => {
        void this.startupPass();
      }, 1500);
    });
  }
  /**
   * The startup work, once the workspace has settled: bring the indexes up to
   * date, then scan. Both are opt-out/opt-in toggles, and either may be off.
   *
   * Indexes go first because a scan validates `index.md` against §8, and a
   * stale listing the pass is about to rewrite shouldn't be reported as a
   * finding the user then has to look at. They run one after the other rather
   * than together because each takes `this.busy` for the duration, so
   * overlapping them would mean one silently doing nothing.
   */
  async startupPass() {
    if (this.settings.autoGenerateIndex && this.settings.generateIndexOnStartup) {
      await this.generateAllIndexes(true);
    }
    if (this.settings.scanOnStartup) await this.scanVault(false, true);
  }
  onunload() {
  }
  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved != null ? saved : {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  isConcept(file) {
    if (file.extension !== "md") return false;
    if (isExcluded(file.path, this.settings)) return false;
    return true;
  }
  isRoot(file) {
    return !file.path.includes("/");
  }
  candidateFiles() {
    const configDir = this.app.vault.configDir;
    return this.app.vault.getMarkdownFiles().filter(
      (f) => !f.path.startsWith(configDir + "/") && !isExcluded(f.path, this.settings)
    );
  }
  /** Current report view, if open. */
  getReportView() {
    const leaf = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE)[0];
    return leaf && leaf.view instanceof OkfReportView ? leaf.view : null;
  }
  async processQueue(items, worker, label) {
    const size = Math.max(1, this.settings.batchSize | 0);
    const showBar = !!label && items.length > size;
    const view = showBar ? this.getReportView() : null;
    if (showBar && label) view == null ? void 0 : view.showProgress(label);
    const baseStatus = this.statusEl.getText();
    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      await Promise.all(batch.map((it) => worker(it).catch(() => {
      })));
      if (showBar) {
        const done = Math.min(i + size, items.length);
        const frac = done / items.length;
        view == null ? void 0 : view.setProgress(frac, label);
        this.statusEl.setText(`OKF ${Math.round(frac * 100)}%`);
      }
      await new Promise((r) => window.setTimeout(r, 0));
    }
    if (showBar) {
      view == null ? void 0 : view.hideProgress();
      this.statusEl.setText(baseStatus);
    }
  }
  async onFileChanged(file) {
    if (!this.isConcept(file)) return;
    if (this.settings.fixOnSave && !isReserved(file.path)) {
      const n = await this.fixFile(file, false);
      if (n > 0 && file.parent) {
        this.markIndexDirty(file.parent.path);
      }
    }
    if (this.settings.liveCheckOnSave) {
      const active = this.app.workspace.getActiveFile();
      if (active && active.path === file.path) {
        await this.validateActive(file, false);
      }
    }
    if (this.settings.autoGenerateIndex && file.parent) {
      this.markIndexDirty(file.parent.path);
    }
  }
  /**
   * Queues a folder's index.md for the next debounced regeneration, along with
   * every folder above it. A listing describes its subdirectories as well as its
   * notes, and both halves of a subdirectory entry look past the folder itself:
   * whether one is worth listing depends on what it holds at any depth, and its
   * description is read out of its own index.md. So a note appearing or
   * vanishing deep in a tree can change every listing above it, not just the one
   * in the folder the note sat in.
   */
  markIndexDirty(path) {
    if (!this.settings.autoGenerateIndex) return;
    for (let p = path; ; p = parentPath(p)) {
      this.dirtyIndexFolders.add(p);
      if (p === "/" || p === "") break;
    }
    this.flushIndexes();
  }
  /**
   * Status-bar click: auto-fix the active note, then — if required fields
   * still can't be satisfied automatically — prompt the user to fill them.
   * With no active note, fall back to a full vault scan + report.
   */
  async onStatusClick() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md" || isReserved(file.path)) {
      await this.scanVault(true, false);
      return;
    }
    let content = await this.app.vault.read(file);
    const preIssues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    const hadRequiredError = preIssues.some((i) => i.severity === "error");
    await this.fixFile(file, false);
    content = await this.app.vault.read(file);
    const postIssues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    this.updateStatus(postIssues, content);
    const remainingErrors = postIssues.filter((i) => i.severity === "error");
    if (remainingErrors.length > 0) {
      this.promptForRequiredFields(file, remainingErrors);
    } else if (hadRequiredError) {
      this.promptForRequiredFields(file, preIssues.filter((i) => i.severity === "error"));
    } else {
      new import_obsidian3.Notice("OKF: note is conformant \u2705");
    }
  }
  /** Open a modal asking the user to supply required OKF fields. */
  promptForRequiredFields(file, errors) {
    new OkfPromptModal(this.app, this, file, errors).open();
  }
  async validateActive(file, openReport) {
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    this.updateStatus(issues, content);
    if (openReport) {
      this.renderResults(issues.length ? [{ path: file.path, issues }] : [], 1);
      void this.activateView();
      if (!issues.length) new import_obsidian3.Notice("OKF: active note is conformant \u2705");
    }
  }
  updateStatus(issues, content) {
    const errs = issues.filter((i) => i.severity === "error").length;
    const warns = issues.filter((i) => i.severity === "warning").length;
    const tier = this.settings.warnTrustFields && content !== void 0 ? trustTierOfContent(content) : null;
    this.statusEl.removeClass(
      "okf-statusbar-ok",
      "okf-statusbar-bad",
      "okf-statusbar-warn"
    );
    if (errs > 0) {
      this.statusEl.setText(`OKF \u2716 ${errs}`);
      this.statusEl.addClass("okf-statusbar-bad");
    } else if (warns > 0) {
      this.statusEl.setText(`OKF \u26A0 ${warns}`);
      this.statusEl.addClass("okf-statusbar-warn");
    } else {
      this.statusEl.setText("OKF \u2713");
      this.statusEl.addClass("okf-statusbar-ok");
    }
    if (issues.length === 0) {
      const lines = ["Active note conforms to OKF v0.2"];
      if (tier) lines.push(`Trust tier: ${tier}`);
      lines.push("");
      lines.push("Click to scan the whole vault");
      this.statusEl.setAttribute("aria-label", lines.join("\n"));
    } else {
      const lines = issues.slice(0, 8).map((i) => `${i.severity === "error" ? "\u2716" : "\u26A0"} ${i.rule} ${i.message}`);
      if (issues.length > 8) lines.push(`\u2026and ${issues.length - 8} more`);
      if (tier) {
        lines.push("");
        lines.push(`Trust tier: ${tier}`);
      }
      lines.push("");
      lines.push("Click to scan the whole vault");
      this.statusEl.setAttribute("aria-label", lines.join("\n"));
    }
  }
  /** Vault-wide summary tooltip on the status bar (set after a full scan). */
  refreshStatusTooltip() {
    if (!this.lastSummary) return;
    const { scanned, errFiles, warnFiles } = this.lastSummary;
    const ok = scanned - errFiles - warnFiles;
    this.statusEl.setAttribute(
      "aria-label",
      `OKF v0.2 \u2014 ${scanned} notes scanned
\u2713 ${ok} conformant
\u2716 ${errFiles} with errors
\u26A0 ${warnFiles} warnings only

Click to open the report`
    );
  }
  async scanVault(reveal = true, silent = false) {
    if (this.busy) {
      if (!silent) new import_obsidian3.Notice("OKF: a scan/fix is already running\u2026");
      return;
    }
    this.busy = true;
    try {
      const files = this.candidateFiles();
      const results = [];
      await this.processQueue(
        files,
        async (f) => {
          const content = await this.app.vault.read(f);
          const issues = validateContent(
            f.path,
            content,
            this.isRoot(f),
            this.settings
          );
          if (issues.length) results.push({ path: f.path, issues });
        },
        silent ? void 0 : "OKF: scanning"
      );
      results.sort((a, b) => a.path.localeCompare(b.path));
      this.renderResults(results, files.length);
      const errFiles = results.filter(
        (r) => r.issues.some((i) => i.severity === "error")
      ).length;
      const warnFiles = results.length - errFiles;
      this.lastSummary = { scanned: files.length, errFiles, warnFiles };
      this.refreshStatusTooltip();
      if (reveal && !silent) await this.activateView();
      if (!silent) {
        new import_obsidian3.Notice(
          `OKF: scanned ${files.length} notes \u2014 ${errFiles} with errors, ${warnFiles} with warnings only.`
        );
      }
    } finally {
      this.busy = false;
    }
  }
  renderResults(results, scanned) {
    const leaf = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE)[0];
    if (leaf && leaf.view instanceof OkfReportView) {
      leaf.view.setResults(results, scanned);
    } else {
      this.pendingResults = { results, scanned };
    }
  }
  async fixFile(file, notify) {
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    if (isReserved(file.path)) {
      if (notify)
        new import_obsidian3.Notice("OKF: reserved files (index/log) are not auto-fixable.");
      return 0;
    }
    const { content: fixed, applied } = applyFixes(
      file.path,
      content,
      issues,
      this.settings,
      this.settings.autoMigrateOnFix
    );
    if (applied.length > 0 && fixed !== content) {
      this.selfWrites.add(file.path);
      await this.app.vault.modify(file, fixed);
      if (notify)
        new import_obsidian3.Notice(`OKF fixed ${file.basename}: ${applied.join(", ")}`);
      return applied.length;
    }
    if (notify) new import_obsidian3.Notice("OKF: nothing auto-fixable on this note.");
    return 0;
  }
  /**
   * Migrate a note from OKF v0.1 to v0.2 (§13): rename `timestamp` → `generated`
   * and lift a body `# Citations` list into `sources`. Runs the migration fixes
   * that ordinary save-time auto-fix deliberately skips.
   */
  async migrateActive(file) {
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    const { content: fixed, applied } = applyFixes(
      file.path,
      content,
      issues,
      this.settings,
      true
    );
    if (applied.length > 0 && fixed !== content) {
      this.selfWrites.add(file.path);
      await this.app.vault.modify(file, fixed);
      new import_obsidian3.Notice(`OKF migrated ${file.basename}: ${applied.join(", ")}`);
    } else {
      new import_obsidian3.Notice("OKF: nothing to migrate \u2014 note already uses v0.2 fields.");
    }
  }
  /**
   * Write user-supplied frontmatter values (from the prompt modal) into a note,
   * using Obsidian's safe frontmatter editor. Empty values are skipped.
   */
  async setFrontmatterFields(file, fields) {
    this.selfWrites.add(file.path);
    await this.app.fileManager.processFrontMatter(
      file,
      (fm) => {
        for (const [k, v] of Object.entries(fields)) {
          const val = (v != null ? v : "").trim();
          if (val.length > 0) fm[k] = val;
        }
      }
    );
    const content = await this.app.vault.read(file);
    const issues = validateContent(
      file.path,
      content,
      this.isRoot(file),
      this.settings
    );
    this.updateStatus(issues, content);
  }
  async fixAll() {
    if (this.busy) {
      new import_obsidian3.Notice("OKF: a scan/fix is already running\u2026");
      return;
    }
    this.busy = true;
    let changed = 0;
    try {
      const files = this.candidateFiles().filter((f) => !isReserved(f.path));
      await this.processQueue(
        files,
        async (f) => {
          const n = await this.fixFile(f, false);
          if (n > 0) changed++;
        },
        "OKF: fixing"
      );
    } finally {
      this.busy = false;
    }
    new import_obsidian3.Notice(`OKF: auto-fixed ${changed} note(s).`);
    await this.scanVault();
  }
  /** Writes the folder's index.md; returns whether the file changed on disk. */
  async generateIndexForFolder(folder, notify = true) {
    var _a, _b, _c;
    if (!folder) {
      if (notify) new import_obsidian3.Notice("OKF: no folder for the active note.");
      return false;
    }
    const indexPath = folder.path === "/" || folder.path === "" ? "index.md" : `${folder.path}/index.md`;
    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    const current = existing instanceof import_obsidian3.TFile ? await this.app.vault.read(existing) : null;
    const kept = current === null ? "" : sectionBlock(current, this.settings.indexSubdirDescSection);
    const children = folder.children;
    const byType = /* @__PURE__ */ new Map();
    const subdirs = [];
    const files = [];
    for (const child of children) {
      if (child instanceof import_obsidian3.TFile) {
        if (isReserved(child.path)) continue;
        if (child.extension !== "md") {
          files.push({
            section: INDEX_SECTIONS.files,
            link: encodeLink(child.name),
            title: child.name,
            desc: ""
          });
          continue;
        }
        const fm = (_b = (_a = this.app.metadataCache.getFileCache(child)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
        const fmTitle = fm["title"];
        const fmDesc = fm["description"];
        const fmTitleText = typeof fmTitle === "string" ? oneLine(fmTitle) : "";
        const title = fmTitleText || basename(child.path);
        const desc = typeof fmDesc === "string" ? oneLine(fmDesc) : "";
        const section = sectionForType(fm["type"]);
        const bucket = byType.get(section);
        const entry = {
          section,
          link: encodeLink(child.name),
          title,
          desc
        };
        if (bucket) bucket.push(entry);
        else byType.set(section, [entry]);
      } else if (child instanceof import_obsidian3.TFolder) {
        if (!this.folderIsIndexable(child)) continue;
        let childIndex = this.app.vault.getAbstractFileByPath(
          `${child.path}/index.md`
        );
        if (!(childIndex instanceof import_obsidian3.TFile) || this.indexesMissingBelow(child)) {
          await this.generateIndexForFolder(child, false);
          childIndex = this.app.vault.getAbstractFileByPath(
            `${child.path}/index.md`
          );
        }
        subdirs.push({
          section: INDEX_SECTIONS.subdirs,
          link: `${encodeLink(child.name)}/index.md`,
          title: child.name,
          desc: childIndex instanceof import_obsidian3.TFile ? await this.folderDescription(childIndex) : ""
        });
      }
    }
    const groups = [
      [INDEX_SECTIONS.subdirs, subdirs],
      ...[...byType.entries()].filter(([section]) => section !== INDEX_SECTIONS.untyped).sort(([a], [b]) => a.localeCompare(b)),
      [INDEX_SECTIONS.untyped, (_c = byType.get(INDEX_SECTIONS.untyped)) != null ? _c : []],
      [INDEX_SECTIONS.files, files]
    ];
    const sections = /* @__PURE__ */ new Map();
    for (const [section, group] of groups) {
      if (group.length === 0) continue;
      const at = sections.get(section.toLowerCase());
      if (!at) sections.set(section.toLowerCase(), [...group]);
      else for (const e of group) at.push({ ...e, section: at[0].section });
    }
    const entries = [...sections.values()].flat();
    const maintaining = current !== null && !this.settings.overwriteExistingIndex;
    let out;
    if (maintaining) {
      const base = folder.path === "/" || folder.path === "" ? "" : `${folder.path}/`;
      out = mergeIndex(
        current,
        entries,
        (target) => this.app.vault.getAbstractFileByPath(base + target) !== null
      );
    } else {
      out = renderIndex(entries, kept);
      if (indexPath === "index.md") {
        out = `---
okf_version: "${OKF_VERSION}"
---

${out}`;
      }
    }
    if (existing instanceof import_obsidian3.TFile) {
      if (current === out) return false;
      this.selfWrites.add(indexPath);
      await this.app.vault.modify(existing, out);
    } else {
      this.selfWrites.add(indexPath);
      await this.app.vault.create(indexPath, out);
    }
    if (notify) new import_obsidian3.Notice(`OKF: wrote ${indexPath}`);
    return true;
  }
  /**
   * Description for a subdirectory entry, read from the configured section of
   * that folder's index.md (e.g. `# Purpose`). Non-root indexes carry no
   * frontmatter (§8), so a body section is the only place a folder can say what
   * it is for.
   */
  async folderDescription(index) {
    const section = this.settings.indexSubdirDescSection.trim();
    if (!section) return "";
    return sectionSummary(await this.app.vault.cachedRead(index), section);
  }
  /**
   * Whether a folder is one this plugin writes an index for and lists in its
   * parent. Every folder in the bundle qualifies — an empty one included, since
   * a listing that says a directory is empty is more use than a directory that
   * can't be reached — except the ones that aren't part of the bundle at all:
   * Obsidian's own config folder and anything the user excluded.
   */
  folderIsIndexable(folder) {
    const path = folder.path;
    if (path === "/" || path === "") return true;
    const config = this.app.vault.configDir;
    if (path === config || path.startsWith(config + "/")) return false;
    return !isExcluded(path, this.settings);
  }
  /**
   * Whether any folder worth listing somewhere below this one still has no
   * `index.md`. Answered from the loaded file tree alone — no reads — so it is
   * cheap to ask on every generation, and it stops being true once the tree has
   * been filled in once.
   */
  indexesMissingBelow(folder) {
    for (const child of folder.children) {
      if (!(child instanceof import_obsidian3.TFolder)) continue;
      if (!this.folderIsIndexable(child)) continue;
      const has = this.app.vault.getAbstractFileByPath(`${child.path}/index.md`) instanceof import_obsidian3.TFile;
      if (!has || this.indexesMissingBelow(child)) return true;
    }
    return false;
  }
  async generateAllIndexes(silent = false) {
    if (this.busy) {
      if (!silent) new import_obsidian3.Notice("OKF: a scan/fix is already running\u2026");
      return;
    }
    this.busy = true;
    try {
      const list = [];
      const walk = (folder) => {
        if (!this.folderIsIndexable(folder)) return;
        list.push(folder);
        for (const child of folder.children) {
          if (child instanceof import_obsidian3.TFolder) walk(child);
        }
      };
      walk(this.app.vault.getRoot());
      list.sort((a, b) => folderDepth(b.path) - folderDepth(a.path));
      let written = 0;
      await this.processQueue(
        list,
        async (folder) => {
          if (await this.generateIndexForFolder(folder, false)) written++;
        },
        "OKF: building indexes"
      );
      if (!silent) {
        new import_obsidian3.Notice(
          `OKF: updated index.md in ${written} of ${list.length} folder(s).`
        );
      }
    } finally {
      this.busy = false;
    }
  }
  async addLogEntry(folder) {
    if (!folder) return;
    const logPath = folder.path === "/" || folder.path === "" ? "log.md" : `${folder.path}/log.md`;
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const entry = `* **Update**: `;
    const existing = this.app.vault.getAbstractFileByPath(logPath);
    if (existing instanceof import_obsidian3.TFile) {
      let content = await this.app.vault.read(existing);
      const heading = `## ${today}`;
      if (content.includes(heading)) {
        content = content.replace(heading, `${heading}
${entry}`);
      } else {
        const h1 = content.match(/^#\s+.+$/m);
        if (h1) {
          const idx = content.indexOf(h1[0]) + h1[0].length;
          content = content.slice(0, idx) + `

${heading}
${entry}` + content.slice(idx);
        } else {
          content = `# Update Log

${heading}
${entry}
` + content;
        }
      }
      this.selfWrites.add(logPath);
      await this.app.vault.modify(existing, content);
    } else {
      this.selfWrites.add(logPath);
      await this.app.vault.create(
        logPath,
        `# Update Log

## ${today}
${entry}
`
      );
    }
    const file = this.app.vault.getAbstractFileByPath(logPath);
    if (file instanceof import_obsidian3.TFile)
      await this.app.workspace.getLeaf(false).openFile(file);
    new import_obsidian3.Notice(`OKF: added log entry for ${today}`);
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(OKF_VIEW_TYPE);
    let leaf;
    if (existing.length) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getRightLeaf(false);
      await (leaf == null ? void 0 : leaf.setViewState({ type: OKF_VIEW_TYPE, active: true }));
    }
    if (leaf) {
      void this.app.workspace.revealLeaf(leaf);
      if (this.pendingResults && leaf.view instanceof OkfReportView) {
        leaf.view.setResults(
          this.pendingResults.results,
          this.pendingResults.scanned
        );
        this.pendingResults = null;
      }
    }
  }
};
var OkfSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  /**
   * Single source of truth for the settings UI, consumed by both the imperative
   * display() (Obsidian < 1.13) and the declarative getSettingDefinitions()
   * (Obsidian 1.13+) so the two paths can never drift.
   */
  settingSpecs() {
    const s = this.plugin.settings;
    const save = () => void this.plugin.saveSettings();
    const list = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
    return [
      {
        name: "Default type for auto-fix",
        desc: "Value inserted into `type` when fixing notes that lack it.",
        control: (row) => row.addText(
          (t) => t.setValue(s.defaultType).onChange((v) => {
            s.defaultType = v.trim() || "Concept";
            save();
          })
        )
      },
      {
        name: "Default actor for `generated.by`",
        desc: "Actor written when auto-fix adds a `generated` block (\xA77). Use `<producer>/<version>` (e.g. `okf-enforcer/0.5`) or `human:<id>`. Avoid commas \u2014 the block is written as inline YAML.",
        control: (row) => row.addText(
          (t) => t.setValue(s.defaultActor).onChange((v) => {
            s.defaultActor = v.trim() || "okf-enforcer/0.5";
            save();
          })
        )
      },
      {
        name: "Live check on save / open",
        desc: "Validate the active note as you edit and when you open it.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.liveCheckOnSave).onChange((v) => {
            s.liveCheckOnSave = v;
            save();
          })
        )
      },
      { name: "Automation", heading: true },
      {
        name: "Scan vault on startup",
        desc: "Scan the whole vault for conformance when the plugin loads, once the workspace is ready.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.scanOnStartup).onChange((v) => {
            s.scanOnStartup = v;
            save();
          })
        )
      },
      {
        name: "Fix format issues on save",
        desc: "Insert missing OKF frontmatter (`type`, `title`, `generated`) when you edit a note. Never overwrites a value you've set.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.fixOnSave).onChange((v) => {
            s.fixOnSave = v;
            save();
          })
        )
      },
      {
        name: "Auto-migrate to latest OKF on fix",
        desc: 'Let auto-fix also upgrade notes to the latest OKF version \u2014 `timestamp` \u2192 `generated`, `# Citations` \u2192 `sources`. Off leaves this to the "Migrate note to latest OKF" command, since a migration rewrites what you wrote.',
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.autoMigrateOnFix).onChange((v) => {
            s.autoMigrateOnFix = v;
            save();
          })
        )
      },
      { name: "index.md", heading: true },
      {
        name: "Auto-generate index.md",
        desc: `Keep every folder's index.md (its \xA78 listing) current as notes are added, renamed, and deleted \u2014 including the listings above it, since a parent describes its subfolders by what they hold. Every folder gets an index, an empty one included; the config folder and "Excluded folders" are left alone.`,
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.autoGenerateIndex).onChange((v) => {
            s.autoGenerateIndex = v;
            save();
          })
        )
      },
      {
        name: "Generate index.md on startup",
        desc: 'Bring every index up to date once when the plugin loads, for what changed while Obsidian was closed \u2014 a vault synced from another machine, or edited outside it. Runs quietly, before the startup scan. Off by default; needs "Auto-generate index.md" on.',
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.generateIndexOnStartup).onChange((v) => {
            s.generateIndexOnStartup = v;
            save();
          })
        )
      },
      {
        name: "Rebuild existing index.md",
        desc: "Off (default): generating an index adds what it doesn't already list, corrects a link pointing at the wrong path, and drops an entry whose note is gone, leaving your prose, ordering, titles, and descriptions alone. On: the listing is rewritten from the folder's contents, which refreshes every description and re-groups entries under their current `type` \u2014 but discards any prose you added, apart from the section named below.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.overwriteExistingIndex).onChange((v) => {
            s.overwriteExistingIndex = v;
            save();
          })
        )
      },
      {
        name: "Subdirectory description section",
        desc: "Heading in a subfolder's index.md whose first paragraph becomes that folder's description in the parent listing (e.g. `Purpose`). This is the one section a rebuild carries over. Blank leaves subfolder entries undescribed.",
        control: (row) => row.addText(
          (t) => t.setPlaceholder("Purpose").setValue(s.indexSubdirDescSection).onChange((v) => {
            s.indexSubdirDescSection = v.trim();
            save();
          })
        )
      },
      { name: "Rules", heading: true },
      {
        name: "Warn on missing recommended fields",
        desc: "Warn when `title`, `description`, or `generated` is missing (\xA74.1, \xA75.2).",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.warnRecommendedFields).onChange((v) => {
            s.warnRecommendedFields = v;
            save();
          })
        )
      },
      {
        name: "Warn on missing tags",
        desc: "Warn when a note has no `tags`. Off by default \u2014 the spec doesn't ask for them.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.warnTagsField).onChange((v) => {
            s.warnTagsField = v;
            save();
          })
        )
      },
      {
        name: "Validate trust & lifecycle fields",
        desc: "Check the v0.2 trust fields on notes that carry them: `verified`, `status`, `stale_after` (including whether it has passed), `sources` (\xA75), and show the note's trust tier in the status-bar tooltip. Advisory; off by default.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.warnTrustFields).onChange((v) => {
            s.warnTrustFields = v;
            save();
          })
        )
      },
      {
        name: "Validate Attested Computation concepts",
        desc: "Check `type: Attested Computation` notes (\xA710): required `runtime`, a present computation, and `parameters`/`executor`/`attester` shape.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.checkAttestedComputation).onChange((v) => {
            s.checkAttestedComputation = v;
            save();
          })
        )
      },
      { name: "Scope & performance", heading: true },
      {
        name: "Excluded folders",
        desc: "Comma-separated paths skipped by validation and index generation \u2014 use it for an attachments folder you'd rather not have an index.md in. The config folder is always skipped.",
        control: (row) => row.addText(
          (t) => t.setValue(s.excludeFolders.join(", ")).onChange((v) => {
            s.excludeFolders = list(v);
            save();
          })
        )
      },
      {
        name: "Batch size",
        desc: "Files processed per async chunk during scan/fix. Lower = smoother UI on large vaults; higher = faster.",
        control: (row) => row.addText(
          (t) => t.setValue(String(s.batchSize)).onChange((v) => {
            const n = parseInt(v, 10);
            s.batchSize = isNaN(n) || n < 1 ? 50 : Math.min(n, 1e3);
            save();
          })
        )
      },
      { name: "Portent", heading: true },
      {
        name: "Enable Portent validation",
        desc: "Also check notes against the Portent spec (portent.md) \u2014 its type vocabulary, lifecycle, and `belongs_to`/`related_to` links. Findings are always warnings and never block OKF conformance. Experimental: Portent is pre-1.0 and may still change.",
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.enablePortent).onChange((v) => {
            s.enablePortent = v;
            save();
            this.refresh();
          })
        )
      },
      {
        name: "Validate type vocabulary",
        desc: "Warn when `type` isn't one of the accepted values set under Portent schema.",
        portentDependent: true,
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.portentCheckTypeVocab).onChange((v) => {
            s.portentCheckTypeVocab = v;
            save();
          })
        )
      },
      {
        name: "Validate lifecycle",
        desc: "Check lifecycle values on notes that carry them. A note with no lifecycle is never flagged.",
        portentDependent: true,
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.portentCheckLifecycle).onChange((v) => {
            s.portentCheckLifecycle = v;
            save();
          })
        )
      },
      {
        name: "Validate belongs_to",
        desc: "Check `belongs_to` when present \u2014 a single wikilink to the primary parent.",
        portentDependent: true,
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.portentCheckBelongsTo).onChange((v) => {
            s.portentCheckBelongsTo = v;
            save();
          })
        )
      },
      {
        name: "Validate related_to",
        desc: "Check `related_to` when present \u2014 a list of wikilinks.",
        portentDependent: true,
        control: (row) => row.addToggle(
          (tg) => tg.setValue(s.portentCheckRelatedTo).onChange((v) => {
            s.portentCheckRelatedTo = v;
            save();
          })
        )
      },
      {
        name: "Portent schema",
        desc: "Rename the frontmatter keys and redefine the vocabularies Portent checks, to match your own conventions or a future spec revision. Leave a field blank to restore its default.",
        heading: true,
        portentDependent: true
      },
      {
        name: "Type vocabulary",
        desc: "Comma-separated accepted `type` values.",
        portentDependent: true,
        control: (row) => row.addText(
          (t) => t.setValue(s.portentTypes.join(", ")).onChange((v) => {
            const l = list(v);
            s.portentTypes = l.length ? l : [...PORTENT_TYPES];
            save();
          })
        )
      },
      {
        name: "Lifecycle status field",
        desc: "Frontmatter key holding the single lifecycle value (default `status`; e.g. rename to `state`).",
        portentDependent: true,
        control: (row) => row.addText(
          (t) => t.setValue(s.portentStatusField).onChange((v) => {
            s.portentStatusField = v.trim() || "status";
            save();
          })
        )
      },
      {
        name: "Lifecycle status values",
        desc: "Comma-separated accepted values for the status field.",
        portentDependent: true,
        control: (row) => row.addText(
          (t) => t.setValue(s.portentStatuses.join(", ")).onChange((v) => {
            const l = list(v);
            s.portentStatuses = l.length ? l : [...PORTENT_STATUSES];
            save();
          })
        )
      },
      {
        name: "Organized field",
        desc: "Frontmatter key for the boolean `organized` lifecycle flag.",
        portentDependent: true,
        control: (row) => row.addText(
          (t) => t.setValue(s.portentOrganizedField).onChange((v) => {
            s.portentOrganizedField = v.trim() || "organized";
            save();
          })
        )
      },
      {
        name: "Archived field",
        desc: "Frontmatter key for the boolean `archived` lifecycle flag.",
        portentDependent: true,
        control: (row) => row.addText(
          (t) => t.setValue(s.portentArchivedField).onChange((v) => {
            s.portentArchivedField = v.trim() || "archived";
            save();
          })
        )
      },
      {
        name: "Belongs-to field",
        desc: "Frontmatter key for the single-parent relationship (a wikilink).",
        portentDependent: true,
        control: (row) => row.addText(
          (t) => t.setValue(s.portentBelongsToField).onChange((v) => {
            s.portentBelongsToField = v.trim() || "belongs_to";
            save();
          })
        )
      },
      {
        name: "Related-to field",
        desc: "Frontmatter key for the related-notes relationship (a list of wikilinks).",
        portentDependent: true,
        control: (row) => row.addText(
          (t) => t.setValue(s.portentRelatedToField).onChange((v) => {
            s.portentRelatedToField = v.trim() || "related_to";
            save();
          })
        )
      }
    ];
  }
  /** Apply one spec to a Setting row — shared by the imperative and declarative paths. */
  applySpec(row, spec) {
    var _a;
    row.setName(spec.name);
    if (spec.desc) row.setDesc(spec.desc);
    if (spec.heading) {
      row.setHeading();
    } else {
      (_a = spec.control) == null ? void 0 : _a.call(spec, row);
    }
    if (spec.portentDependent && !this.plugin.settings.enablePortent) {
      row.setDisabled(true);
    }
  }
  /** Imperative rendering — Obsidian < 1.13's dual-support fallback. */
  display() {
    const { containerEl } = this;
    containerEl.empty();
    for (const spec of this.settingSpecs()) {
      this.applySpec(new import_obsidian3.Setting(containerEl), spec);
    }
  }
  /**
   * Declarative settings — Obsidian 1.13+ renders from these definitions (and
   * indexes them for settings search) instead of calling display(). Each row
   * delegates to the same builders display() uses, so behavior and the Portent
   * enable/disable dependency stay identical across both paths.
   */
  getSettingDefinitions() {
    return this.settingSpecs().map(
      (spec) => ({
        name: spec.name,
        desc: spec.desc,
        searchable: !spec.heading,
        render: (row) => {
          this.applySpec(row, spec);
        }
      })
    );
  }
  /** Re-render after toggling Portent: update() on 1.13+, display() on older. */
  refresh() {
    const tab = this;
    if (typeof tab.update === "function") tab.update();
    else this.display();
  }
};
var OkfPromptModal = class extends import_obsidian3.Modal {
  constructor(app, plugin, file, errors) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.errors = errors;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter || {};
    this.typeValue = typeof fm["type"] === "string" ? fm["type"] : plugin.settings.defaultType;
    this.titleValue = typeof fm["title"] === "string" ? fm["title"] : file.basename;
    this.descValue = typeof fm["description"] === "string" ? fm["description"] : "";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "OKF \u2014 required fields" });
    contentEl.createEl("p", {
      cls: "okf-modal-intro",
      text: `\u201C${this.file.basename}\u201D needs a valid OKF type. Set the fields below and save.`
    });
    if (this.errors.length) {
      const box = contentEl.createDiv({ cls: "okf-modal-issues" });
      for (const e of this.errors) {
        box.createDiv({ text: `\u2716 ${e.rule} \u2014 ${e.message}` });
      }
    }
    const typeField = contentEl.createDiv({ cls: "okf-modal-field" });
    typeField.createEl("label", { text: "type (required)" });
    const typeInput = typeField.createEl("input", { type: "text" });
    typeInput.value = this.typeValue;
    typeInput.placeholder = "e.g. Concept, Source, Playbook, Reference";
    typeInput.oninput = () => this.typeValue = typeInput.value;
    window.setTimeout(() => {
      typeInput.focus();
      typeInput.select();
    }, 0);
    const titleField = contentEl.createDiv({ cls: "okf-modal-field" });
    titleField.createEl("label", { text: "title" });
    const titleInput = titleField.createEl("input", { type: "text" });
    titleInput.value = this.titleValue;
    titleInput.oninput = () => this.titleValue = titleInput.value;
    const descField = contentEl.createDiv({ cls: "okf-modal-field" });
    descField.createEl("label", { text: "description" });
    const descInput = descField.createEl("input", { type: "text" });
    descInput.value = this.descValue;
    descInput.placeholder = "one-line summary";
    descInput.oninput = () => this.descValue = descInput.value;
    const buttons = contentEl.createDiv({ cls: "okf-modal-buttons" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = buttons.createEl("button", {
      text: "Save",
      cls: "mod-cta"
    });
    save.onclick = async () => {
      const type = this.typeValue.trim();
      if (!type) {
        new import_obsidian3.Notice("OKF: type is required.");
        typeInput.focus();
        return;
      }
      await this.plugin.setFrontmatterFields(this.file, {
        type,
        title: this.titleValue,
        description: this.descValue
      });
      new import_obsidian3.Notice("OKF: fields saved \u2713");
      this.close();
    };
    contentEl.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save.click();
      }
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};
