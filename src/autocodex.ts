// Rellenar el Codex desde la novela. La IA lee las escenas por lotes y propone
// entradas nuevas y datos nuevos para las que ya existen; el autor revisa y
// aplica. Para no repetir nada la vez siguiente:
//  - se recuerda qué escenas se leyeron (con un hash de su texto) y por defecto
//    solo se leen las nuevas o las que han cambiado;
//  - a la IA se le pasa el Codex actual (nombres, alias, campos y descripción)
//    con la orden de no repetirlo;
//  - en la app se filtra lo que ya existe (mismo nombre o alias, misma clave de
//    campo, mismo alias) y lo que el autor descartó en pasadas anteriores.

import { instruccionIdioma, nombreModelo } from "./ajustes";
import { formatearEntrada } from "./contexto";
import { guardarCodex, guardarMeta, novela } from "./estado";
import { generar, modeloPara, type Generacion } from "./ia";
import { entradaNueva, TIPOS_CODEX, todasLasEscenas, type EntradaCodex, type Novela, type TipoCodex } from "./modelo";
import { btn, errMsg, h, icon, modal, num, select, spinner, toast } from "./ui";

interface Campo {
  clave: string;
  valor: string;
}
interface Relacion {
  nombre: string;
  vinculo: string; // «hermana de», «vive en»… (puede ir vacío)
}
interface PropuestaNueva {
  tipo: TipoCodex;
  nombre: string;
  alias: string[];
  descripcion: string;
  campos: Campo[];
  relaciones: Relacion[];
}
interface PropuestaAmpliar {
  id: string; // entrada existente
  alias: string[];
  campos: Campo[];
  datos: string[];
  relaciones: Relacion[];
}
interface Resultado {
  nuevas: PropuestaNueva[];
  ampliar: Map<string, PropuestaAmpliar>;
}

export interface EstadoAutoCodex {
  escenas: Record<string, string>; // id de escena → hash del texto analizado
  descartados: string[]; // claves normalizadas de propuestas rechazadas
  fecha: number;
}

const PALABRAS_LOTE = 7000;

// ── Utilidades ───────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function hash(s: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(36) + s.length.toString(36);
}

function estadoAuto(n: Novela): EstadoAutoCodex {
  const m = n.meta as { codexAuto?: EstadoAutoCodex };
  m.codexAuto ??= { escenas: {}, descartados: [], fecha: 0 };
  m.codexAuto.escenas ??= {};
  m.codexAuto.descartados ??= [];
  return m.codexAuto;
}

/** Busca una entrada existente por nombre o alias (sin acentos ni mayúsculas). */
function buscarEntrada(n: Novela, nombre: string): EntradaCodex | undefined {
  const k = norm(nombre);
  if (!k) return undefined;
  for (const e of n.codex.values()) if ([e.nombre, ...e.alias].some((x) => norm(x) === k)) return e;
  return undefined;
}

const claveNueva = (p: { tipo: string; nombre: string }) => `n:${norm(p.nombre)}`;
const claveCampo = (id: string, c: Campo) => `c:${id}:${norm(c.clave)}`;
const claveAlias = (id: string, a: string) => `a:${id}:${norm(a)}`;
const claveDato = (id: string, d: string) => `d:${id}:${norm(d).slice(0, 80)}`;
const claveRel = (id: string, r: string) => `r:${id}:${norm(r)}`;

// ── Qué leer ─────────────────────────────────────────────────────────────

function textoEscena(n: Novela, id: string): string {
  return n.textos.get(id) ?? "";
}

export function escenasPendientes(n: Novela, todas: boolean) {
  const est = estadoAuto(n);
  return todasLasEscenas(n.meta).filter((u) => {
    const t = textoEscena(n, u.escena.id);
    if (!t.trim()) return false;
    return todas || est.escenas[u.escena.id] !== hash(t);
  });
}

function lotes(n: Novela, escenas: ReturnType<typeof escenasPendientes>) {
  const out: { ids: string[]; texto: string }[] = [];
  let actual = { ids: [] as string[], texto: "", palabras: 0 };
  for (const u of escenas) {
    const t = textoEscena(n, u.escena.id).trim();
    const w = t.split(/\s+/).length;
    if (actual.ids.length && actual.palabras + w > PALABRAS_LOTE) {
      out.push(actual);
      actual = { ids: [], texto: "", palabras: 0 };
    }
    actual.ids.push(u.escena.id);
    actual.texto += `\n\n### Cap. ${u.numCapitulo} «${u.capitulo.titulo}» · ${u.escena.titulo}\n${u.escena.resumen.trim() ? `(Resumen: ${u.escena.resumen.trim()})\n` : ""}${t}`;
    actual.palabras += w;
  }
  if (actual.ids.length) out.push(actual);
  return out;
}

