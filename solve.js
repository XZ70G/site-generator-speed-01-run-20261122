// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// Own implementation of the makefun-site dialect (front matter, Markdown
// subset, template dialect, slug rule, report), written to be byte-identical
// to the reference while doing far less work: cached slugs, chunked HTML
// escaping, a single-pass Markdown lexer/renderer, and template rendering
// that appends into one output array instead of building throwaway strings.
// Dependency-free ES module; run(input) returns the output tree object.

// Escape HTML: a native regex pre-check (most values need no escaping), then
// one pass over char codes; returns the input unchanged when nothing needs it.
const ESC_RE = /[&<>"']/;
function escapeHtml(text) {
  if (!ESC_RE.test(text)) return text;
  let out = '', start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    else continue;
    out += text.slice(start, i) + rep;
    start = i + 1;
  }
  if (start === 0) return text;
  return out + text.slice(start);
}

// ---- slugs (cached) ----
const slugCache = new Map();
const SLUG_MAX = 64;
function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  let plain = text;
  // ASCII-only text is unchanged by NFKD and holds no combining marks.
  if (/[^\x00-\x7F]/.test(text)) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '', gap = false;
  if (plain === text) {
    for (let i = 0; i < plain.length; i++) {
      const c = plain.charCodeAt(i);
      let keep = -1;
      if (c >= 65 && c <= 90) keep = c + 32;
      else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
      if (keep === -1) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += String.fromCharCode(keep);
    }
  } else {
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) { gap = out.length > 0; continue; }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  slugCache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = slug + '-' + n;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(date) {
  const y = date.slice(0, 4), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  return d + ' ' + MONTHS[m - 1] + ' ' + y;
}

// ---- front matter ----
const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const LINE_RE = /^([a-z_]+):(?: (.*))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) { // '"'
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n; i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' }; // '['
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: 'key "' + key + '": ' + s.error } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0, mo = m ? Number(m[2]) : 0, d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo))
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (t === '' || !TAG_RE.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: 'unknown key "' + key + '"' };
  }
}

// Returns { data, bodyLines } or { error }. bodyLines is the lines after '---'.
function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i] === '---') { close = i; break; }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (line === '' || /^[ \t]+$/.test(line) || line.charCodeAt(0) === 35) continue; // blank or '#...'
    const m = LINE_RE.exec(line);
    if (!m) return { error: 'line ' + (i + 1) + ' is not "key: value"' };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (KEYS.indexOf(key) === -1) return { error: 'unknown key "' + key + '"' };
    if (Object.hasOwn(data, key)) return { error: 'key "' + key + '" is given twice' };
    if (raw === '') return { error: 'key "' + key + '" has no value' };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyLines: lines.slice(close + 1) };
}

// ---- Markdown (single pass over lines) ----
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const FENCE_OPEN_RE = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE_RE = /^```[ \t]*$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR_RE = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET_RE = /^[-*] (.*)$/;
const ORDERED_RE = /^(\d{1,9})\. (.*)$/;

function isBlank(line) {
  if (line === '') return true;
  for (let i = 0; i < line.length; i++) { const c = line.charCodeAt(i); if (c !== 32 && c !== 9) return false; }
  return true;
}
function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}
function headingOf(line) {
  const m = HEADING_RE.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}
function endsParagraph(line) {
  if (line === '') return true;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) return isBlank(line);
  if (c0 === 96) return FENCE_OPEN_RE.test(line);
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return HR_RE.test(line);
  return false;
}
const CONTINUED_RE = /^ {2,}\S/;
function isContinued(line) { return CONTINUED_RE.test(line); }

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

// Render inline markup of s into out[] (array of string parts). Plain runs
// are pushed unescaped only after this scan has seen every character, so the
// five escapable characters are emitted as entities inline instead of
// re-scanning each chunk through escapeHtml. Text holding no construct or
// escapable character at all is pushed as-is (the common case).
const INLINE_SPECIAL_RE = /[\\`*\[&<>"']/;
function inline(s, env, out) {
  if (!INLINE_SPECIAL_RE.test(s)) { out.push(s); return; }
  let i = 0, start = 0;
  const flush = (end) => { if (end > start) out.push(s.slice(start, end)); };
  while (i < s.length) {
    const c = s[i];
    if (c === '&' || c === '<' || c === '>' || c === '"' || c === "'") {
      flush(i);
      out.push(c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
      i++; start = i; continue;
    }
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) {
      flush(i); out.push(escapeHtml(s[i + 1])); i += 2; start = i; continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { flush(i); out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>'); i = j + 1; start = i; }
      else i++;
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) { flush(i); out.push('<strong>'); inline(s.slice(i + 2, j), env, out); out.push('</strong>'); i = j + 2; start = i; }
        else i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) { flush(i); out.push('<em>'); inline(s.slice(i + 1, j), env, out); out.push('</em>'); i = j + 1; start = i; }
      else i++;
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        flush(i); out.push('<a href="', escapeHtml(env.link(target)), '">');
        inline(s.slice(i + 1, k), env, out); out.push('</a>'); i = m + 1; start = i; continue;
      }
      i++; continue;
    }
    i++;
  }
  flush(s.length);
}
function inlineStr(s, env) {
  const out = [];
  inline(s, env, out);
  return out.join('');
}

