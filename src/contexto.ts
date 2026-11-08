// Contexto para la IA: detección de menciones del Codex, plantillas de prompts
// con {{variables}} y prompts integrados (como los de NovelCrafter).

import { ajustes, idiomaEscritura } from "./ajustes";
import {
  buscarEscena,
  todasLasEscenas,
  TIPOS_CODEX,
  type AccionPrompt,
  type EntradaCodex,
  type Novela,
  type Prompt,
} from "./modelo";

// ── Detección de menciones ───────────────────────────────────────────────

export interface Mencion {
  inicio: number;
  fin: number;
  entrada: EntradaCodex;
}

let cacheClave = "";
let cacheRe: RegExp | null = null;
let cacheMapa = new Map<string, EntradaCodex>();

function escaparRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Expresión con todos los nombres y alias (más largos primero), sin distinguir mayúsculas. */
function expresion(n: Novela): { re: RegExp | null; mapa: Map<string, EntradaCodex> } {
  const entradas = [...n.codex.values()].filter((e) => e.detectar);
  const clave = entradas.map((e) => `${e.id}:${e.nombre}|${e.alias.join("|")}`).join(";");
  if (clave === cacheClave) return { re: cacheRe, mapa: cacheMapa };
  const mapa = new Map<string, EntradaCodex>();
  for (const e of entradas)
    for (const t of [e.nombre, ...e.alias]) {
      const k = t.trim().toLocaleLowerCase();
      if (k.length >= 2 && !mapa.has(k)) mapa.set(k, e);
    }
  const terminos = [...mapa.keys()].sort((a, b) => b.length - a.length).map(escaparRe);
  cacheRe = terminos.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${terminos.join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
  cacheMapa = mapa;
  cacheClave = clave;
  return { re: cacheRe, mapa };
}

export function menciones(n: Novela, texto: string): Mencion[] {
  const { re, mapa } = expresion(n);
  if (!re || !texto) return [];
  const out: Mencion[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    const e = mapa.get(m[0].toLocaleLowerCase());
    if (e) out.push({ inicio: m.index, fin: m.index + m[0].length, entrada: e });
  }
  return out;
}

/** Entradas mencionadas (únicas) en uno o varios textos, con su número de apariciones. */
export function entradasMencionadas(n: Novela, ...textos: string[]): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const t of textos) for (const m of menciones(n, t)) cuenta.set(m.entrada.id, (cuenta.get(m.entrada.id) ?? 0) + 1);
  return cuenta;
}

/** Escenas en las que aparece una entrada (por menciones o como punto de vista). */
export function escenasConEntrada(n: Novela, id: string): { escenaId: string; veces: number; pov: boolean }[] {
  const out: { escenaId: string; veces: number; pov: boolean }[] = [];
  for (const u of todasLasEscenas(n.meta)) {
    const texto = `${u.escena.resumen}\n${n.textos.get(u.escena.id) ?? ""}`;
    const veces = menciones(n, texto).filter((m) => m.entrada.id === id).length;
    const pov = u.escena.pov === id;
    if (veces || pov) out.push({ escenaId: u.escena.id, veces, pov });
  }
  return out;
}

// ── Formateo de contexto ─────────────────────────────────────────────────

export function formatearEntrada(n: Novela, e: EntradaCodex, hastaEscena?: string): string {
  const tipo = TIPOS_CODEX.find((t) => t.valor === e.tipo)?.texto ?? e.tipo;
  const lineas = [`## ${e.nombre} (${tipo})`];
  if (e.alias.length) lineas.push(`Alias: ${e.alias.join(", ")}`);
  for (const c of e.campos) if (c.clave && c.valor) lineas.push(`${c.clave}: ${c.valor}`);
  if (e.descripcion.trim()) lineas.push(e.descripcion.trim());
  // Progresiones: solo las de escenas anteriores o igual a la actual.
  if (e.progresiones.length) {
    const orden = new Map(todasLasEscenas(n.meta).map((u) => [u.escena.id, u.indice]));
    const limite = hastaEscena ? (orden.get(hastaEscena) ?? Infinity) : Infinity;
    const prog = e.progresiones
      .filter((p) => (orden.get(p.escena) ?? Infinity) <= limite && p.texto.trim())
      .sort((a, b) => (orden.get(a.escena) ?? 0) - (orden.get(b.escena) ?? 0));
    if (prog.length) lineas.push("Evolución hasta este punto:\n" + prog.map((p) => `- ${p.texto.trim()}`).join("\n"));
  }
  const rel = e.relaciones
    .map((r) => {
      const x = n.codex.get(r);
      if (!x) return "";
      const v = e.vinculos?.[r]?.trim();
      return v ? `${x.nombre} (${v})` : x.nombre;
    })
    .filter(Boolean);
  if (rel.length) lineas.push(`Relacionado con: ${rel.join(", ")}`);
  return lineas.join("\n");
}

