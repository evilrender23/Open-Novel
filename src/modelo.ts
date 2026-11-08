// Modelo de una novela y su persistencia en disco.
//
// Estructura de la carpeta de una novela:
//   novela.json            metadatos + estructura (actos → capítulos → escenas)
//   escenas/<id>.md        prosa de cada escena
//   codex/<id>.md          entradas del Codex (frontmatter YAML + descripción)
//   notas/<id>.md          notas (frontmatter YAML + cuerpo)
//   prompts/<id>.md        prompts personalizados (frontmatter + plantilla)
//   chats/<id>.json        conversaciones con la IA
//   agente/<id>.json       sesiones del modo agente (Claude Code)
//   historial/<escena>/…   instantáneas de escenas (no se cargan al abrir)
//   CLAUDE.md              guía para el agente

import YAML from "yaml";

import { api, nuevoId } from "./api";

export type EstadoEscena = "idea" | "borrador" | "revision" | "final";
export const ESTADOS: { valor: EstadoEscena; texto: string }[] = [
  { valor: "idea", texto: "Idea" },
  { valor: "borrador", texto: "Borrador" },
  { valor: "revision", texto: "Revisión" },
  { valor: "final", texto: "Final" },
];

export interface Escena {
  id: string;
  titulo: string;
  resumen: string;
  estado: EstadoEscena;
  pov: string; // id de entrada del Codex o ""
  etiquetas: string[];
  objetivo: number; // palabras objetivo (0 = sin objetivo)
}
export interface Capitulo {
  id: string;
  titulo: string;
  escenas: Escena[];
}
export interface Acto {
  id: string;
  titulo: string;
  capitulos: Capitulo[];
}

export interface MetaNovela {
  formato: 1;
  id: string;
  titulo: string;
  subtitulo: string;
  autor: string;
  serie: string;
  genero: string;
  idioma: string;
  sinopsis: string;
  estilo: string; // guía de estilo / instrucciones permanentes para la IA
  objetivoPalabras: number;
  creado: number;
  modificado: number;
  actos: Acto[];
  estadisticas: Record<string, number>; // AAAA-MM-DD → palabras totales al cierre
  promptsActivos: Partial<Record<AccionPrompt, string>>;
}

export type TipoCodex = "personaje" | "lugar" | "objeto" | "lore" | "subtrama" | "otro";
export const TIPOS_CODEX: { valor: TipoCodex; texto: string; plural: string; icono: "user" | "place" | "item" | "lore" | "thread" | "tag" }[] = [
  { valor: "personaje", texto: "Personaje", plural: "Personajes", icono: "user" },
  { valor: "lugar", texto: "Lugar", plural: "Lugares", icono: "place" },
  { valor: "objeto", texto: "Objeto", plural: "Objetos", icono: "item" },
  { valor: "lore", texto: "Lore", plural: "Lore", icono: "lore" },
  { valor: "subtrama", texto: "Subtrama", plural: "Subtramas", icono: "thread" },
  { valor: "otro", texto: "Otro", plural: "Otros", icono: "tag" },
];

export type InclusionContexto = "siempre" | "menciones" | "nunca";

export interface EntradaCodex {
  id: string;
  nombre: string;
  tipo: TipoCodex;
  alias: string[];
  etiquetas: string[];
  color: string;
  incluir: InclusionContexto;
  detectar: boolean;
  campos: { clave: string; valor: string }[];
  relaciones: string[];
  progresiones: { escena: string; texto: string }[];
  descripcion: string;
  creado: number;
}

export interface Nota {
  id: string;
  titulo: string;
  fijada: boolean;
  cuerpo: string;
  modificado: number;
}

export type AccionPrompt =
  | "beat"
  | "continuar"
  | "reescribir"
  | "expandir"
  | "acortar"
  | "describir"
  | "resumir"
  | "codex"
  | "chat"
  | "general";

export interface Prompt {
  id: string;
  nombre: string;
  accion: AccionPrompt;
  descripcion: string;
  modelo: string; // "" = el predeterminado de la función
  sistema: string;
  usuario: string;
  integrado?: boolean;
}