function isWs(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 ||
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 ||
    c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}
// The words of a body's lines: runs of non-whitespace, exactly /\S+/g's
// count (a '\n' joins the lines, so no word spans two lines).
function wordsOfLines(lines) {
  let n = 0;
  for (let li = 0; li < lines.length; li++) {
    const text = lines[li];
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
      if (!isWs(text.charCodeAt(i))) { if (!inWord) { n++; inWord = true; } }
      else inWord = false;
    }
  }
  return n;
}

// Render a source body (lines array) -> { html, toc, excerpt }.
function renderMarkdown(lines, env) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const c0 = line.length === 0 ? -1 : line.charCodeAt(0);
    if (c0 === -1 || c0 === 32 || c0 === 9) {
      if (isBlank(line)) { i++; continue; }
      // A line of only spaces/tabs is blank; anything else starting with a
      // space or tab is a paragraph line (indented lines are not code).
    } else if (c0 === 96 && line.startsWith('```')) {
      const fence = FENCE_OPEN_RE.exec(line);
      if (fence !== null) {
        const body = [];
        i++;
        while (i < n && !FENCE_CLOSE_RE.test(lines[i])) body.push(lines[i++]);
        i++;
        const cls = fence[1] === '' ? '' : ' class="language-' + escapeHtml(fence[1]) + '"';
        let code = '';
        for (let k = 0; k < body.length; k++) code += escapeHtml(body[k]) + '\n';
        blocks.push('<pre><code' + cls + '>' + code + '</code></pre>');
        continue;
      }
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text), ids);
        const html = inlineStr(heading.text, env);
        blocks.push('<h' + heading.depth + ' id="' + id + '">' + html + '</h' + heading.depth + '>');
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (HR_RE.test(line)) { blocks.push('<hr>'); i++; continue; }
      const bullet = BULLET_RE.exec(line);
      if (bullet !== null) {
        const items = [];
        while (i < n) {
          const m = BULLET_RE.exec(lines[i]);
          if (m !== null) { items.push([trimLine(m[1])]); i++; }
          else if (isContinued(lines[i])) { items[items.length - 1].push(trimLine(lines[i])); i++; }
          else break;
        }
        let html = '<ul>\n';
        for (let k = 0; k < items.length; k++) html += '<li>' + inlineStr(items[k].join('\n'), env) + '</li>\n';
        blocks.push(html + '</ul>');
        continue;
      }
    } else if (c0 === 62) { // '>'
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i++];
        l = l.slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        body.push(l);
      }
      const kept = [];
      for (let k = 0; k < body.length; k++) { const t = trimLine(body[k]); if (t !== '') kept.push(t); }
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : '<blockquote>\n<p>' + inlineStr(kept.join('\n'), env) + '</p>\n</blockquote>');
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const ordered = ORDERED_RE.exec(line);
      if (ordered !== null) {
        const items = [];
        while (i < n) {
          const m = ORDERED_RE.exec(lines[i]);
          if (m !== null) { items.push([trimLine(m[2])]); i++; }
          else if (isContinued(lines[i])) { items[items.length - 1].push(trimLine(lines[i])); i++; }
          else break;
        }
        const open = Number(ordered[1]) !== 1 ? '<ol start="' + ordered[1] + '">' : '<ol>';
        let html = open + '\n';
        for (let k = 0; k < items.length; k++) html += '<li>' + inlineStr(items[k].join('\n'), env) + '</li>\n';
        blocks.push(html + '</ol>');
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inlineStr(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push('<p>' + html + '</p>');
  }
  let html = '';
  for (let k = 0; k < blocks.length; k++) html += blocks[k] + '\n';
  return { html, toc, excerpt: excerpt ?? '' };
}

