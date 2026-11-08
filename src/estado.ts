// Estado global de la novela abierta, guardado diferido y aviso de cambios.

import { api } from "./api";
import { idiomaEscritura } from "./ajustes";
import {
  cargarNovela,
  contarPalabras,
  hoyClave,
  palabrasNovela,
  rutas,
  serializar,
  type Chat,
  type EntradaCodex,
  type Nota,
  type Novela,
  type Prompt,
  type SesionAgente,
} from "./modelo";
import { toast, errMsg } from "./ui";

export type Vista = "planificar" | "escribir" | "codex" | "chat" | "agente" | "notas" | "prompts" | "exportar";

export const estado = {
  novela: null as Novela | null,
  vista: "escribir" as Vista,
  escenaActual: "" as string,
  entradaActual: "" as string,
  chatActual: "" as string,
  notaActual: "" as string,
  sesionAgente: "" as string,
  guardando: 0,
  errorGuardado: "",
};

// ── Bus de eventos mínimo ────────────────────────────────────────────────

export type Cambio = "estructura" | "texto" | "codex" | "notas" | "prompts" | "chats" | "agente" | "meta" | "guardado" | "recarga" | "vista";
const oyentes = new Set<(c: Cambio, id?: string) => void>();

export function alCambiar(fn: (c: Cambio, id?: string) => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}
export function avisar(c: Cambio, id?: string): void {
  for (const fn of [...oyentes]) {
    try {
      fn(c, id);
    } catch (e) {
      console.error(e);
    }
  }
}

export function novela(): Novela {
  if (!estado.novela) throw new Error("No hay ninguna novela abierta");
  return estado.novela;
}

// ── Guardado diferido ────────────────────────────────────────────────────

const pendientes = new Map<string, { timer: number; fn: () => Promise<void> }>();

function programar(clave: string, fn: () => Promise<void>, ms: number): void {
  const prev = pendientes.get(clave);
  if (prev) window.clearTimeout(prev.timer);
  const timer = window.setTimeout(() => void ejecutar(clave), ms);
  pendientes.set(clave, { timer, fn });
  avisar("guardado");
}

async function ejecutar(clave: string): Promise<void> {
  const p = pendientes.get(clave);
  if (!p) return;
  pendientes.delete(clave);
  window.clearTimeout(p.timer);
  estado.guardando++;
  try {
    await p.fn();
    estado.errorGuardado = "";
  } catch (e) {
    estado.errorGuardado = errMsg(e);
    toast(`No se pudo guardar: ${errMsg(e)}`, "error");
  } finally {
    estado.guardando--;
    avisar("guardado");
  }
}

/** Escribe ya todo lo pendiente (antes de cerrar, exportar o lanzar el agente). */
export async function vaciarGuardado(): Promise<void> {
  await Promise.all([...pendientes.keys()].map((k) => ejecutar(k)));
}

export function hayPendientes(): boolean {
  return pendientes.size > 0 || estado.guardando > 0;
}

function escribir(ruta: string, contenido: () => string, ms = 400): void {
  const n = novela();
  programar(ruta, () => api.archivoEscribir(n.carpeta, ruta, contenido()), ms);
}

export function guardarMeta(cambio: Cambio = "estructura"): void {
  const n = novela();
  n.meta.modificado = Date.now();
  escribir(rutas.meta(), () => serializar.meta(n.meta), 350);
  avisar(cambio);
}

export function guardarTexto(id: string, texto: string): void {
  const n = novela();
  n.textos.set(id, texto);
  escribir(rutas.texto(id), () => n.textos.get(id) ?? "", 700);
  // Estadística diaria: total de palabras al final de hoy.
  const total = palabrasNovela(n);
  const hoy = hoyClave();
  if (n.meta.estadisticas[hoy] !== total) {
    n.meta.estadisticas[hoy] = total;
    n.meta.modificado = Date.now();
    escribir(rutas.meta(), () => serializar.meta(n.meta), 2000);
  }
  avisar("texto", id);
}

export function guardarCodex(e: EntradaCodex, aviso = true): void {
  const n = novela();
  n.codex.set(e.id, e);
  escribir(rutas.codex(e.id), () => serializar.codex(n.codex.get(e.id) ?? e));
  if (aviso) avisar("codex", e.id);
}

export async function borrarCodex(id: string): Promise<void> {
  const n = novela();
  n.codex.delete(id);
  for (const e of n.codex.values())
    if (e.relaciones.includes(id)) {
      e.relaciones = e.relaciones.filter((r) => r !== id);
      delete e.vinculos?.[id];
      guardarCodex(e, false);
    }
  for (const u of n.meta.actos.flatMap((a) => a.capitulos.flatMap((c) => c.escenas))) if (u.pov === id) u.pov = "";
  pendientes.delete(rutas.codex(id));
  await api.archivoBorrar(n.carpeta, rutas.codex(id));
  guardarMeta("codex");
}

export function guardarNota(nota: Nota, aviso = true): void {
  const n = novela();
  nota.modificado = Date.now();
  n.notas.set(nota.id, nota);
  escribir(rutas.nota(nota.id), () => serializar.nota(n.notas.get(nota.id) ?? nota));
  if (aviso) avisar("notas", nota.id);
}