export interface MensajeChat {
  id: string;
  rol: "usuario" | "asistente";
  texto: string;
  modelo?: string;
  fecha: number;
  error?: boolean;
}
export interface Chat {
  id: string;
  titulo: string;
  modelo: string;
  contexto: { esquema: boolean; codex: "fijadas" | "todas" | "ninguna"; escena: boolean; capitulo: boolean; notas: boolean };
  mensajes: MensajeChat[];
  creado: number;
  modificado: number;
}

export type ElementoAgente =
  | { tipo: "usuario"; texto: string; fecha: number }
  | { tipo: "texto"; texto: string }
  | { tipo: "pensamiento"; texto: string }
  | { tipo: "herramienta"; id: string; nombre: string; entrada: unknown; resultado?: string; error?: boolean }
  | { tipo: "fin"; costo: number; duracion: number; turnos: number; error: boolean; texto?: string }
  | { tipo: "error"; texto: string }
  | { tipo: "info"; texto: string };

export interface SesionAgente {
  id: string;
  titulo: string;
  sesionClaude: string; // session_id para --resume
  modelo: string;
  permisos: string;
  elementos: ElementoAgente[];
  creado: number;
  modificado: number;
}

export interface Novela {
  carpeta: string;
  ruta: string;
  meta: MetaNovela;
  textos: Map<string, string>;
  codex: Map<string, EntradaCodex>;
  notas: Map<string, Nota>;
  prompts: Map<string, Prompt>;
  chats: Map<string, Chat>;
  agente: Map<string, SesionAgente>;
}

// ── Construcción ─────────────────────────────────────────────────────────

export function escenaNueva(titulo = "Escena nueva"): Escena {
  return { id: nuevoId("e"), titulo, resumen: "", estado: "idea", pov: "", etiquetas: [], objetivo: 0 };
}
export function capituloNuevo(titulo = "Capítulo nuevo"): Capitulo {
  return { id: nuevoId("c"), titulo, escenas: [escenaNueva("Escena 1")] };
}
export function actoNuevo(titulo = "Acto nuevo"): Acto {
  return { id: nuevoId("a"), titulo, capitulos: [capituloNuevo("Capítulo 1")] };
}

export function metaNueva(titulo: string, autor = ""): MetaNovela {
  const ahora = Date.now();
  return {
    formato: 1,
    id: nuevoId("n"),
    titulo,
    subtitulo: "",
    autor,
    serie: "",
    genero: "",
    idioma: "español",
    sinopsis: "",
    estilo: "",
    objetivoPalabras: 80000,
    creado: ahora,
    modificado: ahora,
    actos: [actoNuevo("Acto I")],
    estadisticas: {},
    promptsActivos: {},
  };
}

/** Completa campos ausentes (archivos editados a mano o por el agente). */
export function normalizarMeta(m: Partial<MetaNovela>): MetaNovela {
  const base = metaNueva(m.titulo || "Sin título");
  const meta: MetaNovela = { ...base, ...m, formato: 1 } as MetaNovela;
  meta.actos = (m.actos ?? base.actos).map((a) => ({
    id: a.id || nuevoId("a"),
    titulo: a.titulo ?? "Acto",
    capitulos: (a.capitulos ?? []).map((c) => ({
      id: c.id || nuevoId("c"),
      titulo: c.titulo ?? "Capítulo",
      escenas: (c.escenas ?? []).map((e) => ({ ...escenaNueva(), ...e, id: e.id || nuevoId("e"), etiquetas: e.etiquetas ?? [] })),
    })),
  }));
  meta.estadisticas = m.estadisticas ?? {};
  meta.promptsActivos = m.promptsActivos ?? {};
  return meta;
}

export function entradaNueva(nombre: string, tipo: TipoCodex): EntradaCodex {
  return {
    id: nuevoId("x"),
    nombre,
    tipo,
    alias: [],
    etiquetas: [],
    color: "",
    incluir: "menciones",
    detectar: true,
    campos: [],
    relaciones: [],
    progresiones: [],
    descripcion: "",
    creado: Date.now(),
  };
}

// ── Frontmatter ──────────────────────────────────────────────────────────

export function separarFrontmatter(texto: string): { datos: Record<string, any>; cuerpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(texto);
  if (!m) return { datos: {}, cuerpo: texto };
  let datos: Record<string, any> = {};
  try {
    datos = (YAML.parse(m[1]) as Record<string, any>) ?? {};
  } catch {
    datos = {};
  }
  return { datos, cuerpo: texto.slice(m[0].length) };
}

