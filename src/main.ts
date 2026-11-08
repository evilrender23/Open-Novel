// Arranque de Open Novel: ajustes, eventos, biblioteca o última novela,
// atajos de teclado globales y paleta de comandos (⌘K).

import "./styles.css";

import { iniciarEventos } from "./api";
import { cargarAjustes } from "./ajustes";
import { abrirNovela, cerrarNovela, estado, novela, vaciarGuardado, type Vista } from "./estado";
import { todasLasEscenas, TIPOS_CODEX } from "./modelo";
import { irA, montarShell, modoFoco, NAV, registrarVistas, iconoTipo } from "./shell";
import { errMsg, h, icon, toast, cerrarMenu, type IconName } from "./ui";
import { vistaAgente } from "./views/agente";
import { abrirAjustes } from "./views/ajustes";
import { pantallaBiblioteca } from "./views/biblioteca";
import { vistaChat } from "./views/chat";
import { vistaCodex } from "./views/codex";
import { abrirEntrada, abrirEscena, atajoBuscar, vistaEscribir } from "./views/escribir";
import { vistaExportar } from "./views/exportar";
import { vistaNotas } from "./views/notas";
import { abrirMetadatos, vistaPlanificar } from "./views/planificar";
import { vistaPrompts } from "./views/prompts";
import { iniciarActualizador } from "./updater";

const app = document.getElementById("app")!;

registrarVistas(
  {
    planificar: vistaPlanificar,
    escribir: vistaEscribir,
    codex: vistaCodex,
    chat: vistaChat,
    agente: vistaAgente,
    notas: vistaNotas,
    prompts: vistaPrompts,
    exportar: vistaExportar,
  },
  {
    biblioteca: () => void irBiblioteca(),
    ajustes: () => abrirAjustes(),
    novela: () => abrirMetadatos(),
    paleta: () => abrirPaleta(),
  },
);

async function irBiblioteca(): Promise<void> {
  await vaciarGuardado();
  cerrarNovela();
  pantallaBiblioteca(app, (c) => void abrir(c), () => abrirAjustes());
}

async function abrir(carpeta: string): Promise<void> {
  try {
    await abrirNovela(carpeta);
    montarShell(app);
  } catch (e) {
    toast(`No se pudo abrir la novela: ${errMsg(e)}`, "error");
    await irBiblioteca();
  }
}

// ── Paleta de comandos ───────────────────────────────────────────────────

interface Comando {
  texto: string;
  grupo: string;
  icono: IconName;
  accion: () => void;
  extra?: string;
}

