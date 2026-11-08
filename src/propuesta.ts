// Tarjeta de propuesta de la IA: muestra el texto en streaming y ofrece
// aceptar / reintentar / pedir cambios / descartar. La usan el editor, el
// Codex y la planificación.

import { instruccionEvitar, nombreModelo, type Funcion } from "./ajustes";
import { conCodex, promptActivo, renderizar, variablesBase, type Variables } from "./contexto";
import { novela } from "./estado";
import { generar, modeloPara, type Generacion, type Mensaje } from "./ia";
import type { AccionPrompt } from "./modelo";
import { btn, errMsg, h, icon, spinner, toast, type IconName } from "./ui";

export interface Preparada {
  sistema: string;
  usuario: string;
  modelo: string;
  nombrePrompt: string;
}

const FUNCION_DE: Record<AccionPrompt, Funcion> = {
  beat: "escritura",
  continuar: "escritura",
  reescribir: "escritura",
  expandir: "escritura",
  acortar: "escritura",
  describir: "escritura",
  resumir: "resumen",
  codex: "codex",
  chat: "chat",
  general: "escritura",
};

/** Resuelve el prompt activo de la acción con las variables de la novela. */
export function preparar(accion: AccionPrompt, vars: Variables, escenaId?: string, modelo?: string): Preparada {
  const n = novela();
  const p = promptActivo(n, accion);
  const v = conCodex(n, { ...variablesBase(n, escenaId), ...vars }, escenaId);
  return {
    sistema: [renderizar(p.sistema, v), instruccionEvitar()].filter(Boolean).join("\n\n"),
    usuario: renderizar(p.usuario, v),
    modelo: modelo || modeloPara(FUNCION_DE[accion], p.modelo),
    nombrePrompt: p.nombre,
  };
}

/** Genera sin interfaz (p. ej. resúmenes en lote). */
export function generarDirecto(accion: AccionPrompt, vars: Variables, escenaId?: string): Generacion {
  const p = preparar(accion, vars, escenaId);
  return generar({ modelo: p.modelo, sistema: p.sistema, mensajes: [{ rol: "usuario", texto: p.usuario }] });
}

export interface AccionPropuesta {
  texto: string;
  icono?: IconName;
  primaria?: boolean;
  fn: (texto: string) => void;
}

export class Propuesta {
  readonly el: HTMLElement;
  private cuerpo: HTMLElement;
  private estadoEl: HTMLElement;
  private pie: HTMLElement;
  private gen: Generacion | null = null;
  private texto = "";
  private prep: Preparada | null = null;
  /** Conversación de la propuesta: prompt original + rondas de cambios. */
  private historial: Mensaje[] = [];
  /** Versiones anteriores, para deshacer un cambio pedido. */
  private versiones: string[] = [];
  private salida: HTMLElement | null = null;

  constructor(
    private opts: {
      titulo: string;
      accion: AccionPrompt;
      vars: () => Variables;
      escenaId?: string;
      modelo?: string;
      acciones: AccionPropuesta[];
      alCerrar?: () => void;
    },
  ) {
    this.cuerpo = h("div", { class: "prop-body" });
    this.estadoEl = h("span", { class: "prop-state" });
    this.pie = h("div", { class: "prop-foot" });
    this.el = h(
      "section",
      { class: "proposal" },
      h("header", { class: "prop-head" }, icon("sparkle"), h("span", { class: "prop-title" }, opts.titulo), this.estadoEl),
      this.cuerpo,
      this.pie,
    );
  }

  /** Genera desde cero (primera vez o «Reintentar»). */
  iniciar(): void {
    let prep: Preparada;
    try {
      prep = preparar(this.opts.accion, this.opts.vars(), this.opts.escenaId, this.opts.modelo);
    } catch (e) {
      this.mostrarError(errMsg(e));
      return;
    }
    this.prep = prep;
    this.historial = [{ rol: "usuario", texto: prep.usuario }];
    this.versiones = [];
    this.ejecutar(this.historial);
  }

  /**
   * Pide cambios sobre el texto ya propuesto: la IA recibe su propia versión y
   * la instrucción, y devuelve ese mismo texto editado (no uno nuevo).
   */
  private refinar(instruccion: string): void {
    const actual = this.textoActual();
    if (!this.prep || !actual.trim()) return this.iniciar();
    this.versiones.push(actual);
    this.historial = [
      ...this.historial,
      { rol: "asistente", texto: actual },
      {
        rol: "usuario",
        texto: `Edita el texto que acabas de escribir (incluidos los retoques que yo haya hecho a mano) aplicando SOLO este cambio:

${instruccion}

Reglas:
- Parte de ese mismo texto; no lo reescribas desde cero ni inventes una versión distinta.
- Conserva palabra por palabra todo lo que el cambio no afecte: frases, diálogos, orden y longitud.
- Devuelve el texto completo ya editado, sin comentarios, explicaciones ni marcas.`,
      },
    ];
    this.ejecutar(this.historial, actual);
  }

