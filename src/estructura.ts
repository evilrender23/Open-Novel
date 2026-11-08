// Operaciones sobre la estructura actos → capítulos → escenas.

import { borrarTexto, estado, guardarMeta, guardarTexto, novela } from "./estado";
import { actoNuevo, capituloNuevo, escenaNueva, todosLosCapitulos, type Acto, type Capitulo, type Escena } from "./modelo";
import { confirmar, pedirTexto } from "./ui";

export function ubicarCapitulo(id: string): { acto: Acto; capitulo: Capitulo; i: number } | undefined {
  for (const acto of novela().meta.actos) {
    const i = acto.capitulos.findIndex((c) => c.id === id);
    if (i >= 0) return { acto, capitulo: acto.capitulos[i], i };
  }
}

export function ubicarEscena(id: string): { capitulo: Capitulo; escena: Escena; i: number } | undefined {
  for (const a of novela().meta.actos)
    for (const capitulo of a.capitulos) {
      const i = capitulo.escenas.findIndex((e) => e.id === id);
      if (i >= 0) return { capitulo, escena: capitulo.escenas[i], i };
    }
}

export function nuevaEscena(capituloId: string, despuesDe?: string, titulo?: string): Escena {
  const u = ubicarCapitulo(capituloId);
  if (!u) throw new Error("Capítulo no encontrado");
  const e = escenaNueva(titulo ?? `Escena ${u.capitulo.escenas.length + 1}`);
  const i = despuesDe ? u.capitulo.escenas.findIndex((x) => x.id === despuesDe) : -1;
  if (i >= 0) u.capitulo.escenas.splice(i + 1, 0, e);
  else u.capitulo.escenas.push(e);
  guardarMeta();
  return e;
}

export function duplicarEscena(id: string): Escena | undefined {
  const u = ubicarEscena(id);
  if (!u) return;
  const copia: Escena = { ...structuredClone(u.escena), id: escenaNueva().id, titulo: `${u.escena.titulo} (copia)` };
  u.capitulo.escenas.splice(u.i + 1, 0, copia);
  guardarTexto(copia.id, novela().textos.get(id) ?? "");
  guardarMeta();
  return copia;
}

export async function eliminarEscena(id: string): Promise<boolean> {
  const u = ubicarEscena(id);
  if (!u) return false;
  const palabras = (novela().textos.get(id) ?? "").trim();
  if (palabras && !(await confirmar("Eliminar escena", `«${u.escena.titulo}» contiene texto. Se eliminará de forma permanente.`))) return false;
  u.capitulo.escenas.splice(u.i, 1);
  await borrarTexto(id);
  if (estado.escenaActual === id) estado.escenaActual = u.capitulo.escenas[Math.max(0, u.i - 1)]?.id ?? primeraEscena();
  guardarMeta();
  return true;
}

function primeraEscena(): string {
  return novela().meta.actos.flatMap((a) => a.capitulos.flatMap((c) => c.escenas))[0]?.id ?? "";
}

/** Mueve una escena a otro capítulo (o al mismo) en la posición `indice`. */
export function moverEscena(id: string, capituloDestino: string, indice: number): void {
  const origen = ubicarEscena(id);
  const destino = ubicarCapitulo(capituloDestino);
  if (!origen || !destino) return;
  origen.capitulo.escenas.splice(origen.i, 1);
  let i = indice;
  if (origen.capitulo.id === capituloDestino && origen.i < indice) i--;
  destino.capitulo.escenas.splice(Math.max(0, Math.min(i, destino.capitulo.escenas.length)), 0, origen.escena);
  guardarMeta();
}

export function desplazarEscena(id: string, delta: number): void {
  const u = ubicarEscena(id);
  if (!u) return;
  const j = u.i + delta;
  if (j >= 0 && j < u.capitulo.escenas.length) {
    u.capitulo.escenas.splice(u.i, 1);
    u.capitulo.escenas.splice(j, 0, u.escena);
    guardarMeta();
    return;
  }
  // Salta al capítulo vecino.
  const caps = todosLosCapitulos(novela().meta);
  const k = caps.findIndex((c) => c.capitulo.id === u.capitulo.id) + delta;
  const vecino = caps[k];
  if (!vecino) return;
  u.capitulo.escenas.splice(u.i, 1);
  if (delta > 0) vecino.capitulo.escenas.unshift(u.escena);
  else vecino.capitulo.escenas.push(u.escena);
  guardarMeta();
}

