// Integración con Claude Code CLI. Lanza `claude -p … --output-format stream-json`
// y reenvía cada línea JSON al frontend como evento `claude://linea`.
// Se usa tanto en el modo agente (con herramientas, dentro de la carpeta de la
// novela) como proveedor de texto para la escritura (sin herramientas).

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct Procesos {
    cancelar: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Serialize, Clone)]
struct Linea {
    id: String,
    linea: String,
}

#[derive(Serialize, Clone)]
struct Fin {
    id: String,
    codigo: Option<i32>,
    cancelado: bool,
    stderr: String,
}

#[derive(Serialize)]
pub struct InfoClaude {
    pub ruta: String,
    pub version: String,
}

/// PATH ampliado: las apps abiertas desde el Dock/Finder reciben un PATH mínimo.
pub fn path_ampliado() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for sub in [".local/bin", ".claude/local", ".bun/bin", ".npm-global/bin", ".local/node/bin", ".volta/bin", ".cargo/bin"] {
            dirs.push(home.join(sub));
        }
    }
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
        dirs.push(PathBuf::from(d));
    }
    if let Some(actual) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&actual));
    }
    let mut vistos = Vec::new();
    for d in dirs {
        if !vistos.contains(&d) {
            vistos.push(d);
        }
    }
    std::env::join_paths(vistos).map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

/// Ruta del ejecutable `claude`: la indicada en ajustes o la encontrada en el PATH ampliado.
pub fn localizar(personalizada: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = personalizada.map(str::trim).filter(|p| !p.is_empty()) {
        let ruta = PathBuf::from(p);
        return if ruta.exists() { Ok(ruta) } else { Err(format!("No existe el ejecutable indicado: {p}")) };
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    which::which_in("claude", Some(path_ampliado()), cwd).map_err(|_| {
        "No se encontró Claude Code CLI. Instálalo (https://docs.claude.com/claude-code) o indica su ruta en Ajustes.".to_string()
    })
}

pub async fn info(personalizada: Option<String>) -> Result<InfoClaude, String> {
    let ruta = localizar(personalizada.as_deref())?;
    let salida = Command::new(&ruta)
        .arg("--version")
        .env("PATH", path_ampliado())
        .output()
        .await
        .map_err(|e| format!("No se pudo ejecutar claude: {e}"))?;
    Ok(InfoClaude {
        ruta: ruta.to_string_lossy().to_string(),
        version: String::from_utf8_lossy(&salida.stdout).trim().to_string(),
    })
}

/// Ejecuta claude con `args`, enviando `entrada` por stdin (el prompt) y
/// emitiendo cada línea de stdout. Termina con `claude://fin`.
pub async fn ejecutar(
    app: AppHandle,
    procesos: &Procesos,
    id: String,
    args: Vec<String>,
    cwd: PathBuf,
    entrada: String,
    personalizada: Option<String>,
) -> Result<(), String> {
    let ruta = localizar(personalizada.as_deref())?;
    std::fs::create_dir_all(&cwd).map_err(|e| format!("No se pudo preparar la carpeta de trabajo: {e}"))?;
    let mut hijo = Command::new(&ruta)
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", path_ampliado())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("No se pudo iniciar claude: {e}"))?;

    if let Some(mut stdin) = hijo.stdin.take() {
        stdin.write_all(entrada.as_bytes()).await.map_err(|e| format!("No se pudo enviar el prompt: {e}"))?;
        drop(stdin);
    }
    let stdout = hijo.stdout.take().ok_or("Sin salida estándar")?;
    let mut stderr = hijo.stderr.take().ok_or("Sin salida de errores")?;

    let (tx, mut rx) = oneshot::channel::<()>();
    procesos.cancelar.lock().expect("procesos").insert(id.clone(), tx);

    let app_lineas = app.clone();
    let id_lineas = id.clone();
    let lector = tokio::spawn(async move {
        let mut lineas = BufReader::new(stdout).lines();
        while let Ok(Some(linea)) = lineas.next_line().await {
            if linea.trim().is_empty() {
                continue;
            }
            let _ = app_lineas.emit("claude://linea", Linea { id: id_lineas.clone(), linea });
        }
    });
    let lector_err = tokio::spawn(async move {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf).await;
        buf
    });

    let mut cancelado = false;
    let estado = tokio::select! {
        r = hijo.wait() => r.ok(),
        _ = &mut rx => {
            cancelado = true;
            let _ = hijo.kill().await;
            hijo.wait().await.ok()
        }
    };
    let _ = lector.await;
    let stderr = lector_err.await.unwrap_or_default();
    procesos.cancelar.lock().expect("procesos").remove(&id);
    let _ = app.emit(
        "claude://fin",
        Fin { id, codigo: estado.and_then(|s| s.code()), cancelado, stderr: stderr.chars().take(4000).collect() },
    );
    Ok(())
}

pub fn cancelar(procesos: &Procesos, id: &str) -> bool {
    match procesos.cancelar.lock().expect("procesos").remove(id) {
        Some(tx) => tx.send(()).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod pruebas {
    #[test]
    fn localiza_claude_en_path_ampliado() {
        // En la máquina de desarrollo claude está en ~/.local/bin; si no, al menos
        // la ruta personalizada inexistente debe dar un error claro.
        assert!(super::localizar(Some("/no/existe/claude")).is_err());
        if let Ok(r) = super::localizar(None) {
            assert!(r.ends_with("claude"));
        }
        assert!(super::path_ampliado().contains("/usr/bin"));
    }
}
