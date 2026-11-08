// Sin consola adicional en Windows en las versiones de lanzamiento.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod biblioteca;
mod claude;
mod llm;
mod update;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use biblioteca::{Biblioteca, ResumenNovela};

struct Estado {
    biblioteca: Biblioteca,
    procesos: claude::Procesos,
    llm: llm::Llm,
    datos_app: PathBuf,
    actualizador: update::Actualizador,
}

// ── Ajustes globales (JSON opaco que gestiona el frontend) ────────────────

#[tauri::command]
fn ajustes_leer(estado: State<Estado>) -> Option<String> {
    std::fs::read_to_string(estado.datos_app.join("ajustes.json")).ok()
}

#[tauri::command]
fn ajustes_guardar(estado: State<Estado>, json: String) -> Result<(), String> {
    biblioteca::escribir(&estado.datos_app.join("ajustes.json"), json.as_bytes())
}

// ── Biblioteca ───────────────────────────────────────────────────────────

#[tauri::command]
fn biblioteca_raiz(estado: State<Estado>) -> String {
    estado.biblioteca.raiz().to_string_lossy().to_string()
}

#[tauri::command]
fn biblioteca_fijar_raiz(estado: State<Estado>, ruta: String) -> Result<(), String> {
    estado.biblioteca.fijar_raiz(PathBuf::from(&ruta))?;
    biblioteca::escribir(&estado.datos_app.join("biblioteca.txt"), ruta.as_bytes())
}

#[tauri::command]
fn novelas_listar(estado: State<Estado>) -> Result<Vec<ResumenNovela>, String> {
    biblioteca::listar(&estado.biblioteca)
}

#[tauri::command]
fn novela_crear(estado: State<Estado>, titulo: String) -> Result<String, String> {
    biblioteca::crear(&estado.biblioteca, &titulo)
}

#[tauri::command]
fn novela_eliminar(estado: State<Estado>, carpeta: String) -> Result<(), String> {
    biblioteca::eliminar(&estado.biblioteca, &carpeta)
}

#[tauri::command]
fn novela_leer(estado: State<Estado>, carpeta: String) -> Result<BTreeMap<String, String>, String> {
    biblioteca::leer_todo(&estado.biblioteca, &carpeta)
}

#[tauri::command]
fn novela_ruta(estado: State<Estado>, carpeta: String) -> Result<String, String> {
    Ok(estado.biblioteca.carpeta(&carpeta)?.to_string_lossy().to_string())
}

