// Markdown mínimo → DOM (sin innerHTML): títulos, párrafos, listas, citas,
// bloques de código, separadores, **negrita**, *cursiva* y `código`.

import { h } from "./ui";

export function inline(texto: string): Node[] {
  const out: Node[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`)/g;
  let ultimo = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (m.index > ultimo) out.push(document.createTextNode(texto.slice(ultimo, m.index)));
    if (m[2] ?? m[3]) out.push(h("strong", null, ...inline(m[2] ?? m[3])));
    else if (m[4] ?? m[5]) out.push(h("em", null, ...inline(m[4] ?? m[5])));
    else if (m[6]) out.push(h("code", null, m[6]));
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) out.push(document.createTextNode(texto.slice(ultimo)));
  return out;
}

export function markdown(texto: string, cls = "md"): HTMLElement {
  const raiz = h("div", { class: cls });
  const lineas = texto.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(l)) {
      const buf: string[] = [];
      i++;
      while (i < lineas.length && !/^```/.test(lineas[i])) buf.push(lineas[i++]);
      i++;
      raiz.append(h("pre", null, h("code", null, buf.join("\n"))));
      continue;
    }
    const t = /^(#{1,6})\s+(.*)$/.exec(l);
    if (t) {
      const nivel = Math.min(6, t[1].length + 1) as 2 | 3 | 4 | 5 | 6;
      raiz.append(h(`h${nivel}`, null, ...inline(t[2])));
      i++;
      continue;
    }
    if (/^(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(l.trim())) {
      raiz.append(h("hr"));
      i++;
      continue;
    }
    if (/^>\s?/.test(l)) {
      const buf: string[] = [];
      while (i < lineas.length && /^>\s?/.test(lineas[i])) buf.push(lineas[i++].replace(/^>\s?/, ""));
      raiz.append(h("blockquote", null, markdown(buf.join("\n"), "")));
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordenada = /^\s*\d+[.)]/.test(l);
      const lista = h(ordenada ? "ol" : "ul");
      while (i < lineas.length && /^\s*([-*+]|\d+[.)])\s+/.test(lineas[i])) {
        lista.append(h("li", null, ...inline(lineas[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""))));
        i++;
      }
      raiz.append(lista);
      continue;
    }
    const buf: string[] = [];
    while (i < lineas.length && lineas[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+)/.test(lineas[i])) buf.push(lineas[i++]);
    const p = h("p");
    buf.forEach((b, k) => {
      if (k) p.append(h("br"));
      p.append(...inline(b));
    });
    raiz.append(p);
  }
  return raiz;
}

/** Escapa texto para XML/HTML de exportación (no se inserta en el DOM). */
export function escaparXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Markdown ligero de prosa → XHTML (para EPUB/HTML exportados). */
export function prosaXhtml(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((bloque) => bloque.trim())
    .filter(Boolean)
    .map((bloque) => {
      if (/^(\*\s*\*\s*\*|-{3,})$/.test(bloque)) return `<hr/>`;
      const t = /^(#{1,6})\s+(.*)$/.exec(bloque);
      const conInline = (s: string) =>
        escaparXml(s)
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>")
          .replace(/\n/g, "<br/>");
      if (t) return `<h${Math.min(6, t[1].length + 2)}>${conInline(t[2])}</h${Math.min(6, t[1].length + 2)}>`;
      return `<p>${conInline(bloque)}</p>`;
    })
    .join("\n");
}