// ── Prompt ───────────────────────────────────────────────────────────────

function sistema(n: Novela): string {
  const tipos = TIPOS_CODEX.map((t) => `"${t.valor}" (${t.texto})`).join(", ");
  return `Eres un documentalista de novelas. Lees escenas y extraes la información del mundo para el Codex de la novela «${n.meta.titulo}»: personajes, lugares, objetos importantes, lore (reglas, historia, instituciones) y subtramas.

Reglas:
- Solo hechos que estén en el texto o se deduzcan con seguridad de él. No inventes nada. Si dudas, no lo incluyas.
- NO repitas lo que ya está en el Codex actual (te lo paso abajo): ni entradas con el mismo nombre o alias, ni campos cuya clave ya exista en esa entrada, ni datos que ya diga su descripción.
- Si un personaje o lugar ya existe, ponlo en "ampliar" con SOLO lo nuevo. Usa su nombre exacto del Codex.
- Entradas nuevas solo para elementos con peso en la historia (que actúan, se repiten o importan). No crees entradas para figurantes de una sola mención sin importancia.
- Campos: pares clave/valor cortos (p. ej. Edad, Ocupación, Aspecto, Familia, Ubicación, Dueño). Valores de una línea.
- "datos": hechos nuevos de una o dos frases sobre una entrada existente que no estén en su descripción ni en sus campos.
- "relaciones": otras entradas (existentes o nuevas) con las que tiene una relación clara en el texto, con el tipo de vínculo visto desde esta entrada en pocas palabras ("hermana de", "vive en", "trabaja para", "posee"); vínculo vacío si no está claro.
- Tipos válidos: ${tipos}.
- Las descripciones, breves (2-4 frases) y útiles para escribir.

Devuelve SOLO un objeto JSON, sin texto alrededor, con esta forma:
{"nuevas":[{"tipo":"personaje","nombre":"…","alias":["…"],"descripcion":"…","campos":[{"clave":"…","valor":"…"}],"relaciones":[{"nombre":"…","vinculo":"…"}]}],
 "ampliar":[{"nombre":"nombre exacto en el Codex","alias":["…"],"campos":[{"clave":"…","valor":"…"}],"datos":["…"],"relaciones":[{"nombre":"…","vinculo":"…"}]}]}
Si no hay nada nuevo, devuelve {"nuevas":[],"ampliar":[]}.

${instruccionIdioma(n.meta.idioma)}`;
}

function codexActual(n: Novela, ya: Resultado): string {
  const partes = [...n.codex.values()].map((e) => formatearEntrada(n, e));
  for (const p of ya.nuevas) partes.push(`## ${p.nombre} (${p.tipo}, ya propuesta en esta pasada)\n${p.campos.map((c) => `${c.clave}: ${c.valor}`).join("\n")}`);
  return partes.length ? partes.join("\n\n") : "(vacío)";
}

