// Biblioteca de novelas en disco. Cada novela es una carpeta con archivos de
// texto legibles (Markdown + JSON), de modo que el usuario, Git o el agente de
// Claude Code puedan leerlos y editarlos directamente.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// Carpetas internas que no forman parte del contenido cargado en memoria.
const IGNORADAS: &[&str] = &[".git", ".papelera", "historial", "node_modules", ".claude"];
/// Límite de tamaño por archivo de texto cargado (8 MiB).
const MAX_ARCHIVO: u64 = 8 * 1024 * 1024;

pub struct Biblioteca {
    raiz: Mutex<PathBuf>,
}

impl Biblioteca {
    pub fn nueva(raiz: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&raiz);
        Self { raiz: Mutex::new(raiz) }
    }

    pub fn raiz(&self) -> PathBuf {
        self.raiz.lock().expect("raíz bloqueada").clone()
    }

    pub fn fijar_raiz(&self, nueva: PathBuf) -> Result<(), String> {
        std::fs::create_dir_all(&nueva).map_err(|e| format!("No se pudo crear la carpeta de la biblioteca: {e}"))?;
        *self.raiz.lock().expect("raíz bloqueada") = nueva;
        Ok(())
    }

    /// Ruta absoluta de una novela; rechaza nombres que escapen de la biblioteca.
    pub fn carpeta(&self, carpeta: &str) -> Result<PathBuf, String> {
        let rel = segura(carpeta)?;
        if rel.components().count() != 1 {
            return Err("Nombre de carpeta de novela no válido".into());
        }
        Ok(self.raiz().join(rel))
    }

    /// Ruta absoluta de un archivo dentro de una novela.
    pub fn archivo(&self, carpeta: &str, ruta: &str) -> Result<PathBuf, String> {
        Ok(self.carpeta(carpeta)?.join(segura(ruta)?))
    }
}

/// Convierte una ruta relativa en segura: sin componentes absolutos ni `..`.
fn segura(ruta: &str) -> Result<PathBuf, String> {
    let p = Path::new(ruta);
    let mut limpia = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => limpia.push(s),
            Component::CurDir => {}
            _ => return Err(format!("Ruta no permitida: {ruta}")),
        }
    }
    if limpia.as_os_str().is_empty() {
        return Err("Ruta vacía".into());
    }
    Ok(limpia)
}

fn ahora_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// Nombre de carpeta a partir de un título: sin caracteres problemáticos.
pub fn slug(titulo: &str) -> String {
    let mut s: String = titulo
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if s.is_empty() {
        s = "Novela".into();
    }
    s.chars().take(60).collect()
}

#[derive(Serialize)]
pub struct ResumenNovela {
    pub carpeta: String,
    pub ruta: String,
    /// Contenido de `novela.json` (sin interpretar).
    pub meta: Option<String>,
    pub modificado: u128,
}

pub fn listar(b: &Biblioteca) -> Result<Vec<ResumenNovela>, String> {
    let raiz = b.raiz();
    let mut out = Vec::new();
    let leer = std::fs::read_dir(&raiz).map_err(|e| format!("No se pudo leer la biblioteca: {e}"))?;
    for ent in leer.flatten() {
        let ruta = ent.path();
        let nombre = ent.file_name().to_string_lossy().to_string();
        if !ruta.is_dir() || nombre.starts_with('.') {
            continue;
        }
        let meta_ruta = ruta.join("novela.json");
        if !meta_ruta.exists() {
            continue;
        }
        let modificado = std::fs::metadata(&meta_ruta)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        out.push(ResumenNovela {
            carpeta: nombre,
            ruta: ruta.to_string_lossy().to_string(),
            meta: std::fs::read_to_string(&meta_ruta).ok(),
            modificado,
        });
    }
    out.sort_by(|a, b| b.modificado.cmp(&a.modificado));
    Ok(out)
}

/// Crea una carpeta nueva con nombre único y devuelve su nombre.
pub fn crear(b: &Biblioteca, titulo: &str) -> Result<String, String> {
    let base = slug(titulo);
    let raiz = b.raiz();
    let mut nombre = base.clone();
    let mut n = 2;
    while raiz.join(&nombre).exists() {
        nombre = format!("{base} {n}");
        n += 1;
    }
    std::fs::create_dir_all(raiz.join(&nombre)).map_err(|e| format!("No se pudo crear la novela: {e}"))?;
    Ok(nombre)
}