// ---- templates ----
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;
const INCLUDE_DEPTH = 8;

class TemplateError extends Error {}
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError('template "' + name + '": ' + JSON.stringify(text) + ' is not a path');
  return text.split('.');
}
function tokenize(name, src) {
  const tokens = [];
  let text = '', i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) { text += src.slice(i); break; }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') { text += src.slice(i, open + 1); i = open + 1; continue; }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError('template "' + name + '": a ' + (raw ? '{{{' : '{{') + ' is not closed');
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError('template "' + name + '": a {% is not closed');
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node); stack.push(node); body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node); stack.push(node); body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError('template "' + name + '": an else outside an if');
        top.else = []; body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError('template "' + name + '": an ' + tag + ' with no open ' + tag.slice(3));
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError('template "' + name + '": {% ' + tag + ' %} is not a tag');
    }
  }
  if (stack.length > 1) throw new TemplateError('template "' + name + '": a ' + stack[stack.length - 1].kind + ' is not closed');
  return root.body;
}
function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let out = '';
    for (let i = 0; i < v.length; i++) { if (i) out += ', '; out += textOf(v[i]); }
    return out;
  }
  return '';
}
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}
function renderNodes(nodes, scope, ctx, depth, out) {
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    switch (n.kind) {
      case 'text': out.push(n.text); break;
      case 'var': out.push(escapeHtml(textOf(lookup(scope, n.path)))); break;
      case 'raw': out.push(textOf(lookup(scope, n.path))); break;
      case 'if': {
        const v = truthy(lookup(scope, n.path));
        const branch = v !== n.not ? n.then : n.else;
        if (branch !== null) renderNodes(branch, scope, ctx, depth, out);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        for (let k = 0; k < xs.length; k++) {
          const vars = { [n.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
          renderNodes(n.body, { vars, parent: scope }, ctx, depth, out);
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) renderNodes(t, scope, ctx, depth + 1, out);
        break;
      }
    }
  }
}

// ---- build ----
const RESERVED = ['posts', 'tags', 'page'];
function dirOf(path) { const i = path.lastIndexOf('/'); return i === -1 ? '' : path.slice(0, i); }

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0) return null; parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('/');
}