/**
 * Contexto para desarrollar una entrada del Codex: sus relaciones (en los dos
 * sentidos, con la ficha completa) y cómo aparece en la novela (escenas donde se
 * la menciona o es punto de vista, con su resumen y los párrafos donde sale).
 */
export function contextoDesarrollo(n: Novela, e: EntradaCodex, maxPalabras = 3000): { relacionadas: string; apariciones: string } {
  const ids = new Set(e.relaciones);
  for (const x of n.codex.values()) if (x.id !== e.id && x.relaciones.includes(e.id)) ids.add(x.id);
  const relacionadas = [...ids]
    .map((id) => n.codex.get(id))
    .filter((x): x is EntradaCodex => !!x)
    .map((x) => {
      // Escenas que comparten con la entrada: la relación vista en el texto.
      const juntas = escenasConEntrada(n, x.id).filter((a) => escenasConEntrada(n, e.id).some((b) => b.escenaId === a.escenaId)).length;
      const vinculo = [e.vinculos?.[x.id] ? `${e.nombre} es ${e.vinculos[x.id]} ${x.nombre}` : "", x.vinculos?.[e.id] ? `${x.nombre} es ${x.vinculos[e.id]} ${e.nombre}` : ""].filter(Boolean).join("; ");
      return formatearEntrada(n, x) + (vinculo ? `\nVínculo: ${vinculo}.` : "") + (juntas ? `\nCoinciden en ${juntas} escena${juntas === 1 ? "" : "s"}.` : "");
    })
    .join("\n\n");

  const bloques: string[] = [];
  let palabras = 0;
  const escenas = new Map(todasLasEscenas(n.meta).map((u) => [u.escena.id, u]));
  const nombresRel = new Set([...ids].flatMap((id) => {
    const x = n.codex.get(id);
    return x ? [x.id] : [];
  }));
  for (const a of escenasConEntrada(n, e.id)) {
    const u = escenas.get(a.escenaId);
    if (!u) continue;
    const texto = n.textos.get(u.escena.id) ?? "";
    const parrafos = texto.split(/\n\s*\n/).filter((p) => menciones(n, p).some((m) => m.entrada.id === e.id));
    // Primero los párrafos donde coincide con alguna entrada relacionada.
    parrafos.sort((p, q) => Number(menciones(n, q).some((m) => nombresRel.has(m.entrada.id))) - Number(menciones(n, p).some((m) => nombresRel.has(m.entrada.id))));
    const lineas = [`### Cap. ${u.numCapitulo} «${u.capitulo.titulo}» · ${u.escena.titulo}${a.pov ? " (es el punto de vista)" : ""}`];
    if (u.escena.resumen.trim()) lineas.push(`Resumen: ${u.escena.resumen.trim()}`);
    for (const p of parrafos.slice(0, 3)) {
      const t = p.trim();
      const w = t.split(/\s+/).length;
      if (palabras + w > maxPalabras) break;
      palabras += w;
      lineas.push(`> ${t.replace(/\n/g, " ")}`);
    }
    bloques.push(lineas.join("\n"));
    if (palabras >= maxPalabras) {
      bloques.push("(hay más apariciones; se omiten por longitud)");
      break;
    }
  }
  return { relacionadas, apariciones: bloques.join("\n\n") };
}

/** Contexto del Codex: entradas "siempre" + las mencionadas en los textos dados. */
export function contextoCodex(n: Novela, textos: string[], modo: "auto" | "todas" | "fijadas" = "auto", hastaEscena?: string): string {
  const ids = new Set<string>();
  for (const e of n.codex.values()) if (e.incluir === "siempre" || modo === "todas") ids.add(e.id);
  if (modo === "auto") {
    for (const id of entradasMencionadas(n, ...textos).keys()) if (n.codex.get(id)?.incluir !== "nunca") ids.add(id);
    // Relaciones directas de las entradas incluidas por mención.
    for (const id of [...ids]) for (const r of n.codex.get(id)?.relaciones ?? []) if (n.codex.get(r)?.incluir === "siempre") ids.add(r);
  }
  if (modo === "todas") for (const e of n.codex.values()) if (e.incluir === "nunca") ids.delete(e.id);
  const entradas = [...ids].map((id) => n.codex.get(id)).filter((e): e is EntradaCodex => !!e);
  entradas.sort((a, b) => TIPOS_CODEX.findIndex((t) => t.valor === a.tipo) - TIPOS_CODEX.findIndex((t) => t.valor === b.tipo));
  return entradas.map((e) => formatearEntrada(n, e, hastaEscena)).join("\n\n");
}