/// Mueve la novela a `.papelera` dentro de la biblioteca (recuperable a mano).
pub fn eliminar(b: &Biblioteca, carpeta: &str) -> Result<(), String> {
    let origen = b.carpeta(carpeta)?;
    let papelera = b.raiz().join(".papelera");
    std::fs::create_dir_all(&papelera).map_err(|e| e.to_string())?;
    let destino = papelera.join(format!("{carpeta}-{}", ahora_ms()));
    std::fs::rename(&origen, &destino).map_err(|e| format!("No se pudo mover a la papelera: {e}"))
}

/// Lee todos los archivos de texto de la novela (ruta relativa → contenido).
pub fn leer_todo(b: &Biblioteca, carpeta: &str) -> Result<BTreeMap<String, String>, String> {
    let base = b.carpeta(carpeta)?;
    if !base.join("novela.json").exists() {
        return Err("La carpeta no contiene una novela (falta novela.json)".into());
    }
    let mut out = BTreeMap::new();
    recorrer(&base, &base, &mut out);
    Ok(out)
}

fn recorrer(base: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
    let Ok(leer) = std::fs::read_dir(dir) else { return };
    for ent in leer.flatten() {
        let ruta = ent.path();
        let nombre = ent.file_name().to_string_lossy().to_string();
        if ruta.is_dir() {
            if IGNORADAS.contains(&nombre.as_str()) || nombre.starts_with('.') {
                continue;
            }
            recorrer(base, &ruta, out);
            continue;
        }
        let ext = ruta.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "md" | "json" | "txt") {
            continue;
        }
        if ent.metadata().map(|m| m.len() > MAX_ARCHIVO).unwrap_or(true) {
            continue;
        }
        if let (Ok(rel), Ok(texto)) = (ruta.strip_prefix(base), std::fs::read_to_string(&ruta)) {
            out.insert(rel.to_string_lossy().replace('\\', "/"), texto);
        }
    }
}

/// Escritura atómica: archivo temporal + renombrado.
pub fn escribir(ruta: &Path, contenido: &[u8]) -> Result<(), String> {
    if let Some(dir) = ruta.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    }
    let tmp = ruta.with_extension(format!("tmp-{}", ahora_ms()));
    std::fs::write(&tmp, contenido).map_err(|e| format!("No se pudo escribir {}: {e}", ruta.display()))?;
    std::fs::rename(&tmp, ruta).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("No se pudo guardar {}: {e}", ruta.display())
    })
}

/// Lista archivos (rutas relativas) de un subdirectorio de la novela, incluso los ignorados.
pub fn listar_dir(b: &Biblioteca, carpeta: &str, sub: &str) -> Result<Vec<String>, String> {
    let base = b.carpeta(carpeta)?;
    let dir = base.join(segura(sub)?);
    let mut out = Vec::new();
    if let Ok(leer) = std::fs::read_dir(&dir) {
        for ent in leer.flatten() {
            if ent.path().is_file() {
                if let Ok(rel) = ent.path().strip_prefix(&base) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn temporal() -> PathBuf {
        let d = std::env::temp_dir().join(format!("open-novel-test-{}", ahora_ms()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn rutas_seguras() {
        assert!(segura("../fuera").is_err());
        assert!(segura("/etc/passwd").is_err());
        assert!(segura("").is_err());
        assert_eq!(segura("escenas/./e1.md").unwrap(), PathBuf::from("escenas/e1.md"));
    }

    #[test]
    fn ciclo_completo() {
        let b = Biblioteca::nueva(temporal());
        let c = crear(&b, "Mi novela: «prueba»").unwrap();
        assert_eq!(c, "Mi novela prueba");
        assert_eq!(crear(&b, "Mi novela: «prueba»").unwrap(), "Mi novela prueba 2");
        assert!(b.carpeta("a/b").is_err());
        escribir(&b.archivo(&c, "novela.json").unwrap(), b"{\"titulo\":\"X\"}").unwrap();
        escribir(&b.archivo(&c, "escenas/e1.md").unwrap(), "Hola".as_bytes()).unwrap();
        escribir(&b.archivo(&c, "historial/e1/1-manual.md").unwrap(), b"viejo").unwrap();
        let todo = leer_todo(&b, &c).unwrap();
        assert_eq!(todo.get("escenas/e1.md").map(String::as_str), Some("Hola"));
        assert!(!todo.contains_key("historial/e1/1-manual.md"), "el historial no se carga");
        assert_eq!(listar_dir(&b, &c, "historial/e1").unwrap(), vec!["historial/e1/1-manual.md"]);
        let lista = listar(&b).unwrap();
        assert_eq!(lista.len(), 1, "solo cuenta carpetas con novela.json");
        eliminar(&b, &c).unwrap();
        assert!(listar(&b).unwrap().is_empty());
        assert!(b.raiz().join(".papelera").read_dir().unwrap().next().is_some());
    }
}
