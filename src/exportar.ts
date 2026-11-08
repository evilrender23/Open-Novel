// Exportación del manuscrito: Markdown, texto, HTML, EPUB 3 y copia completa.

import { escaparXml, prosaXhtml } from "./markdown";
import { serializar, textoPlano, type Novela } from "./modelo";

export interface OpcionesExportar {
  titulosActos: boolean;
  titulosCapitulos: boolean;
  titulosEscenas: boolean;
  separador: string;
  soloFinal: boolean;
}

export const OPCIONES_DEFECTO: OpcionesExportar = {
  titulosActos: false,
  titulosCapitulos: true,
  titulosEscenas: false,
  separador: "* * *",
  soloFinal: false,
};

interface CapExport {
  acto: string;
  primeroDelActo: boolean;
  numero: number;
  titulo: string;
  escenas: { titulo: string; texto: string }[];
}

function capitulos(n: Novela, o: OpcionesExportar): CapExport[] {
  const out: CapExport[] = [];
  let num = 0;
  for (const a of n.meta.actos) {
    let primero = true;
    for (const c of a.capitulos) {
      num++;
      const escenas = c.escenas
        .filter((e) => !o.soloFinal || e.estado === "final")
        .map((e) => ({ titulo: e.titulo, texto: (n.textos.get(e.id) ?? "").trim() }))
        .filter((e) => e.texto);
      if (!escenas.length) continue;
      out.push({ acto: a.titulo, primeroDelActo: primero, numero: num, titulo: c.titulo, escenas });
      primero = false;
    }
  }
  return out;
}

function tituloCapitulo(c: CapExport): string {
  return c.titulo.trim() ? `Capítulo ${c.numero}: ${c.titulo}` : `Capítulo ${c.numero}`;
}

export function aMarkdown(n: Novela, o: OpcionesExportar): string {
  const partes: string[] = [`# ${n.meta.titulo}`];
  if (n.meta.subtitulo) partes.push(`*${n.meta.subtitulo}*`);
  if (n.meta.autor) partes.push(n.meta.autor);
  for (const c of capitulos(n, o)) {
    if (o.titulosActos && c.primeroDelActo) partes.push(`# ${c.acto}`);
    if (o.titulosCapitulos) partes.push(`## ${tituloCapitulo(c)}`);
    c.escenas.forEach((e, i) => {
      if (i > 0 && o.separador && !o.titulosEscenas) partes.push(o.separador);
      if (o.titulosEscenas) partes.push(`### ${e.titulo}`);
      partes.push(e.texto);
    });
  }
  return partes.join("\n\n") + "\n";
}

export function aTexto(n: Novela, o: OpcionesExportar): string {
  return textoPlano(aMarkdown(n, o));
}