export async function borrarNota(id: string): Promise<void> {
  const n = novela();
  n.notas.delete(id);
  pendientes.delete(rutas.nota(id));
  await api.archivoBorrar(n.carpeta, rutas.nota(id));
  avisar("notas");
}

export function guardarPrompt(p: Prompt, aviso = true): void {
  const n = novela();
  n.prompts.set(p.id, p);
  escribir(rutas.prompt(p.id), () => serializar.prompt(n.prompts.get(p.id) ?? p));
  if (aviso) avisar("prompts", p.id);
}

export async function borrarPrompt(id: string): Promise<void> {
  const n = novela();
  n.prompts.delete(id);
  pendientes.delete(rutas.prompt(id));
  await api.archivoBorrar(n.carpeta, rutas.prompt(id));
  avisar("prompts");
}

export function guardarChat(c: Chat, aviso = true): void {
  const n = novela();
  c.modificado = Date.now();
  n.chats.set(c.id, c);
  escribir(rutas.chat(c.id), () => serializar.json(n.chats.get(c.id) ?? c), 500);
  if (aviso) avisar("chats", c.id);
}

export async function borrarChat(id: string): Promise<void> {
  const n = novela();
  n.chats.delete(id);
  pendientes.delete(rutas.chat(id));
  await api.archivoBorrar(n.carpeta, rutas.chat(id));
  avisar("chats");
}

export function guardarSesionAgente(s: SesionAgente, aviso = true): void {
  const n = novela();
  s.modificado = Date.now();
  n.agente.set(s.id, s);
  escribir(rutas.agente(s.id), () => serializar.json(n.agente.get(s.id) ?? s), 500);
  if (aviso) avisar("agente", s.id);
}

export async function borrarSesionAgente(id: string): Promise<void> {
  const n = novela();
  n.agente.delete(id);
  pendientes.delete(rutas.agente(id));
  await api.archivoBorrar(n.carpeta, rutas.agente(id));
  avisar("agente");
}

export async function borrarTexto(id: string): Promise<void> {
  const n = novela();
  n.textos.delete(id);
  pendientes.delete(rutas.texto(id));
  await api.archivoBorrar(n.carpeta, rutas.texto(id));
}

// ── Historial de escenas ─────────────────────────────────────────────────

export async function instantanea(id: string, motivo = "manual"): Promise<void> {
  const n = novela();
  const texto = n.textos.get(id) ?? "";
  if (!texto.trim()) return;
  const ruta = `historial/${id}/${Date.now()}-${motivo}.md`;
  await api.archivoEscribir(n.carpeta, ruta, texto);
}