export function unirFrontmatter(datos: Record<string, unknown>, cuerpo: string): string {
  return `---\n${YAML.stringify(datos, { lineWidth: 0 }).trimEnd()}\n---\n\n${cuerpo.trim()}\n`;
}

function parsearCodex(id: string, texto: string): EntradaCodex {
  const { datos, cuerpo } = separarFrontmatter(texto);
  const e = entradaNueva(String(datos.nombre ?? id), (datos.tipo as TipoCodex) ?? "otro");
  e.id = id;
  e.alias = Array.isArray(datos.alias) ? datos.alias.map(String) : [];
  e.etiquetas = Array.isArray(datos.etiquetas) ? datos.etiquetas.map(String) : [];
  e.color = String(datos.color ?? "");
  e.incluir = (["siempre", "menciones", "nunca"].includes(datos.incluir) ? datos.incluir : "menciones") as InclusionContexto;
  e.detectar = datos.detectar !== false;
  e.campos = datos.campos && typeof datos.campos === "object"
    ? Object.entries(datos.campos as Record<string, unknown>).map(([clave, valor]) => ({ clave, valor: String(valor ?? "") }))
    : [];
  e.relaciones = Array.isArray(datos.relaciones) ? datos.relaciones.map(String) : [];
  e.progresiones = Array.isArray(datos.progresiones)
    ? datos.progresiones.map((p: any) => ({ escena: String(p?.escena ?? ""), texto: String(p?.texto ?? "") }))
    : [];
  e.creado = Number(datos.creado ?? Date.now());
  if (!TIPOS_CODEX.some((t) => t.valor === e.tipo)) e.tipo = "otro";
  e.descripcion = cuerpo.trim();
  return e;
}

function serializarCodex(e: EntradaCodex): string {
  const campos: Record<string, string> = {};
  for (const c of e.campos) if (c.clave.trim()) campos[c.clave.trim()] = c.valor;
  return unirFrontmatter(
    {
      nombre: e.nombre,
      tipo: e.tipo,
      alias: e.alias,
      etiquetas: e.etiquetas,
      color: e.color || undefined,
      incluir: e.incluir,
      detectar: e.detectar,
      campos,
      relaciones: e.relaciones,
      progresiones: e.progresiones,
      creado: e.creado,
    },
    e.descripcion,
  );
}

function parsearNota(id: string, texto: string): Nota {
  const { datos, cuerpo } = separarFrontmatter(texto);
  return {
    id,
    titulo: String(datos.titulo ?? "Nota"),
    fijada: !!datos.fijada,
    cuerpo: cuerpo.trim(),
    modificado: Number(datos.modificado ?? Date.now()),
  };
}

function parsearPrompt(id: string, texto: string): Prompt {
  const { datos, cuerpo } = separarFrontmatter(texto);
  // La plantilla del usuario va en el cuerpo; el sistema en el frontmatter.
  return {
    id,
    nombre: String(datos.nombre ?? id),
    accion: (datos.accion as AccionPrompt) ?? "general",
    descripcion: String(datos.descripcion ?? ""),
    modelo: String(datos.modelo ?? ""),
    sistema: String(datos.sistema ?? ""),
    usuario: cuerpo.trim(),
  };
}

// ── Carga y guardado ─────────────────────────────────────────────────────