export function aHtml(n: Novela, o: OpcionesExportar): string {
  const cuerpo: string[] = [];
  for (const c of capitulos(n, o)) {
    if (o.titulosActos && c.primeroDelActo) cuerpo.push(`<h1 class="acto">${escaparXml(c.acto)}</h1>`);
    if (o.titulosCapitulos) cuerpo.push(`<h2>${escaparXml(tituloCapitulo(c))}</h2>`);
    c.escenas.forEach((e, i) => {
      if (i > 0 && o.separador && !o.titulosEscenas) cuerpo.push(`<p class="sep">${escaparXml(o.separador)}</p>`);
      if (o.titulosEscenas) cuerpo.push(`<h3>${escaparXml(e.titulo)}</h3>`);
      cuerpo.push(prosaXhtml(e.texto));
    });
  }
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escaparXml(n.meta.titulo)}</title>
<style>
body{font-family:"Iowan Old Style","Charter",Georgia,serif;max-width:36em;margin:4em auto;padding:0 1.5em;line-height:1.65;font-size:12pt;color:#1f2328}
h1,h2{font-weight:600;text-align:center;margin:3em 0 1.5em;page-break-before:always}
.portada h1{page-break-before:avoid;font-size:2.4em;margin-top:30vh}
.portada p{text-align:center}
p{margin:0;text-indent:1.5em;text-align:justify}
h2+p,h3+p,.sep+p,hr+p{text-indent:0}
.sep{text-align:center;text-indent:0;margin:1.5em 0}
@media print{body{margin:0}}
</style></head><body>
<section class="portada"><h1>${escaparXml(n.meta.titulo)}</h1>${n.meta.subtitulo ? `<p><em>${escaparXml(n.meta.subtitulo)}</em></p>` : ""}${n.meta.autor ? `<p>${escaparXml(n.meta.autor)}</p>` : ""}</section>
${cuerpo.join("\n")}
</body></html>
`;
}

// ── ZIP (sin compresión) para EPUB ───────────────────────────────────────

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(archivos: { nombre: string; datos: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let desplazamiento = 0;
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre);
    const datos = enc.encode(a.datos);
    const crc = crc32(datos);
    const local = new Uint8Array(30 + nombre.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8
    dv.setUint16(8, 0, true); // sin compresión
    dv.setUint32(14, crc, true);
    dv.setUint32(18, datos.length, true);
    dv.setUint32(22, datos.length, true);
    dv.setUint16(26, nombre.length, true);
    local.set(nombre, 30);
    locales.push(local, datos);
    const central = new Uint8Array(46 + nombre.length);
    const dc = new DataView(central.buffer);
    dc.setUint32(0, 0x02014b50, true);
    dc.setUint16(4, 20, true);
    dc.setUint16(6, 20, true);
    dc.setUint16(8, 0x0800, true);
    dc.setUint32(16, crc, true);
    dc.setUint32(20, datos.length, true);
    dc.setUint32(24, datos.length, true);
    dc.setUint16(28, nombre.length, true);
    dc.setUint32(42, desplazamiento, true);
    central.set(nombre, 46);
    centrales.push(central);
    desplazamiento += local.length + datos.length;
  }
  const tamCentral = centrales.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const df = new DataView(fin.buffer);
  df.setUint32(0, 0x06054b50, true);
  df.setUint16(8, archivos.length, true);
  df.setUint16(10, archivos.length, true);
  df.setUint32(12, tamCentral, true);
  df.setUint32(16, desplazamiento, true);
  const total = new Uint8Array(desplazamiento + tamCentral + 22);
  let p = 0;
  for (const parte of [...locales, ...centrales, fin]) {
    total.set(parte, p);
    p += parte.length;
  }
  return total;
}

export function aEpub(n: Novela, o: OpcionesExportar): Uint8Array {
  const caps = capitulos(n, o);
  const uid = `urn:uuid:${n.meta.id}`;
  const xhtml = (titulo: string, cuerpo: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es" xml:lang="es">
<head><meta charset="utf-8"/><title>${escaparXml(titulo)}</title><link rel="stylesheet" href="estilo.css"/></head>
<body>${cuerpo}</body></html>`;
  const archivos: { nombre: string; datos: string }[] = [
    { nombre: "mimetype", datos: "application/epub+zip" },
    {
      nombre: "META-INF/container.xml",
      datos: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/libro.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    },
    {
      nombre: "OEBPS/estilo.css",
      datos: `body{font-family:serif;line-height:1.5}h1,h2{text-align:center;margin:2em 0 1em}p{margin:0;text-indent:1.5em}h2+p,h3+p,.sep+p{text-indent:0}.sep{text-align:center;text-indent:0;margin:1em 0}.portada{text-align:center;margin-top:30%}`,
    },
    {
      nombre: "OEBPS/portada.xhtml",
      datos: xhtml(
        n.meta.titulo,
        `<section class="portada"><h1>${escaparXml(n.meta.titulo)}</h1>${n.meta.subtitulo ? `<p><em>${escaparXml(n.meta.subtitulo)}</em></p>` : ""}${n.meta.autor ? `<p>${escaparXml(n.meta.autor)}</p>` : ""}</section>`,
      ),
    },
  ];
  caps.forEach((c, i) => {
    const partes: string[] = [];
    if (o.titulosActos && c.primeroDelActo) partes.push(`<h1>${escaparXml(c.acto)}</h1>`);
    partes.push(`<h2>${escaparXml(tituloCapitulo(c))}</h2>`);
    c.escenas.forEach((e, k) => {
      if (k > 0 && o.separador && !o.titulosEscenas) partes.push(`<p class="sep">${escaparXml(o.separador)}</p>`);
      if (o.titulosEscenas) partes.push(`<h3>${escaparXml(e.titulo)}</h3>`);
      partes.push(prosaXhtml(e.texto));
    });
    archivos.push({ nombre: `OEBPS/cap${i + 1}.xhtml`, datos: xhtml(tituloCapitulo(c), partes.join("\n")) });
  });
  archivos.push({
    nombre: "OEBPS/indice.xhtml",
    datos: xhtml(
      "Índice",
      `<nav epub:type="toc" id="toc"><h1>Índice</h1><ol>${caps
        .map((c, i) => `<li><a href="cap${i + 1}.xhtml">${escaparXml(tituloCapitulo(c))}</a></li>`)
        .join("")}</ol></nav>`,
    ),
  });
  const fecha = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  archivos.push({
    nombre: "OEBPS/libro.opf",
    datos: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="es">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier>
<dc:title>${escaparXml(n.meta.titulo)}</dc:title>
<dc:creator>${escaparXml(n.meta.autor || "Anónimo")}</dc:creator>
<dc:language>es</dc:language>
<meta property="dcterms:modified">${fecha}</meta>
</metadata>
<manifest>
<item id="indice" href="indice.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="estilo.css" media-type="text/css"/>
<item id="portada" href="portada.xhtml" media-type="application/xhtml+xml"/>
${caps.map((_, i) => `<item id="cap${i + 1}" href="cap${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine>
<itemref idref="portada"/>
${caps.map((_, i) => `<itemref idref="cap${i + 1}"/>`).join("\n")}
</spine>
</package>`,
  });
  return zip(archivos);
}

/** Copia completa (todos los archivos de la novela) en un único JSON. */
export function aCopia(n: Novela): string {
  const archivos: Record<string, string> = { "novela.json": serializar.meta(n.meta) };
  for (const [id, t] of n.textos) archivos[`escenas/${id}.md`] = t;
  for (const e of n.codex.values()) archivos[`codex/${e.id}.md`] = serializar.codex(e);
  for (const x of n.notas.values()) archivos[`notas/${x.id}.md`] = serializar.nota(x);
  for (const p of n.prompts.values()) archivos[`prompts/${p.id}.md`] = serializar.prompt(p);
  for (const c of n.chats.values()) archivos[`chats/${c.id}.json`] = serializar.json(c);
  return JSON.stringify({ openNovel: 1, exportado: Date.now(), archivos }, null, 1);
}