function extraerJson(t: string): unknown {
  const limpio = t.replace(/```(?:json)?/g, "");
  const ini = limpio.indexOf("{");
  for (let fin = limpio.lastIndexOf("}"); fin > ini && ini >= 0; fin = limpio.lastIndexOf("}", fin - 1)) {
    try {
      return JSON.parse(limpio.slice(ini, fin + 1));
    } catch {
      /* probar un cierre anterior */
    }
  }
  throw new Error("La IA no devolvió JSON válido.");
}

const lista = (x: unknown): string[] => (Array.isArray(x) ? x.map(String).map((s) => s.trim()).filter(Boolean) : []);
const relaciones = (x: unknown): Relacion[] =>
  Array.isArray(x)
    ? x
        .map((r) => (typeof r === "string" ? { nombre: r.trim(), vinculo: "" } : { nombre: String(r?.nombre ?? "").trim(), vinculo: String(r?.vinculo ?? "").trim() }))
        .filter((r) => r.nombre)
    : [];
const campos = (x: unknown): Campo[] =>
  Array.isArray(x)
    ? x
        .map((c) => ({ clave: String(c?.clave ?? "").trim(), valor: String(c?.valor ?? "").trim() }))
        .filter((c) => c.clave && c.valor)
    : [];

/** Une la respuesta de un lote con lo acumulado, quitando todo lo repetido. */
function fusionar(n: Novela, r: Resultado, json: unknown): void {
  const est = estadoAuto(n);
  const descartado = new Set(est.descartados);
  const o = (json ?? {}) as { nuevas?: unknown[]; ampliar?: unknown[] };

  const ampliar = (e: EntradaCodex, a: { alias?: unknown; campos?: unknown; datos?: unknown; relaciones?: unknown; descripcion?: unknown }) => {
    const p = r.ampliar.get(e.id) ?? { id: e.id, alias: [], campos: [], datos: [], relaciones: [] };
    const aliasYa = new Set([e.nombre, ...e.alias, ...p.alias].map(norm));
    for (const al of lista(a.alias)) if (!aliasYa.has(norm(al)) && !descartado.has(claveAlias(e.id, al))) (p.alias.push(al), aliasYa.add(norm(al)));
    const clavesYa = new Set([...e.campos, ...p.campos].map((c) => norm(c.clave)));
    for (const c of campos(a.campos)) if (!clavesYa.has(norm(c.clave)) && !descartado.has(claveCampo(e.id, c))) (p.campos.push(c), clavesYa.add(norm(c.clave)));
    const desc = norm(e.descripcion);
    const datos = [...lista(a.datos), ...(typeof a.descripcion === "string" && a.descripcion.trim() && !e.descripcion.trim() ? [a.descripcion.trim()] : [])];
    for (const d of datos) {
      const k = norm(d);
      if (!k || desc.includes(k) || p.datos.some((x) => norm(x) === k) || descartado.has(claveDato(e.id, d))) continue;
      p.datos.push(d);
    }
    const relYa = new Set([...e.relaciones.map((id) => norm(n.codex.get(id)?.nombre ?? "")), ...p.relaciones.map((r) => norm(r.nombre))]);
    for (const rel of relaciones(a.relaciones)) {
      const destino = buscarEntrada(n, rel.nombre);
      if (destino?.id === e.id || norm(rel.nombre) === norm(e.nombre)) continue;
      const nombre = destino?.nombre ?? rel.nombre;
      if (!relYa.has(norm(nombre)) && !descartado.has(claveRel(e.id, nombre))) (p.relaciones.push({ nombre, vinculo: rel.vinculo }), relYa.add(norm(nombre)));
    }
    if (p.alias.length || p.campos.length || p.datos.length || p.relaciones.length) r.ampliar.set(e.id, p);
  };

  for (const x of o.ampliar ?? []) {
    const a = x as { nombre?: unknown };
    const e = buscarEntrada(n, String(a.nombre ?? ""));
    if (e) ampliar(e, a as never);
  }
  for (const x of o.nuevas ?? []) {
    const a = x as { tipo?: unknown; nombre?: unknown; alias?: unknown; descripcion?: unknown; campos?: unknown; relaciones?: unknown };
    const nombre = String(a.nombre ?? "").trim();
    if (!nombre) continue;
    // ¿Ya existe con ese nombre o con uno de sus alias? Entonces es ampliar.
    const existente = [nombre, ...lista(a.alias)].map((x) => buscarEntrada(n, x)).find(Boolean);
    if (existente) {
      ampliar(existente, a);
      continue;
    }
    const tipo = (TIPOS_CODEX.some((t) => t.valor === a.tipo) ? a.tipo : "otro") as TipoCodex;
    const nueva: PropuestaNueva = { tipo, nombre, alias: lista(a.alias), descripcion: String(a.descripcion ?? "").trim(), campos: campos(a.campos), relaciones: relaciones(a.relaciones) };
    if (descartado.has(claveNueva(nueva))) continue;
    // Repetida en otro lote de esta misma pasada: se juntan.
    const previa = r.nuevas.find((p) => [p.nombre, ...p.alias].some((y) => [nombre, ...nueva.alias].some((z) => norm(y) === norm(z))));
    if (previa) {
      for (const al of nueva.alias) if (![previa.nombre, ...previa.alias].some((y) => norm(y) === norm(al))) previa.alias.push(al);
      for (const c of nueva.campos) if (!previa.campos.some((y) => norm(y.clave) === norm(c.clave))) previa.campos.push(c);
      if (nueva.descripcion && !norm(previa.descripcion).includes(norm(nueva.descripcion))) previa.descripcion = `${previa.descripcion}\n\n${nueva.descripcion}`.trim();
      for (const rel of nueva.relaciones) if (!previa.relaciones.some((y) => norm(y.nombre) === norm(rel.nombre))) previa.relaciones.push(rel);
      continue;
    }
    r.nuevas.push(nueva);
  }
}

// ── Interfaz ─────────────────────────────────────────────────────────────

export function abrirAutoCodex(): void {
  const n = novela();
  const m = modal("Rellenar el Codex desde la novela", { wide: true, subtitle: "La IA lee tus escenas y propone fichas nuevas y datos que faltan. Tú eliges qué se guarda." });
  m.el.classList.add("autocodex");
  let gen: Generacion | null = null;
  let cancelado = false;
  const cerrarTodo = () => {
    cancelado = true;
    gen?.cancelar();
    m.close();
  };

  const inicio = () => {
    const est = estadoAuto(n);
    let todas = false;
    const info = h("p", { class: "muted" });
    const pintarInfo = () => {
      const pend = escenasPendientes(n, todas);
      const palabras = pend.reduce((s, u) => s + textoEscena(n, u.escena.id).split(/\s+/).length, 0);
      const total = todasLasEscenas(n.meta).filter((u) => textoEscena(n, u.escena.id).trim()).length;
      info.textContent = pend.length
        ? `Se leerán ${num(pend.length)} de ${num(total)} escenas con texto (${num(palabras)} palabras, ${num(lotes(n, pend).length)} llamadas a la IA).`
        : "No hay escenas nuevas ni cambiadas desde la última vez. Marca «Releer toda la novela» si quieres repasarla entera.";
      analizar.disabled = !pend.length;
    };
    const releer = h("input", { type: "checkbox" });
    releer.addEventListener("change", () => ((todas = releer.checked), pintarInfo()));
    const analizar = btn("Analizar", { icon: "sparkle", variant: "primary", onclick: () => void ejecutar(todas) });
    const olvidar = btn("Olvidar descartes", {
      variant: "ghost",
      size: "sm",
      onclick: () => {
        est.descartados = [];
        guardarMeta("meta");
        olvidar.hidden = true;
        toast("Se volverán a proponer las sugerencias descartadas", "ok");
      },
    });
    olvidar.hidden = !est.descartados.length;
    m.body.replaceChildren(
      h(
        "div",
        { class: "ac-start" },
        h("p", null, est.fecha ? `Última pasada: ${new Date(est.fecha).toLocaleString()}. Por defecto solo se leen las escenas nuevas o modificadas desde entonces, y no se vuelve a proponer lo que ya está en el Codex ni lo que descartaste.` : "Primera pasada: se leerá toda la novela."),
        info,
        h("label", { class: "check" }, releer, h("span", null, "Releer toda la novela (sigue sin repetir lo que ya está en el Codex)")),
        h("p", { class: "muted" }, `Modelo: ${nombreModelo(modeloPara("codex"))} (Ajustes → Inteligencia artificial → Codex).`),
      ),
    );
    m.footer.replaceChildren(olvidar, h("span", { class: "grow" }), btn("Cancelar", { variant: "ghost", onclick: () => m.close() }), analizar);
    pintarInfo();
  };

  const ejecutar = async (todas: boolean) => {
    const pend = escenasPendientes(n, todas);
    const partes = lotes(n, pend);
    const r: Resultado = { nuevas: [], ampliar: new Map() };
    const leidas: string[] = [];
    const estadoEl = h("div", { class: "ac-progress" });
    const barra = h("span", { class: "meter meter-wide" }, h("span", { class: "meter-fill" }));
    const vivo = h("p", { class: "muted ac-live" });
    m.body.replaceChildren(estadoEl, barra, vivo);
    m.footer.replaceChildren(h("span", { class: "grow" }), btn("Detener y revisar lo encontrado", { variant: "secondary", onclick: () => (gen?.cancelar(), (cancelado = true)) }));
    const errores: string[] = [];
    for (let i = 0; i < partes.length && !cancelado; i++) {
      estadoEl.replaceChildren(spinner(), h("span", null, `Leyendo parte ${num(i + 1)} de ${num(partes.length)}…`));
      (barra.firstChild as HTMLElement).style.width = `${(i / partes.length) * 100}%`;
      try {
        gen = generar({
          modelo: modeloPara("codex"),
          sistema: sistema(n),
          maxTokens: 8000,
          temperatura: 0.2,
          mensajes: [
            {
              rol: "usuario",
              texto: `<codex_actual>\n${codexActual(n, r)}\n</codex_actual>\n\n<escenas>${partes[i].texto}\n</escenas>\n\nExtrae SOLO lo nuevo respecto al Codex actual. Responde con el JSON.`,
            },
          ],
          onTexto: (_d, total) => (vivo.textContent = `${num(total.length)} caracteres recibidos`),
        });
        const t = await gen.promesa;
        fusionar(n, r, extraerJson(t));
        leidas.push(...partes[i].ids);
      } catch (e) {
        if (cancelado) break;
        errores.push(`Parte ${i + 1}: ${errMsg(e)}`);
      }
    }
    gen = null;
    if (!m.el.isConnected) return;
    revisar(r, leidas, errores);
  };

  const revisar = (r: Resultado, leidas: string[], errores: string[]) => {
    const est = estadoAuto(n);
    // Cada sugerencia, con su casilla.
    const items: { clave: string; check: HTMLInputElement; aplicar: (ids: Map<string, string>) => void }[] = [];
    const casilla = (clave: string, aplicar: (ids: Map<string, string>) => void) => {
      const c = h("input", { type: "checkbox", checked: true });
      items.push({ clave, check: c, aplicar });
      return c;
    };
    const creadas: EntradaCodex[] = [];
    const nombreIds = new Map<string, string>(); // nombre normalizado → id (para relaciones)
    for (const e of n.codex.values()) for (const x of [e.nombre, ...e.alias]) nombreIds.set(norm(x), e.id);

    const tarjetasNuevas = r.nuevas.map((p) => {
      const e = entradaNueva(p.nombre, p.tipo);
      const tipoSel = select(TIPOS_CODEX.map((t) => ({ valor: t.valor, texto: t.texto })), p.tipo, (v) => (e.tipo = v));
      const c = casilla(claveNueva(p), (ids) => {
        e.alias = p.alias;
        e.descripcion = p.descripcion;
        e.campos = p.campos;
        e.relaciones = [];
        for (const r of p.relaciones) {
          const id = ids.get(norm(r.nombre));
          if (!id || id === e.id || e.relaciones.includes(id)) continue;
          e.relaciones.push(id);
          if (r.vinculo) e.vinculos[id] = r.vinculo;
        }
        guardarCodex(e, false);
        creadas.push(e);
      });
      nombreIds.set(norm(p.nombre), e.id);
      for (const al of p.alias) nombreIds.set(norm(al), e.id);
      return h(
        "div",
        { class: "ac-card", attrs: { translate: "no" } },
        h("label", { class: "ac-head" }, c, h("strong", null, p.nombre), p.alias.length ? h("span", { class: "muted" }, ` · ${p.alias.join(", ")}`) : null, h("span", { class: "grow" }), tipoSel),
        p.descripcion ? h("p", { class: "ac-desc" }, p.descripcion) : null,
        p.campos.length ? h("dl", { class: "ac-fields" }, ...p.campos.flatMap((x) => [h("dt", null, x.clave), h("dd", null, x.valor)])) : null,
        p.relaciones.length ? h("p", { class: "muted ac-rel" }, icon("link"), ` ${p.relaciones.map((r) => (r.vinculo ? `${r.vinculo} ${r.nombre}` : r.nombre)).join(" · ")}`) : null,
      );
    });

    const tarjetasAmpliar = [...r.ampliar.values()].map((p) => {
      const e = n.codex.get(p.id)!;
      const filas: HTMLElement[] = [];
      for (const al of p.alias) filas.push(h("label", { class: "ac-row" }, casilla(claveAlias(e.id, al), () => (e.alias.includes(al) || e.alias.push(al))), h("span", { class: "ac-kind" }, "Alias"), h("span", null, al)));
      for (const c of p.campos)
        filas.push(h("label", { class: "ac-row" }, casilla(claveCampo(e.id, c), () => (e.campos.some((x) => norm(x.clave) === norm(c.clave)) || e.campos.push(c))), h("span", { class: "ac-kind" }, c.clave), h("span", null, c.valor)));
      for (const d of p.datos) filas.push(h("label", { class: "ac-row" }, casilla(claveDato(e.id, d), () => (e.descripcion = `${e.descripcion.trim()}\n\n${d}`.trim())), h("span", { class: "ac-kind" }, "Dato"), h("span", null, d)));
      for (const rel of p.relaciones)
        filas.push(
          h(
            "label",
            { class: "ac-row" },
            casilla(claveRel(e.id, rel.nombre), (ids) => {
              const id = ids.get(norm(rel.nombre));
              if (!id || id === e.id || e.relaciones.includes(id)) return;
              e.relaciones.push(id);
              if (rel.vinculo) e.vinculos[id] = rel.vinculo;
              const otra = n.codex.get(id);
              if (otra && !otra.relaciones.includes(e.id)) (otra.relaciones.push(e.id), guardarCodex(otra, false));
            }),
            h("span", { class: "ac-kind" }, "Relación"),
            h("span", null, rel.vinculo ? `${rel.vinculo} ${rel.nombre}` : rel.nombre),
          ),
        );
      return h("div", { class: "ac-card", attrs: { translate: "no" } }, h("div", { class: "ac-head" }, h("strong", null, e.nombre), h("span", { class: "muted" }, ` · ${TIPOS_CODEX.find((t) => t.valor === e.tipo)?.texto ?? e.tipo}`)), ...filas);
    });

    const total = items.length;
    const cuerpo: Node[] = [];
    if (errores.length) cuerpo.push(h("div", { class: "prop-aviso" }, icon("alert"), h("span", null, `Algunas partes fallaron y se volverán a leer la próxima vez: ${errores.join(" · ")}`)));
    if (!total) cuerpo.push(h("p", { class: "ac-empty" }, leidas.length ? "No hay nada nuevo: todo lo que aparece en estas escenas ya está en el Codex." : "No se pudo leer ninguna escena."));
    if (tarjetasNuevas.length) cuerpo.push(h("h3", { class: "set-title" }, `Entradas nuevas (${num(tarjetasNuevas.length)})`), ...tarjetasNuevas);
    if (tarjetasAmpliar.length) cuerpo.push(h("h3", { class: "set-title" }, `Datos nuevos para entradas existentes (${num(tarjetasAmpliar.length)})`), ...tarjetasAmpliar);
    m.body.replaceChildren(...cuerpo);

    const marcarTodo = (v: boolean) => items.forEach((x) => (x.check.checked = v));
    const aplicar = () => {
      const elegidos = items.filter((x) => x.check.checked);
      // Primero las entradas nuevas (para que las relaciones encuentren su id).
      for (const x of elegidos) x.aplicar(nombreIds);
      // Relaciones de las entradas nuevas: solo con entradas que existan (las no elegidas
      // no se crean) y en los dos sentidos.
      for (const e of creadas) {
        e.relaciones = e.relaciones.filter((id) => n.codex.has(id));
        for (const id of e.relaciones) {
          const otra = n.codex.get(id);
          if (otra && !otra.relaciones.includes(e.id)) (otra.relaciones.push(e.id), guardarCodex(otra, false));
        }
        guardarCodex(e, false);
      }
      for (const p of r.ampliar.values()) {
        const e = n.codex.get(p.id);
        if (e) {
          e.relaciones = e.relaciones.filter((id) => n.codex.has(id));
          guardarCodex(e, false);
        }
      }
      // Lo no elegido no se vuelve a proponer.
      const nuevosDescartes = items.filter((x) => !x.check.checked).map((x) => x.clave);
      est.descartados = [...new Set([...est.descartados, ...nuevosDescartes])];
      for (const id of leidas) est.escenas[id] = hash(textoEscena(n, id));
      est.fecha = Date.now();
      guardarMeta("codex");
      toast(elegidos.length ? `Codex actualizado: ${num(elegidos.length)} cambios` : "Hecho: no se ha añadido nada", "ok");
      m.close();
    };
    m.footer.replaceChildren(
      ...(total ? [btn("Marcar todo", { variant: "ghost", size: "sm", onclick: () => marcarTodo(true) }), btn("Desmarcar todo", { variant: "ghost", size: "sm", onclick: () => marcarTodo(false) })] : []),
      h("span", { class: "grow" }),
      btn("Cancelar", { variant: "ghost", onclick: cerrarTodo }),
      btn(total ? "Aplicar seleccionadas" : "Hecho", { icon: "check", variant: "primary", onclick: aplicar }),
    );
  };

  inicio();
}