export function esquema(n: Novela, conTexto = false): string {
  const out: string[] = [];
  let numCap = 0;
  for (const a of n.meta.actos) {
    out.push(`# ${a.titulo}`);
    for (const c of a.capitulos) {
      numCap++;
      out.push(`## Capítulo ${numCap}: ${c.titulo}`);
      for (const e of c.escenas) {
        out.push(`### ${e.titulo}${e.pov && n.codex.get(e.pov) ? ` (PDV: ${n.codex.get(e.pov)!.nombre})` : ""}`);
        if (e.resumen.trim()) out.push(e.resumen.trim());
        if (conTexto && n.textos.get(e.id)?.trim()) out.push(n.textos.get(e.id)!.trim());
      }
    }
  }
  return out.join("\n\n");
}

/** Resúmenes de las escenas previas a `escenaId` ("la historia hasta ahora"). */
export function historiaPrevia(n: Novela, escenaId: string, max = 40): string {
  const todas = todasLasEscenas(n.meta);
  const i = todas.findIndex((u) => u.escena.id === escenaId);
  if (i <= 0) return "";
  return todas
    .slice(Math.max(0, i - max), i)
    .map((u) => `- [Cap. ${u.numCapitulo} · ${u.escena.titulo}] ${u.escena.resumen.trim() || "(sin resumen)"}`)
    .join("\n");
}

export function ultimasPalabras(texto: string, n: number): string {
  const palabras = texto.split(/(\s+)/);
  let cuenta = 0;
  let i = palabras.length;
  while (i > 0 && cuenta < n) {
    i--;
    if (palabras[i].trim()) cuenta++;
  }
  return (i > 0 ? "…" : "") + palabras.slice(i).join("");
}

export function primerasPalabras(texto: string, n: number): string {
  const palabras = texto.split(/(\s+)/);
  let cuenta = 0;
  let i = 0;
  while (i < palabras.length && cuenta < n) {
    if (palabras[i].trim()) cuenta++;
    i++;
  }
  return palabras.slice(0, i).join("") + (i < palabras.length ? "…" : "");
}

// ── Plantillas ───────────────────────────────────────────────────────────

export type Variables = Record<string, string>;

export const VARIABLES_DOC: { nombre: string; desc: string }[] = [
  { nombre: "novela.titulo", desc: "Título de la novela" },
  { nombre: "novela.genero", desc: "Género" },
  { nombre: "novela.sinopsis", desc: "Sinopsis" },
  { nombre: "novela.estilo", desc: "Guía de estilo de la novela" },
  { nombre: "idioma", desc: "Idioma de la prosa" },
  { nombre: "novela.narrador", desc: "Persona y tiempo del narrador" },
  { nombre: "novela.muestra_voz", desc: "Muestra de la voz de la novela" },
  { nombre: "novela.decisiones", desc: "Estado de la novela y decisiones tomadas" },
  { nombre: "entrada.relacionadas", desc: "Codex: fichas de las entradas relacionadas" },
  { nombre: "entrada.apariciones", desc: "Codex: escenas y párrafos donde aparece la entrada" },
  { nombre: "codex", desc: "Entradas del Codex relevantes (siempre + mencionadas)" },
  { nombre: "esquema", desc: "Esquema completo con resúmenes" },
  { nombre: "historia_previa", desc: "Resúmenes de las escenas anteriores" },
  { nombre: "capitulo.titulo", desc: "Título del capítulo actual" },
  { nombre: "escena.titulo", desc: "Título de la escena" },
  { nombre: "escena.resumen", desc: "Resumen de la escena" },
  { nombre: "escena.pov", desc: "Personaje de punto de vista" },
  { nombre: "escena.texto", desc: "Texto completo de la escena" },
  { nombre: "texto_previo", desc: "Últimas palabras antes del cursor" },
  { nombre: "texto_posterior", desc: "Texto después del cursor" },
  { nombre: "beat", desc: "Beat de escena escrito por ti" },
  { nombre: "seleccion", desc: "Texto seleccionado" },
  { nombre: "instrucciones", desc: "Instrucciones adicionales" },
  { nombre: "palabras", desc: "Longitud objetivo aproximada" },
  { nombre: "entrada.nombre", desc: "(Codex) nombre de la entrada" },
  { nombre: "entrada.tipo", desc: "(Codex) tipo de la entrada" },
  { nombre: "entrada.descripcion", desc: "(Codex) descripción actual" },
];