function comandos(): Comando[] {
  const out: Comando[] = [];
  for (const it of NAV) out.push({ texto: it.texto, grupo: "Ir a", icono: it.icono, accion: () => irA(it.vista), extra: `⌘${it.atajo}` });
  out.push(
    { texto: "Ajustes", grupo: "Acciones", icono: "settings", accion: () => abrirAjustes(), extra: "⌘," },
    { texto: "Datos de la novela", grupo: "Acciones", icono: "book", accion: () => abrirMetadatos() },
    { texto: "Modo foco", grupo: "Acciones", icono: "focus", accion: () => modoFoco(), extra: "⌘⇧F" },
    { texto: "Buscar en el escrito", grupo: "Acciones", icono: "search", accion: () => (irA("escribir"), window.setTimeout(() => atajoBuscar("buscar"), 30)), extra: "⌘F" },
    { texto: "Buscar y reemplazar", grupo: "Acciones", icono: "search", accion: () => (irA("escribir"), window.setTimeout(() => atajoBuscar("reemplazar"), 30)), extra: "⌘⌥F" },
    { texto: "Volver a la biblioteca", grupo: "Acciones", icono: "library", accion: () => void irBiblioteca() },
  );
  const n = novela();
  for (const u of todasLasEscenas(n.meta))
    out.push({ texto: u.escena.titulo, grupo: "Escenas", icono: "write", accion: () => abrirEscena(u.escena.id), extra: `Cap. ${u.numCapitulo}` });
  for (const e of n.codex.values())
    out.push({ texto: e.nombre, grupo: "Codex", icono: iconoTipo(e.tipo), accion: () => abrirEntrada(e.id), extra: [TIPOS_CODEX.find((t) => t.valor === e.tipo)?.texto, ...e.alias].join(" · ") });
  for (const x of n.notas.values())
    out.push({ texto: x.titulo || "Sin título", grupo: "Notas", icono: "note", accion: () => ((estado.notaActual = x.id), irA("notas")) });
  return out;
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function abrirPaleta(): void {
  if (!estado.novela || document.querySelector(".palette")) return;
  cerrarMenu();
  const todos = comandos();
  const input = h("input", { class: "palette-input", placeholder: "Buscar escenas, entradas del Codex, notas o comandos…" });
  const lista = h("div", { class: "palette-list" });
  const fondo = h("div", { class: "modal-backdrop is-top" });
  const caja = h("div", { class: "palette" }, h("div", { class: "palette-head" }, icon("search"), input), lista);
  fondo.append(caja);
  let sel = 0;
  let visibles: Comando[] = [];
  const cerrar = () => fondo.remove();
  const ejecutar = (c?: Comando) => {
    if (!c) return;
    cerrar();
    c.accion();
  };
  const pintar = () => {
    const q = normalizar(input.value.trim());
    visibles = (q ? todos.filter((c) => normalizar(`${c.texto} ${c.extra ?? ""} ${c.grupo}`).includes(q)) : todos.filter((c) => c.grupo !== "Notas")).slice(0, 60);
    sel = Math.min(sel, Math.max(0, visibles.length - 1));
    const nodos: Node[] = [];
    let grupo = "";
    visibles.forEach((c, i) => {
      if (c.grupo !== grupo) {
        grupo = c.grupo;
        nodos.push(h("div", { class: "palette-group" }, grupo));
      }
      const b = h("button", { type: "button", class: `palette-item${i === sel ? " is-active" : ""}`, onclick: () => ejecutar(c) }, icon(c.icono), h("span", { class: "palette-text" }, c.texto), c.extra ? h("span", { class: "palette-extra" }, c.extra) : null);
      b.addEventListener("mousemove", () => {
        if (sel !== i) {
          sel = i;
          pintar();
        }
      });
      nodos.push(b);
    });
    if (!visibles.length) nodos.push(h("p", { class: "panel-empty" }, "Sin resultados."));
    lista.replaceChildren(...nodos);
    lista.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => {
    sel = 0;
    pintar();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sel = Math.min(visibles.length - 1, sel + 1);
      pintar();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
      pintar();
    } else if (e.key === "Enter") ejecutar(visibles[sel]);
    else if (e.key === "Escape") cerrar();
  });
  fondo.addEventListener("mousedown", (e) => e.target === fondo && cerrar());
  document.body.append(fondo);
  pintar();
  input.focus();
}

// ── Atajos globales ──────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) {
    if (e.key === "Escape" && document.querySelector(".shell.is-focus")) modoFoco(false);
    return;
  }
  const k = e.key.toLowerCase();
  // Buscar en el escrito: ⌘F, ⌘⌥F (reemplazar), ⌘G / ⇧⌘G (siguiente / anterior).
  if (e.code === "KeyF" && !e.shiftKey && estado.vista === "escribir" && !document.querySelector(".modal-backdrop")) {
    if (atajoBuscar(e.altKey ? "reemplazar" : "buscar")) return e.preventDefault();
  }
  if (e.code === "KeyG" && estado.vista === "escribir") {
    if (atajoBuscar(e.shiftKey ? "anterior" : "siguiente")) return e.preventDefault();
  }
  if (k === "k") {
    e.preventDefault();
    abrirPaleta();
  } else if (k === ",") {
    e.preventDefault();
    abrirAjustes();
  } else if (k === "s") {
    e.preventDefault();
    void vaciarGuardado().then(() => toast("Guardado", "ok"));
  } else if (k === "f" && e.shiftKey && estado.novela) {
    e.preventDefault();
    modoFoco();
  } else if (/^[1-8]$/.test(e.key) && estado.novela && !document.querySelector(".modal-backdrop")) {
    e.preventDefault();
    irA(NAV[Number(e.key) - 1].vista as Vista);
  }
});

// Menú contextual: el del sistema se desactiva en la interfaz (botones, listas…),
// pero se respeta en los campos de texto y siempre que haya texto seleccionado
// (prosa en modo lectura, propuestas, chat, agente, Codex…) para poder copiar,
// buscar o usar los servicios del sistema. Los menús propios (editor, árbol)
// llaman a preventDefault antes y no llegan aquí.
document.addEventListener("contextmenu", (e) => {
  if (e.defaultPrevented || import.meta.env.DEV) return;
  const destino = e.target as HTMLElement;
  if (destino.closest?.("input, textarea, [contenteditable='true']")) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim()) return;
  e.preventDefault();
});


window.addEventListener("beforeunload", () => void vaciarGuardado());

// ── Arranque ─────────────────────────────────────────────────────────────

async function iniciar(): Promise<void> {
  await cargarAjustes();
  await iniciarEventos();
  iniciarActualizador();
  const ultima = localStorage.getItem("ultima-novela");
  if (ultima) await abrir(ultima);
  else await irBiblioteca();
}

void iniciar();