export function nuevoCapitulo(actoId: string, despuesDe?: string): Capitulo {
  const acto = novela().meta.actos.find((a) => a.id === actoId);
  if (!acto) throw new Error("Acto no encontrado");
  const c = capituloNuevo(`Capítulo ${todosLosCapitulos(novela().meta).length + 1}`);
  const i = despuesDe ? acto.capitulos.findIndex((x) => x.id === despuesDe) : -1;
  if (i >= 0) acto.capitulos.splice(i + 1, 0, c);
  else acto.capitulos.push(c);
  guardarMeta();
  return c;
}

export async function eliminarCapitulo(id: string): Promise<boolean> {
  const u = ubicarCapitulo(id);
  if (!u) return false;
  const conTexto = u.capitulo.escenas.filter((e) => (novela().textos.get(e.id) ?? "").trim()).length;
  const ok = await confirmar(
    "Eliminar capítulo",
    `Se eliminará «${u.capitulo.titulo}» con sus ${u.capitulo.escenas.length} escenas${conTexto ? ` (${conTexto} con texto)` : ""}.`,
  );
  if (!ok) return false;
  u.acto.capitulos.splice(u.i, 1);
  for (const e of u.capitulo.escenas) await borrarTexto(e.id);
  if (u.capitulo.escenas.some((e) => e.id === estado.escenaActual)) estado.escenaActual = primeraEscena();
  guardarMeta();
  return true;
}

export function desplazarCapitulo(id: string, delta: number): void {
  const u = ubicarCapitulo(id);
  if (!u) return;
  const j = u.i + delta;
  const actos = novela().meta.actos;
  if (j >= 0 && j < u.acto.capitulos.length) {
    u.acto.capitulos.splice(u.i, 1);
    u.acto.capitulos.splice(j, 0, u.capitulo);
  } else {
    const k = actos.indexOf(u.acto) + delta;
    const vecino = actos[k];
    if (!vecino) return;
    u.acto.capitulos.splice(u.i, 1);
    if (delta > 0) vecino.capitulos.unshift(u.capitulo);
    else vecino.capitulos.push(u.capitulo);
  }
  guardarMeta();
}

export function nuevoActo(): Acto {
  const meta = novela().meta;
  const romanos = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const a = actoNuevo(`Acto ${romanos[meta.actos.length] ?? meta.actos.length + 1}`);
  a.capitulos[0].titulo = `Capítulo ${todosLosCapitulos(meta).length + 1}`;
  meta.actos.push(a);
  guardarMeta();
  return a;
}

export async function eliminarActo(id: string): Promise<boolean> {
  const meta = novela().meta;
  const i = meta.actos.findIndex((a) => a.id === id);
  if (i < 0) return false;
  if (meta.actos.length === 1) {
    await confirmar("No se puede eliminar", "La novela necesita al menos un acto.", "Entendido", false);
    return false;
  }
  const acto = meta.actos[i];
  if (!(await confirmar("Eliminar acto", `Se eliminará «${acto.titulo}» con ${acto.capitulos.length} capítulos y todas sus escenas.`))) return false;
  meta.actos.splice(i, 1);
  for (const c of acto.capitulos) for (const e of c.escenas) await borrarTexto(e.id);
  if (acto.capitulos.some((c) => c.escenas.some((e) => e.id === estado.escenaActual))) estado.escenaActual = primeraEscena();
  guardarMeta();
  return true;
}

export function desplazarActo(id: string, delta: number): void {
  const actos = novela().meta.actos;
  const i = actos.findIndex((a) => a.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= actos.length) return;
  const [a] = actos.splice(i, 1);
  actos.splice(j, 0, a);
  guardarMeta();
}

export async function renombrar(obj: { titulo: string }, que: string): Promise<boolean> {
  const t = await pedirTexto(`Renombrar ${que}`, "Título", obj.titulo, "Renombrar");
  if (t === null || !t) return false;
  obj.titulo = t;
  guardarMeta();
  return true;
}