  private ejecutar(mensajes: Mensaje[], anterior = ""): void {
    const prep = this.prep;
    if (!prep) return;
    this.gen?.cancelar();
    this.texto = "";
    this.estadoEl.replaceChildren(spinner(), h("span", null, anterior ? "Aplicando cambios…" : nombreModelo(prep.modelo)));
    const salida = h("div", { class: "prop-text is-streaming" });
    this.salida = salida;
    this.cuerpo.replaceChildren(salida);
    this.pie.replaceChildren(
      btn("Detener", {
        icon: "stop",
        variant: "secondary",
        size: "sm",
        onclick: () => {
          // Al detener un cambio se recupera la versión anterior.
          if (anterior) {
            this.gen?.cancelar();
            this.gen = null;
            this.historial = this.historial.slice(0, -2);
            this.versiones.pop();
            this.mostrarFinal(anterior);
          } else this.gen?.cancelar();
        },
      }),
    );
    this.el.classList.remove("is-error");
    const gen = generar({
      modelo: prep.modelo,
      sistema: prep.sistema,
      mensajes,
      onTexto: (_d, total) => {
        salida.textContent = total;
        this.texto = total;
      },
    });
    this.gen = gen;
    gen.promesa
      .then((t) => {
        if (this.gen !== gen) return;
        this.mostrarFinal(limpiar(t) || anterior);
      })
      .catch((e) => {
        if (this.gen !== gen) return;
        if (anterior) {
          // El fallo de un cambio no pierde el texto que ya había.
          this.historial = this.historial.slice(0, -2);
          this.versiones.pop();
          this.mostrarFinal(anterior);
          toast(`No se pudo aplicar el cambio: ${errMsg(e)}`, "error");
        } else this.mostrarError(errMsg(e));
      });
  }

  private mostrarFinal(texto: string): void {
    this.texto = texto;
    const salida = h("div", {
      class: "prop-text is-editable",
      attrs: { contenteditable: "plaintext-only", spellcheck: "true", "aria-label": "Propuesta editable" },
    });
    salida.textContent = texto;
    this.salida = salida;
    this.cuerpo.replaceChildren(salida);
    this.estadoEl.replaceChildren(h("span", null, this.prep ? nombreModelo(this.prep.modelo) : ""));
    this.pieFinal();
  }

  /** Texto actual, incluidas las ediciones manuales en la propuesta. */
  private textoActual(): string {
    if (this.salida?.classList.contains("is-editable")) return this.salida.innerText.replace(/\n{3,}/g, "\n\n").trim();
    return this.texto;
  }

  private mostrarError(msg: string): void {
    this.el.classList.add("is-error");
    this.estadoEl.replaceChildren(h("span", null, "Error"));
    this.cuerpo.replaceChildren(h("div", { class: "prop-error" }, icon("alert"), h("span", null, msg)));
    this.pie.replaceChildren(
      btn("Reintentar", { icon: "refresh", variant: "secondary", size: "sm", onclick: () => this.iniciar() }),
      h("span", { class: "grow" }),
      btn("Cerrar", { variant: "text", size: "sm", onclick: () => this.cerrar() }),
    );
  }

  private pieFinal(): void {
    const cambios = h("input", { class: "input input-sm prop-refine", placeholder: "Pedir cambios a este texto… (Intro)" });
    cambios.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && cambios.value.trim()) this.refinar(cambios.value.trim());
    });
    this.pie.replaceChildren(
      ...this.opts.acciones.map((a) =>
        btn(a.texto, {
          icon: a.icono,
          variant: a.primaria ? "primary" : "secondary",
          size: "sm",
          onclick: () => {
            a.fn(this.textoActual());
            this.cerrar();
          },
        }),
      ),
      ...[this.versiones.length
        ? btn(null, {
            icon: "history",
            variant: "ghost",
            size: "icon-sm",
            title: "Deshacer el último cambio",
            onclick: () => {
              const previa = this.versiones.pop();
              if (previa === undefined) return;
              this.historial = this.historial.slice(0, -2);
              this.mostrarFinal(previa);
            },
          })
        : null].filter((x): x is HTMLButtonElement => !!x),
      btn(null, { icon: "refresh", variant: "ghost", size: "icon-sm", title: "Generar otra versión desde cero", onclick: () => this.iniciar() }),
      btn(null, {
        icon: "copy",
        variant: "ghost",
        size: "icon-sm",
        title: "Copiar",
        onclick: () => void navigator.clipboard.writeText(this.textoActual()).then(() => toast("Copiado", "ok")),
      }),
      cambios,
      btn("Descartar", { variant: "text", size: "sm", onclick: () => this.cerrar() }),
    );
  }

  cerrar(): void {
    this.gen?.cancelar();
    this.gen = null;
    this.el.remove();
    this.opts.alCerrar?.();
  }
}

/** Quita envoltorios habituales (comillas, bloques de código, etiquetas). */
export function limpiar(t: string): string {
  let s = t.trim();
  s = s.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, "$1");
  s = s.replace(/^<(fragmento|prosa|texto)>\s*([\s\S]*?)\s*<\/\1>$/i, "$2");
  return s.trim();
}