export async function listarInstantaneas(id: string): Promise<{ ruta: string; fecha: number; motivo: string }[]> {
  const n = novela();
  const archivos = await api.archivoListar(n.carpeta, `historial/${id}`);
  return archivos
    .map((ruta) => {
      const nombre = ruta.replace(/^.*\//, "").replace(/\.md$/, "");
      const [fecha, ...resto] = nombre.split("-");
      return { ruta, fecha: Number(fecha), motivo: resto.join("-") || "manual" };
    })
    .filter((x) => Number.isFinite(x.fecha))
    .sort((a, b) => b.fecha - a.fecha);
}

// ── Abrir, recargar ──────────────────────────────────────────────────────

export async function abrirNovela(carpeta: string): Promise<void> {
  await vaciarGuardado();
  const n = await cargarNovela(carpeta);
  estado.novela = n;
  const primera = n.meta.actos[0]?.capitulos[0]?.escenas[0];
  estado.escenaActual = primera?.id ?? "";
  estado.entradaActual = "";
  estado.chatActual = "";
  estado.notaActual = "";
  estado.sesionAgente = "";
  localStorage.setItem("ultima-novela", carpeta);
  // Línea base de estadísticas: lo ya escrito no cuenta como «hoy».
  if (!Object.keys(n.meta.estadisticas).length) {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    n.meta.estadisticas[hoyClave(ayer)] = palabrasNovela(n);
    n.meta.estadisticas[hoyClave()] = palabrasNovela(n);
    escribir(rutas.meta(), () => serializar.meta(n.meta), 500);
  }
  await asegurarGuiaAgente(n);
}

/**
 * Recarga desde disco (tras los cambios del agente o de otro editor) sin
 * perder lo que aún no se ha guardado: primero vacía lo pendiente.
 */
export async function recargarDesdeDisco(): Promise<void> {
  if (!estado.novela) return;
  await vaciarGuardado();
  const n = await cargarNovela(estado.novela.carpeta);
  estado.novela = n;
  const existe = (id: string) => n.meta.actos.some((a) => a.capitulos.some((c) => c.escenas.some((e) => e.id === id)));
  if (!existe(estado.escenaActual)) estado.escenaActual = n.meta.actos[0]?.capitulos[0]?.escenas[0]?.id ?? "";
  avisar("recarga");
}

export function cerrarNovela(): void {
  estado.novela = null;
  localStorage.removeItem("ultima-novela");
}

// ── Guía para el agente (CLAUDE.md) ──────────────────────────────────────

const MARCA_GUIA = "<!-- open-novel:guia v1 -->";

export function guiaAgente(n: Novela): string {
  return `${MARCA_GUIA}
# ${n.meta.titulo} — proyecto de Open Novel

Esta carpeta es una novela gestionada por **Open Novel**. La aplicación vuelve a
leer los archivos cuando terminas de editarlos, así que respeta este formato.
Puedes borrar la marca de la primera línea si quieres que la app no regenere este archivo.

## Archivos

- \`novela.json\` — metadatos y **estructura**: \`actos[] → capitulos[] → escenas[]\`.
  Cada escena: \`{ id, titulo, resumen, estado: "idea"|"borrador"|"revision"|"final", pov: <id del codex o "">, etiquetas: [], objetivo: <palabras> }\`.
  Para crear una escena añade un objeto con un \`id\` nuevo y único (p. ej. \`e\` + 10 caracteres alfanuméricos) y crea \`escenas/<id>.md\`.
  Conserva el resto de campos (\`estadisticas\`, \`promptsActivos\`, \`estilo\`…) tal cual. Debe seguir siendo JSON válido.
- \`escenas/<id>.md\` — la prosa de cada escena, en Markdown ligero (párrafos separados por línea en blanco, *cursiva*, **negrita**). Sin título: el título vive en \`novela.json\`.
- \`codex/<id>.md\` — entradas del Codex con frontmatter YAML:
  \`nombre\`, \`tipo\` (personaje | lugar | objeto | lore | subtrama | otro), \`alias\` (lista), \`etiquetas\` (lista),
  \`incluir\` (siempre | menciones | nunca: cuándo entra en el contexto de la IA), \`detectar\` (bool),
  \`campos\` (mapa clave → valor), \`relaciones\` (ids de otras entradas; recíprocas: añádela también en la otra entrada), \`vinculos\` (mapa id → tipo de relación, p. ej. «hermana de», «vive en»), \`progresiones\` (lista de \`{escena: <id>, texto}\`).
  El cuerpo, después del frontmatter, es la descripción.
- \`notas/<id>.md\` — notas libres (frontmatter: \`titulo\`, \`fijada\`).
- \`prompts/<id>.md\` — prompts personalizados (frontmatter: \`nombre\`, \`accion\`, \`descripcion\`, \`sistema\`; cuerpo = plantilla con \`{{variables}}\`).
- \`chats/\`, \`agente/\`, \`historial/\` — uso interno de la app; no los edites.

## Novela

- Título: ${n.meta.titulo}${n.meta.subtitulo ? ` — ${n.meta.subtitulo}` : ""}
- Autor: ${n.meta.autor || "—"}
- Género: ${n.meta.genero || "—"}
- Idioma de la prosa: ${idiomaEscritura(n.meta.idioma)}
${n.meta.sinopsis ? `\n### Sinopsis\n\n${n.meta.sinopsis}\n` : ""}${n.meta.narrador ? `- Narrador: ${n.meta.narrador}\n` : ""}${n.meta.estilo ? `\n### Guía de estilo\n\n${n.meta.estilo}\n` : ""}${n.meta.muestraVoz ? `\n### Muestra de voz (imita su ritmo y registro, no su contenido)\n\n${n.meta.muestraVoz}\n` : ""}${n.meta.decisiones ? `\n### Estado de la novela y decisiones tomadas (respétalas)\n\n${n.meta.decisiones}\n` : ""}
## Reglas

1. Escribe la prosa en el idioma de la novela y respeta la guía de estilo.
2. Antes de reescribir una escena existente, léela entera. No borres texto del autor salvo que se te pida.
3. Mantén coherencia con el Codex: consulta \`codex/\` antes de inventar datos de personajes o lugares. Si las fuentes se contradicen manda este orden: Codex, esquema y resúmenes, texto de la escena, petición del usuario. Señala las contradicciones en vez de corregirlas en silencio.
4. Cuando crees personajes, lugares u objetos nuevos importantes, añade su entrada en \`codex/\`.
5. Actualiza el \`resumen\` de una escena en \`novela.json\` cuando cambies su contenido de forma sustancial.
`;
}

async function asegurarGuiaAgente(n: Novela): Promise<void> {
  try {
    const actual = await api.archivoLeer(n.carpeta, "CLAUDE.md");
    if (actual === null || actual.startsWith(MARCA_GUIA)) {
      const nueva = guiaAgente(n);
      if (nueva !== actual) await api.archivoEscribir(n.carpeta, "CLAUDE.md", nueva);
    }
  } catch (e) {
    console.warn("No se pudo escribir CLAUDE.md", e);
  }
}

export function actualizarGuiaAgente(): void {
  if (estado.novela) void asegurarGuiaAgente(estado.novela);
}

// ── Utilidades derivadas ─────────────────────────────────────────────────

export function palabrasEscena(id: string): number {
  return contarPalabras(estado.novela?.textos.get(id) ?? "");
}