const base = (ruta: string) => ruta.replace(/^.*\//, "").replace(/\.(md|json)$/, "");

export async function cargarNovela(carpeta: string): Promise<Novela> {
  const [archivos, ruta] = await Promise.all([api.novelaLeer(carpeta), api.novelaRuta(carpeta)]);
  return construirNovela(carpeta, ruta, archivos);
}

export function construirNovela(carpeta: string, ruta: string, archivos: Record<string, string>): Novela {
  let meta: MetaNovela;
  try {
    meta = normalizarMeta(JSON.parse(archivos["novela.json"] ?? "{}"));
  } catch (e) {
    throw new Error(`novela.json no es JSON válido: ${e instanceof Error ? e.message : e}`);
  }
  const n: Novela = {
    carpeta,
    ruta,
    meta,
    textos: new Map(),
    codex: new Map(),
    notas: new Map(),
    prompts: new Map(),
    chats: new Map(),
    agente: new Map(),
  };
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const id = base(ruta);
    try {
      if (ruta.startsWith("escenas/") && ruta.endsWith(".md")) n.textos.set(id, contenido.replace(/\r\n/g, "\n"));
      else if (ruta.startsWith("codex/") && ruta.endsWith(".md")) n.codex.set(id, parsearCodex(id, contenido));
      else if (ruta.startsWith("notas/") && ruta.endsWith(".md")) n.notas.set(id, parsearNota(id, contenido));
      else if (ruta.startsWith("prompts/") && ruta.endsWith(".md")) n.prompts.set(id, parsearPrompt(id, contenido));
      else if (ruta.startsWith("chats/") && ruta.endsWith(".json")) n.chats.set(id, JSON.parse(contenido) as Chat);
      else if (ruta.startsWith("agente/") && ruta.endsWith(".json")) n.agente.set(id, JSON.parse(contenido) as SesionAgente);
    } catch (e) {
      console.warn("Archivo ignorado", ruta, e);
    }
  }
  return n;
}

export const rutas = {
  meta: () => "novela.json",
  texto: (id: string) => `escenas/${id}.md`,
  codex: (id: string) => `codex/${id}.md`,
  nota: (id: string) => `notas/${id}.md`,
  prompt: (id: string) => `prompts/${id}.md`,
  chat: (id: string) => `chats/${id}.json`,
  agente: (id: string) => `agente/${id}.json`,
};

export const serializar = {
  meta: (m: MetaNovela) => JSON.stringify(m, null, 2) + "\n",
  codex: serializarCodex,
  nota: (nota: Nota) => unirFrontmatter({ titulo: nota.titulo, fijada: nota.fijada, modificado: nota.modificado }, nota.cuerpo),
  prompt: (p: Prompt) =>
    unirFrontmatter({ nombre: p.nombre, accion: p.accion, descripcion: p.descripcion, modelo: p.modelo || undefined, sistema: p.sistema }, p.usuario),
  json: (o: unknown) => JSON.stringify(o, null, 2) + "\n",
};

// ── Recorridos y estadísticas ────────────────────────────────────────────

export interface UbicacionEscena {
  escena: Escena;
  capitulo: Capitulo;
  acto: Acto;
  indice: number; // posición global
  numCapitulo: number; // número global del capítulo (1..)
}

export function todasLasEscenas(meta: MetaNovela): UbicacionEscena[] {
  const out: UbicacionEscena[] = [];
  let numCap = 0;
  for (const acto of meta.actos)
    for (const capitulo of acto.capitulos) {
      numCap++;
      for (const escena of capitulo.escenas) out.push({ escena, capitulo, acto, indice: out.length, numCapitulo: numCap });
    }
  return out;
}

export function buscarEscena(meta: MetaNovela, id: string): UbicacionEscena | undefined {
  return todasLasEscenas(meta).find((u) => u.escena.id === id);
}

export function todosLosCapitulos(meta: MetaNovela): { capitulo: Capitulo; acto: Acto; num: number }[] {
  const out: { capitulo: Capitulo; acto: Acto; num: number }[] = [];
  for (const acto of meta.actos) for (const capitulo of acto.capitulos) out.push({ capitulo, acto, num: out.length + 1 });
  return out;
}

const RE_PALABRA = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

export function contarPalabras(texto: string): number {
  if (!texto) return 0;
  return texto.match(RE_PALABRA)?.length ?? 0;
}

export function palabrasNovela(n: Novela): number {
  let total = 0;
  for (const u of todasLasEscenas(n.meta)) total += contarPalabras(n.textos.get(u.escena.id) ?? "");
  return total;
}

export function hoyClave(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Palabras escritas hoy = total actual − total al cierre del último día anterior. */
export function palabrasHoy(n: Novela, total: number): number {
  const hoy = hoyClave();
  const anteriores = Object.keys(n.meta.estadisticas).filter((k) => k < hoy).sort();
  const ayer = anteriores.length ? n.meta.estadisticas[anteriores[anteriores.length - 1]] : 0;
  return Math.max(0, total - ayer);
}

/** Quita marcas Markdown ligeras para contar o exportar en texto plano. */
export function textoPlano(md: string): string {
  return md
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1");
}
