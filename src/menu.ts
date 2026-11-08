// Barra de menús nativa de macOS (Open Novel · Archivo · Edición · Novela ·
// Visualización · Ventana · Ayuda) en el idioma de la interfaz. Sustituye al
// menú genérico de Tauri (File, Edit, View…), que parecía el de un navegador.
// Los atajos del menú son los mismos que ya maneja la app con el teclado.

import { Menu, MenuItem, PredefinedMenuItem, Submenu, type MenuItemOptions } from "@tauri-apps/api/menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";

export interface AccionesMenu {
  hayNovela: () => boolean;
  ajustes: () => void;
  actualizaciones: () => void;
  acercaDe: () => void;
  nuevaNovela: () => void;
  importar: () => void;
  biblioteca: () => void;
  datosNovela: () => void;
  guardar: () => void;
  exportar: () => void;
  buscar: (accion: "buscar" | "reemplazar" | "siguiente" | "anterior") => void;
  paleta: () => void;
  ir: (vista: string) => void;
  modoFoco: () => void;
  modoLectura: () => void;
  tema: () => void;
}

const REPO = "https://github.com/evilrender23/Open-Novel";
let conNovela: MenuItem[] = [];

export function esMac(): boolean {
  return /Mac/i.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
}

export async function montarMenu(a: AccionesMenu, vistas: { vista: string; texto: string; atajo: string }[]): Promise<void> {
  if (!esMac() || !("__TAURI_INTERNALS__" in window)) return;
  conNovela = [];
  const item = async (texto: string, accion: () => void, atajo?: string, requiereNovela = false) => {
    const opciones: MenuItemOptions = { text: t(texto), action: () => accion() };
    if (atajo) opciones.accelerator = atajo;
    const m = await MenuItem.new(opciones);
    if (requiereNovela) conNovela.push(m);
    return m;
  };
  const sep = () => PredefinedMenuItem.new({ item: "Separator" });

  const app = await Submenu.new({
    text: "Open Novel",
    items: [
      await item("Acerca de Open Novel", a.acercaDe),
      await item("Buscar actualizaciones…", a.actualizaciones),
      await sep(),
      await item("Ajustes…", a.ajustes, "CmdOrCtrl+,"),
      await sep(),
      await PredefinedMenuItem.new({ item: "Services", text: t("Servicios") }),
      await sep(),
      await PredefinedMenuItem.new({ item: "Hide", text: t("Ocultar Open Novel") }),
      await PredefinedMenuItem.new({ item: "HideOthers", text: t("Ocultar otros") }),
      await PredefinedMenuItem.new({ item: "ShowAll", text: t("Mostrar todo") }),
      await sep(),
      await PredefinedMenuItem.new({ item: "Quit", text: t("Salir de Open Novel") }),
    ],
  });

  const archivo = await Submenu.new({
    text: t("Archivo"),
    items: [
      await item("Nueva novela…", a.nuevaNovela, "CmdOrCtrl+N"),
      await item("Importar…", a.importar),
      await item("Biblioteca", a.biblioteca, "CmdOrCtrl+Shift+L"),
      await sep(),
      await item("Guardar", a.guardar, "CmdOrCtrl+S", true),
      await item("Exportar…", a.exportar, "CmdOrCtrl+E", true),
      await sep(),
      await item("Datos de la novela…", a.datosNovela, undefined, true),
      await sep(),
      await PredefinedMenuItem.new({ item: "CloseWindow", text: t("Cerrar ventana") }),
    ],
  });

  const edicion = await Submenu.new({
    text: t("Edición"),
    items: [
      await PredefinedMenuItem.new({ item: "Undo", text: t("Deshacer") }),
      await PredefinedMenuItem.new({ item: "Redo", text: t("Rehacer") }),
      await sep(),
      await PredefinedMenuItem.new({ item: "Cut", text: t("Cortar") }),
      await PredefinedMenuItem.new({ item: "Copy", text: t("Copiar") }),
      await PredefinedMenuItem.new({ item: "Paste", text: t("Pegar") }),
      await PredefinedMenuItem.new({ item: "SelectAll", text: t("Seleccionar todo") }),
      await sep(),
      await Submenu.new({
        text: t("Buscar"),
        items: [
          await item("Buscar…", () => a.buscar("buscar"), "CmdOrCtrl+F", true),
          await item("Buscar y reemplazar…", () => a.buscar("reemplazar"), "CmdOrCtrl+Alt+F", true),
          await item("Buscar siguiente", () => a.buscar("siguiente"), "CmdOrCtrl+G", true),
          await item("Buscar anterior", () => a.buscar("anterior"), "CmdOrCtrl+Shift+G", true),
        ],
      }),
      await item("Ir a…", a.paleta, "CmdOrCtrl+K", true),
    ],
  });

  const novela = await Submenu.new({
    text: t("Novela"),
    items: await Promise.all(vistas.map((v) => item(v.texto, () => a.ir(v.vista), `CmdOrCtrl+${v.atajo}`, true))),
  });

  const ver = await Submenu.new({
    text: t("Visualización"),
    items: [
      await item("Modo foco", a.modoFoco, "CmdOrCtrl+Shift+F", true),
      await item("Modo lectura", a.modoLectura, undefined, true),
      await item("Cambiar tema claro/oscuro", a.tema),
      await sep(),
      await PredefinedMenuItem.new({ item: "Fullscreen", text: t("Pantalla completa") }),
    ],
  });

  const ventana = await Submenu.new({
    text: t("Ventana"),
    items: [
      await PredefinedMenuItem.new({ item: "Minimize", text: t("Minimizar") }),
      await PredefinedMenuItem.new({ item: "Maximize", text: t("Zoom") }),
      await sep(),
      await PredefinedMenuItem.new({ item: "BringAllToFront", text: t("Traer todo al frente") }),
    ],
  });

  const ayuda = await Submenu.new({
    text: t("Ayuda"),
    items: [
      await item("Página del proyecto", () => void openUrl(REPO)),
      await item("Informar de un problema", () => void openUrl(`${REPO}/issues`)),
    ],
  });

  const menu = await Menu.new({ items: [app, archivo, edicion, novela, ver, ventana, ayuda] });
  await menu.setAsAppMenu();
  await ventana.setAsWindowsMenuForNSApp();
  await ayuda.setAsHelpMenuForNSApp();
  await actualizarMenu(a.hayNovela());
}

/** Activa o desactiva lo que solo tiene sentido con una novela abierta. */
export async function actualizarMenu(hayNovela: boolean): Promise<void> {
  await Promise.all(conNovela.map((m) => m.setEnabled(hayNovela).catch(() => undefined)));
}