export function run(input) {
  // Templates, parsed in code-unit order of name.
  const templates = new Map();
  const report = [];
  const tNames = Object.keys(input.templates).sort();
  for (let i = 0; i < tNames.length; i++) {
    const name = tNames[i];
    try { templates.set(name, parseTemplate(name, input.templates[name])); }
    catch (err) { if (!(err instanceof TemplateError)) throw err; report.push(err.message); }
  }
  const base = input.site.base_url.replace(/\/+$/, '');

  // Sources, sorted by path in code-unit order.
  const files = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sources = [];
  const statics = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.path.endsWith('.md')) sources.push({ path: f.path, lines: f.content.indexOf('\r') === -1 ? f.content.split('\n') : f.content.replace(/\r\n?/g, '\n').split('\n') });
    else statics.push(f);
  }

  // Front matter + checks, in source order.
  const kept = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const fm = parseFrontMatter(s.lines);
    if ('error' in fm) { report.push('refused ' + s.path + ': ' + fm.error); continue; }
    s.data = fm.data; s.bodyLines = fm.bodyLines;
    s.post = s.path.startsWith('posts/');
    let own;
    if (!s.post) {
      if (s.path.startsWith('tags/')) own = 'tags';
      else if (s.path.startsWith('page/')) own = 'page';
    }
    if (own !== undefined) { report.push('refused ' + s.path + ': ' + own + '/ is the generator\'s own'); continue; }
    if (s.post && !Object.hasOwn(s.data, 'date')) { report.push('refused ' + s.path + ': a post needs a date'); continue; }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) { report.push('refused ' + s.path + ': layout "' + layout + '" is no template that parses'); continue; }
    s.layout = layout;
    if (s.data.draft === true) { report.push('draft ' + s.path); continue; }
    kept.push(s);
  }

  // Permalinks.
  const taken = new Map();
  const bySource = new Map();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) { set = new Set(dir === '' ? RESERVED : []); taken.set(dir, set); }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : dir + '/' + slug;
    s.url = base + '/' + s.outDir + '/';
    bySource.set(s.path, s);
  }

  // Markdown.
  const staticPaths = new Set();
  for (let i = 0; i < statics.length; i++) staticPaths.add(statics[i].path);
  const broken = new Set();
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return bySource.get(path).url + frag;
        if (path !== null && staticPaths.has(path)) return base + '/' + path + frag;
        broken.add('broken-link ' + s.path + ' -> ' + target);
        return target;
      },
    };
    const md = renderMarkdown(s.bodyLines, env);
    s.html = md.html; s.toc = md.toc; s.excerpt = md.excerpt;
    s.words = wordsOfLines(s.bodyLines);
  }

  // Collections.
  const posts = [];
  for (let i = 0; i < kept.length; i++) if (kept[i].post) posts.push(kept[i]);
  posts.sort((x, y) => (y.data.date < x.data.date ? -1 : y.data.date > x.data.date ? 1 : 0) || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // Tags.
  const bySlug = new Map();
  const ownTagNames = (s) => {
    const seen = new Set();
    const out = [];
    const tags = s.data.tags ?? [];
    for (let i = 0; i < tags.length; i++) {
      const name = tags[i], slug = slugify(name);
      if (!seen.has(slug)) { seen.add(slug); out.push({ name, slug }); }
    }
    return out;
  };
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    p.tagRefs = [];
    for (const { name, slug } of ownTagNames(p)) {
      let tag = bySlug.get(slug);
      if (tag === undefined) { tag = { name, slug, url: base + '/tags/' + slug + '/', posts: [] }; bySlug.set(slug, tag); }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    if (s.post) continue;
    s.tagRefs = ownTagNames(s).map(({ name, slug }) => bySlug.get(slug) ?? { name, slug, url: '', posts: [] });
  }
  const tags = [...bySlug.values()].sort((x, y) => (y.posts.length - x.posts.length) || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));

  // Cards (once per source) and pages.
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '', excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  for (let i = 0; i < kept.length; i++) kept[i].card = cardOf(kept[i]);
  const pageOf = (s) => ({
    ...s.card, slug: s.slug, content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null), older: linkOf(s.older ?? null), is_post: s.post,
  });

  // Layouts.
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => p.card);
  const baseScope = { vars: { site, tags: allTags, recent }, parent: null };
  const ctx = { templates, escape: escapeHtml };
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderNodes(nodes, { vars, parent: baseScope }, ctx, 0, out);
    return out.join('');
  };
  for (let i = 0; i < kept.length; i++) {
    const s = kept[i];
    output[s.outDir + '/index.html'] = render(s.layout, { page: pageOf(s) });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? base + '/' : base + '/page/' + k + '/');
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : 'page/' + k + '/index.html'] = html;
  }
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) } });
    if (html !== null) output['tags/' + t.slug + '/index.html'] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (let i = 0; i < statics.length; i++) {
    const f = statics[i];
    if (Object.hasOwn(output, f.path)) report.push('shadowed ' + f.path + ': a built page has its path');
    else output[f.path] = f.content;
  }

  // Report.
  const lines = [...report, ...broken].sort();
  let pageCount = 0;
  for (let i = 0; i < kept.length; i++) if (!kept[i].post) pageCount++;
  lines.push('built ' + pageCount + ' pages, ' + posts.length + ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