#[tauri::command]
fn archivo_leer(estado: State<Estado>, carpeta: String, ruta: String) -> Result<Option<String>, String> {
    let p = estado.biblioteca.archivo(&carpeta, &ruta)?;
    if !p.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn archivo_escribir(estado: State<Estado>, carpeta: String, ruta: String, contenido: String) -> Result<(), String> {
    biblioteca::escribir(&estado.biblioteca.archivo(&carpeta, &ruta)?, contenido.as_bytes())
}

#[tauri::command]
fn archivo_borrar(estado: State<Estado>, carpeta: String, ruta: String) -> Result<(), String> {
    let p = estado.biblioteca.archivo(&carpeta, &ruta)?;
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else if p.exists() {
        std::fs::remove_file(&p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn archivo_listar(estado: State<Estado>, carpeta: String, sub: String) -> Result<Vec<String>, String> {
    biblioteca::listar_dir(&estado.biblioteca, &carpeta, &sub)
}

/// Exporta a una ruta absoluta elegida por el usuario en el diálogo de guardado.
#[tauri::command]
fn exportar_texto(ruta: String, contenido: String) -> Result<(), String> {
    biblioteca::escribir(&PathBuf::from(ruta), contenido.as_bytes())
}

#[tauri::command]
fn exportar_binario(ruta: String, bytes: Vec<u8>) -> Result<(), String> {
    biblioteca::escribir(&PathBuf::from(ruta), &bytes)
}

/// Lee un archivo externo elegido por el usuario (importación).
#[tauri::command]
fn externo_leer(ruta: String) -> Result<String, String> {
    std::fs::read_to_string(&ruta).map_err(|e| format!("No se pudo leer {ruta}: {e}"))
}

// ── Actualizaciones desde main ───────────────────────────────────────────

#[tauri::command]
fn update_info() -> Option<update::VersionInstalada> {
    update::version_instalada()
}

#[tauri::command]
fn update_channel() -> update::Canal {
    update::canal()
}

#[tauri::command]
fn update_state(estado: State<Estado>) -> update::Estado {
    estado.actualizador.estado()
}

/// Busca en segundo plano; el resultado llega con el evento `actualizacion`.
#[tauri::command]
fn update_check(estado: State<Estado>, install: bool) {
    estado.actualizador.buscar_ahora(install);
}

/// Cierra la app para que el instalador cambie a la versión nueva y la vuelva a abrir.
#[tauri::command]
fn update_apply(app: AppHandle, estado: State<Estado>) {
    estado.actualizador.aplicar();
    app.exit(0);
}

/// Actualizaciones automáticas activadas en ajustes.json (por defecto, sí).
fn auto_actualizar(datos_app: &std::path::Path) -> bool {
    std::fs::read_to_string(datos_app.join("ajustes.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("actualizacionesAuto").and_then(serde_json::Value::as_bool))
        .unwrap_or(true)
}

// ── Claude Code ──────────────────────────────────────────────────────────

#[tauri::command]
async fn claude_info(ruta: Option<String>) -> Result<claude::InfoClaude, String> {
    claude::info(ruta).await
}

/// Lanza claude. `carpeta` = novela (modo agente) o None (carpeta neutra para escritura).
#[tauri::command]
async fn claude_ejecutar(
    app: AppHandle,
    estado: State<'_, Estado>,
    id: String,
    args: Vec<String>,
    carpeta: Option<String>,
    entrada: String,
    ruta: Option<String>,
) -> Result<(), String> {
    let cwd = match carpeta {
        Some(c) => estado.biblioteca.carpeta(&c)?,
        None => estado.datos_app.join("claude-escritura"),
    };
    claude::ejecutar(app, &estado.procesos, id, args, cwd, entrada, ruta).await
}

#[tauri::command]
fn claude_cancelar(estado: State<Estado>, id: String) -> bool {
    claude::cancelar(&estado.procesos, &id)
}

// ── HTTP para proveedores de IA ──────────────────────────────────────────

#[tauri::command]
async fn llm_stream(
    app: AppHandle,
    estado: State<'_, Estado>,
    id: String,
    url: String,
    cabeceras: HashMap<String, String>,
    cuerpo: String,
) -> Result<(), String> {
    llm::stream(app, &estado.llm, id, url, cabeceras, cuerpo).await
}

#[tauri::command]
async fn llm_get(estado: State<'_, Estado>, url: String, cabeceras: HashMap<String, String>) -> Result<String, String> {
    llm::get(&estado.llm, url, cabeceras).await
}

#[tauri::command]
fn llm_cancelar(estado: State<Estado>, id: String) -> bool {
    llm::cancelar(&estado.llm, &id)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let datos_app = app.path().app_data_dir()?;
            std::fs::create_dir_all(&datos_app)?;
            // La raíz de la biblioteca se guarda aparte para poder leerla antes que los ajustes.
            let raiz = std::fs::read_to_string(datos_app.join("biblioteca.txt"))
                .ok()
                .map(|s| PathBuf::from(s.trim()))
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| {
                    app.path()
                        .document_dir()
                        .unwrap_or_else(|_| datos_app.clone())
                        .join("Open Novel")
                });
            let actualizador = update::Actualizador::default();
            let carpeta = datos_app.clone();
            actualizador.vigilar(app.handle().clone(), move || auto_actualizar(&carpeta));
            app.manage(Estado {
                biblioteca: Biblioteca::nueva(raiz),
                procesos: claude::Procesos::default(),
                llm: llm::Llm::nuevo()?,
                datos_app,
                actualizador,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ajustes_leer,
            ajustes_guardar,
            biblioteca_raiz,
            biblioteca_fijar_raiz,
            novelas_listar,
            novela_crear,
            novela_eliminar,
            novela_leer,
            novela_ruta,
            archivo_leer,
            archivo_escribir,
            archivo_borrar,
            archivo_listar,
            exportar_texto,
            exportar_binario,
            externo_leer,
            claude_info,
            claude_ejecutar,
            claude_cancelar,
            llm_stream,
            llm_get,
            llm_cancelar,
            update_info,
            update_channel,
            update_state,
            update_check,
            update_apply,
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Open Novel")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Estado>().actualizador.al_salir();
            }
        });
}