/**
 * Sustituye `{{variable}}` y resuelve bloques `{{#si variable}}…{{/si}}`
 * (se omiten si la variable está vacía).
 */
export function renderizar(plantilla: string, vars: Variables): string {
  let out = plantilla.replace(/\{\{#si\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/si\}\}/g, (_m, v: string, cuerpo: string) =>
    (vars[v] ?? "").trim() ? cuerpo : "",
  );
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, v: string) => vars[v] ?? "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function variablesBase(n: Novela, escenaId?: string): Variables {
  const v: Variables = {
    "novela.titulo": n.meta.titulo,
    "novela.genero": n.meta.genero,
    "novela.sinopsis": n.meta.sinopsis,
    "novela.estilo": n.meta.estilo,
    idioma: idiomaEscritura(n.meta.idioma),
    "novela.narrador": n.meta.narrador ?? "",
    "novela.muestra_voz": n.meta.muestraVoz ?? "",
    "novela.decisiones": n.meta.decisiones ?? "",
  };
  const u = escenaId ? buscarEscena(n.meta, escenaId) : undefined;
  if (u) {
    const texto = n.textos.get(u.escena.id) ?? "";
    v["capitulo.titulo"] = `Capítulo ${u.numCapitulo}: ${u.capitulo.titulo}`;
    v["escena.titulo"] = u.escena.titulo;
    v["escena.resumen"] = u.escena.resumen;
    v["escena.pov"] = n.codex.get(u.escena.pov)?.nombre ?? "";
    v["escena.texto"] = texto;
    v.historia_previa = historiaPrevia(n, u.escena.id);
  }
  return v;
}

/** Completa `codex` según los textos relevantes de la petición. */
export function conCodex(n: Novela, v: Variables, escenaId?: string): Variables {
  const relevantes = [v.beat, v.seleccion, v.texto_previo, v["escena.resumen"], v.instrucciones, v["escena.pov"]].filter(Boolean) as string[];
  return { ...v, codex: contextoCodex(n, relevantes, "auto", escenaId) };
}

// ── Bloque maestro ───────────────────────────────────────────────────────
// Se añade al prompt de sistema de TODO lo que genera la IA (también a los
// prompts personalizados): jerarquía de fuentes, voz de la novela, estado y un
// protocolo según el tipo de tarea.

export type TipoTarea = "prosa" | "chat" | "codex" | "resumen";

export type ModoChat = "auto" | "critica" | "redaccion" | "ideacion" | "consulta";
export const MODOS_CHAT: { valor: ModoChat; texto: string; desc: string }[] = [
  { valor: "auto", texto: "Auto", desc: "La IA elige el modo según tu mensaje" },
  { valor: "critica", texto: "Crítica", desc: "Diagnóstico editorial, sin reescribir" },
  { valor: "redaccion", texto: "Redacción", desc: "Texto narrativo listo para la novela" },
  { valor: "ideacion", texto: "Ideación", desc: "Opciones breves y numeradas" },
  { valor: "consulta", texto: "Consulta", desc: "Respuestas sobre la novela o el oficio" },
];

export function bloqueMaestro(n: Novela, tarea: TipoTarea, plantillaSistema = ""): string {
  const m = n.meta;
  const partes: string[] = [];
  partes.push(`<fuentes_y_prioridad>
Si las fuentes se contradicen, manda este orden: 1) el Codex, 2) el esquema y los resúmenes de escena, 3) el texto de la escena actual, 4) lo que se pida en el mensaje.
Antes de escribir u opinar, repasa el Codex que tengas en el contexto. Si algo del texto o de la petición contradice el Codex, señálalo; no lo corrijas en silencio.
Si el Codex, el esquema o la escena vienen vacíos o no están en el contexto, no supongas lo que dirían.
</fuentes_y_prioridad>`);

  const voz: string[] = [];
  if (m.narrador?.trim()) voz.push(`Narrador: ${m.narrador.trim()}.`);
  // La guía de estilo ya va en los prompts que la citan; si no, se añade aquí.
  if (m.estilo?.trim() && !plantillaSistema.includes("novela.estilo")) voz.push(m.estilo.trim());
  if (m.muestraVoz?.trim()) voz.push(`Muestra de la voz de la novela (imita su ritmo, registro y tipo de imágenes; no copies sus frases ni su contenido):\n«${m.muestraVoz.trim()}»`);
  if (voz.length && tarea !== "resumen") partes.push(`<voz>\n${voz.join("\n")}\n</voz>`);
  if (m.decisiones?.trim()) partes.push(`<estado_de_la_novela>\nDecisiones tomadas y hechos fijados por el autor (respétalos):\n${m.decisiones.trim()}\n</estado_de_la_novela>`);

  if (tarea === "prosa")
    partes.push(`<protocolo>
- Entrega solo el texto narrativo, sin preámbulo, títulos ni comentarios.
- Muestra la emoción con gestos, acciones y objetos; no la nombres ni la expliques. Cierra con un gesto o una imagen, no con un resumen.
- Diálogo específico de cada personaje según el Codex, nunca genérico.
- Respeta la longitud pedida.
- Única excepción al «solo texto»: si cumplir la petición obliga a contradecir el Codex o el esquema, escribe coherente con ellos y añade al final, en una línea aparte, «AVISO: » y la contradicción en una frase.
</protocolo>`);
  else if (tarea === "chat")
    partes.push(`<protocolo>
- Una tarea por respuesta. No reescribas si se pidió criticar; no critiques si se pidió escribir.
- Pregunta solo si sin ese dato arriesgas contradecir el Codex. En lo demás, asume lo razonable y dilo en una línea.
- En CRÍTICA y CONSULTA, empieza citando en una línea los datos del Codex en los que te basas (o di que no hay).
- En REDACCIÓN, entrega solo el texto narrativo; los avisos de contradicción, al final. Si no se pide longitud, 300-400 palabras.
- En IDEACIÓN, entre 3 y 7 opciones numeradas de una o dos frases, sin desarrollarlas.
</protocolo>
<formato_critica>
**Lo que funciona** (máximo 3 puntos) · **Lo que falla** (ordenado por gravedad) · **Un cambio concreto para cada fallo**.
</formato_critica>`);
  else if (tarea === "codex")
    partes.push(`<protocolo>
- Lo que añadas debe encajar con lo que ya ocurre en las escenas y con las entradas relacionadas. No cierres lo que la novela deja abierto.
- Si la descripción actual contradice el texto, sigue el texto y señálalo al final en una línea que empiece por «AVISO: ».
</protocolo>`);
  return partes.join("\n\n");
}

/** Instrucción para el modo elegido en el chat (vacía en «Auto»). */
export function instruccionModo(modo: ModoChat | undefined): string {
  if (!modo || modo === "auto") return "";
  const nombre = { critica: "CRÍTICA", redaccion: "REDACCIÓN", ideacion: "IDEACIÓN", consulta: "CONSULTA" }[modo];
  return `Modo de esta respuesta: ${nombre}. Responde solo en este modo.`;
}

/** Separa las líneas «AVISO: …» del final de un texto generado. */
export function separarAvisos(t: string): { texto: string; avisos: string[] } {
  const avisos: string[] = [];
  const lineas = t.trimEnd().split("\n");
  while (lineas.length) {
    const l = lineas[lineas.length - 1].trim();
    const m = /^(?:\*\*)?(?:⚠️\s*)?AVISO:?(?:\*\*)?\s*(.+)$/i.exec(l);
    if (m) {
      avisos.unshift(m[1].replace(/\*\*$/, "").trim());
      lineas.pop();
    } else if (!l && avisos.length) lineas.pop();
    else break;
  }
  return { texto: lineas.join("\n").trim(), avisos };
}

// ── Prompts integrados ───────────────────────────────────────────────────

const SISTEMA_PROSA = `Eres un coescritor de ficción experto que escribe en {{idioma}}.
Escribes prosa de novela publicable: concreta, sensorial, con diálogos naturales y ritmo variado.
Respeta la voz, el tiempo verbal y el punto de vista del texto existente{{#si novela.narrador}} (narrador: {{novela.narrador}}){{/si}}. No resumas: dramatiza.
Devuelve SOLO la prosa, sin títulos, comentarios, comillas envolventes ni notas.
{{#si novela.estilo}}
Guía de estilo del autor:
{{novela.estilo}}
{{/si}}`;

const BLOQUE_CONTEXTO = `{{#si codex}}
<codex>
{{codex}}
</codex>
{{/si}}
{{#si historia_previa}}
<historia_hasta_ahora>
{{historia_previa}}
</historia_hasta_ahora>
{{/si}}
<escena_actual titulo="{{escena.titulo}}"{{#si escena.pov}} pdv="{{escena.pov}}"{{/si}}>
{{#si escena.resumen}}Resumen previsto: {{escena.resumen}}{{/si}}
</escena_actual>`;

export const PROMPTS_INTEGRADOS: Prompt[] = [
  {
    id: "int-beat",
    integrado: true,
    nombre: "Beat de escena → prosa",
    accion: "beat",
    descripcion: "Convierte un beat (lo que ocurre) en prosa que continúa el texto.",
    modelo: "",
    sistema: SISTEMA_PROSA,
    usuario: `${BLOQUE_CONTEXTO}

{{#si texto_previo}}
<texto_previo>
{{texto_previo}}
</texto_previo>
{{/si}}

Escribe aproximadamente {{palabras}} palabras que continúen el texto previo de forma fluida y desarrollen este beat:

<beat>
{{beat}}
</beat>

{{#si instrucciones}}Instrucciones adicionales: {{instrucciones}}{{/si}}`,
  },
  {
    id: "int-continuar",
    integrado: true,
    nombre: "Continuar escribiendo",
    accion: "continuar",
    descripcion: "Sigue escribiendo desde el cursor siguiendo el resumen de la escena.",
    modelo: "",
    sistema: SISTEMA_PROSA,
    usuario: `${BLOQUE_CONTEXTO}

<texto_previo>
{{texto_previo}}
</texto_previo>

Continúa la escena exactamente desde donde termina el texto previo, unas {{palabras}} palabras, avanzando hacia lo que describe el resumen. No repitas lo ya escrito.
{{#si instrucciones}}Instrucciones adicionales: {{instrucciones}}{{/si}}`,
  },
  {
    id: "int-reescribir",
    integrado: true,
    nombre: "Reescribir",
    accion: "reescribir",
    descripcion: "Reescribe la selección mejorando la prosa y manteniendo el contenido.",
    modelo: "",
    sistema: SISTEMA_PROSA,
    usuario: `{{#si codex}}<codex>
{{codex}}
</codex>{{/si}}

{{#si texto_previo}}<contexto_anterior>
{{texto_previo}}
</contexto_anterior>{{/si}}

Reescribe el siguiente fragmento manteniendo lo que ocurre, la voz y el punto de vista, pero con una prosa más viva y precisa.
{{#si instrucciones}}Indicaciones: {{instrucciones}}{{/si}}

<fragmento>
{{seleccion}}
</fragmento>`,
  },
  {
    id: "int-expandir",
    integrado: true,
    nombre: "Expandir",
    accion: "expandir",
    descripcion: "Amplía la selección con más detalle, sensaciones y diálogo.",
    modelo: "",
    sistema: SISTEMA_PROSA,
    usuario: `{{#si codex}}<codex>
{{codex}}
</codex>{{/si}}

Amplía el siguiente fragmento hasta aproximadamente el doble de extensión: añade detalle sensorial, pensamientos del personaje de punto de vista y ritmo, sin cambiar los hechos.
{{#si instrucciones}}Indicaciones: {{instrucciones}}{{/si}}

<fragmento>
{{seleccion}}
</fragmento>`,
  },
  {
    id: "int-acortar",
    integrado: true,
    nombre: "Acortar",
    accion: "acortar",
    descripcion: "Condensa la selección sin perder lo esencial.",
    modelo: "",
    sistema: SISTEMA_PROSA,
    usuario: `Condensa el siguiente fragmento a aproximadamente la mitad, conservando los hechos, el tono y las mejores frases.
{{#si instrucciones}}Indicaciones: {{instrucciones}}{{/si}}

<fragmento>
{{seleccion}}
</fragmento>`,
  },
  {
    id: "int-describir",
    integrado: true,
    nombre: "Mostrar, no contar",
    accion: "describir",
    descripcion: "Convierte afirmaciones en escenas con detalles concretos.",
    modelo: "",
    sistema: SISTEMA_PROSA,
    usuario: `{{#si codex}}<codex>
{{codex}}
</codex>{{/si}}

Reescribe el fragmento aplicando "mostrar, no contar": sustituye emociones y juicios explícitos por acciones, gestos, diálogo y detalles concretos.
{{#si instrucciones}}Indicaciones: {{instrucciones}}{{/si}}

<fragmento>
{{seleccion}}
</fragmento>`,
  },
  {
    id: "int-resumir",
    integrado: true,
    nombre: "Resumir escena",
    accion: "resumir",
    descripcion: "Genera el resumen de una escena a partir de su texto.",
    modelo: "",
    sistema: "Eres un editor de desarrollo. Escribes en {{idioma}} resúmenes de escena claros y concretos. Devuelve solo el resumen.",
    usuario: `Resume en 2-4 frases lo que ocurre en esta escena: quién participa, qué quiere, qué cambia y cómo termina. Usa nombres propios.

<escena titulo="{{escena.titulo}}">
{{escena.texto}}
</escena>`,
  },
  {
    id: "int-codex",
    integrado: true,
    nombre: "Desarrollar entrada del Codex",
    accion: "codex",
    descripcion: "Amplía la descripción de una entrada del Codex coherente con la novela.",
    modelo: "",
    sistema: `Eres un asistente de construcción de mundos para novelistas. Escribes en {{idioma}}. Devuelve solo la descripción, en prosa breve y útil para escribir (aspecto, rasgos, historia, voz, secretos), sin títulos.
Antes de escribir, revisa las entradas relacionadas y cómo aparece la entrada en las escenas: deduce de ahí su papel, su forma de hablar y actuar y sus vínculos. Todo lo que añadas debe ser coherente con lo que ya pasa en el texto (no contradigas hechos, edades, lugares ni relaciones), aprovechar lo que el texto sugiere y no cerrar lo que la novela aún deja abierto.`,
    usuario: `Novela: {{novela.titulo}}{{#si novela.genero}} ({{novela.genero}}){{/si}}
{{#si novela.sinopsis}}Sinopsis: {{novela.sinopsis}}{{/si}}

{{#si entrada.relacionadas}}<relacionadas>
{{entrada.relacionadas}}
</relacionadas>{{/si}}

{{#si entrada.apariciones}}<apariciones_en_la_novela>
{{entrada.apariciones}}
</apariciones_en_la_novela>{{/si}}

{{#si codex}}Otras entradas del Codex:
{{codex}}{{/si}}

Desarrolla la entrada «{{entrada.nombre}}» ({{entrada.tipo}}) a partir de su contexto en la novela. Descripción actual:
{{entrada.descripcion}}

{{#si instrucciones}}Indicaciones: {{instrucciones}}{{/si}}`,
  },
  {
    id: "int-chat",
    integrado: true,
    nombre: "Chat de la novela",
    accion: "chat",
    descripcion: "Prompt de sistema del chat con contexto de la novela.",
    modelo: "",
    sistema: `<rol>
Eres coeditor y colaborador de la novela «{{novela.titulo}}». Respondes en {{idioma}}, de forma concreta.
Cada petición cae en uno de estos modos; si no está claro cuál, pregúntalo en una línea antes de nada:
- CRÍTICA: diagnóstico editorial, sin reescribir.
- REDACCIÓN: texto narrativo de calidad publicable.
- IDEACIÓN: opciones breves, numeradas, sin desarrollar.
- CONSULTA: respuesta técnica sobre la novela o el oficio.
</rol>
{{#si novela.estilo}}Guía de estilo del autor:
{{novela.estilo}}{{/si}}`,
    usuario: "{{contexto}}",
  },
];

export function todosLosPrompts(n: Novela): Prompt[] {
  return [...PROMPTS_INTEGRADOS, ...[...n.prompts.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))];
}

export function promptActivo(n: Novela, accion: AccionPrompt): Prompt {
  const id = n.meta.promptsActivos[accion];
  return (id && (n.prompts.get(id) ?? PROMPTS_INTEGRADOS.find((p) => p.id === id))) || PROMPTS_INTEGRADOS.find((p) => p.accion === accion)!;
}

export function palabrasObjetivo(): string {
  return String(Math.max(100, Math.round(ajustes.maxTokens * 0.35 / 50) * 50));
}
