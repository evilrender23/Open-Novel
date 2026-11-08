// Peticiones HTTP a proveedores de IA (OpenAI, Anthropic, OpenRouter, Ollama…)
// hechas desde Rust para evitar CORS. El cuerpo de la respuesta se reenvía en
// trozos como `llm://datos`; el frontend interpreta el SSE de cada proveedor.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

pub struct Llm {
    cliente: reqwest::Client,
    cancelar: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl Llm {
    pub fn nuevo() -> Result<Self, String> {
        let cliente = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .user_agent("OpenNovel/0.1")
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { cliente, cancelar: Mutex::new(HashMap::new()) })
    }
}

#[derive(Serialize, Clone)]
struct Datos {
    id: String,
    texto: String,
}

#[derive(Serialize, Clone)]
struct Fin {
    id: String,
    estado: u16,
    error: Option<String>,
    cancelado: bool,
}

fn construir(llm: &Llm, metodo: &str, url: &str, cabeceras: &HashMap<String, String>) -> reqwest::RequestBuilder {
    let mut req = if metodo == "GET" { llm.cliente.get(url) } else { llm.cliente.post(url) };
    for (k, v) in cabeceras {
        req = req.header(k, v);
    }
    req
}

pub async fn stream(
    app: AppHandle,
    llm: &Llm,
    id: String,
    url: String,
    cabeceras: HashMap<String, String>,
    cuerpo: String,
) -> Result<(), String> {
    let (tx, mut rx) = oneshot::channel::<()>();
    llm.cancelar.lock().expect("llm").insert(id.clone(), tx);
    let peticion = construir(llm, "POST", &url, &cabeceras).body(cuerpo).send();

    let fin = |estado: u16, error: Option<String>, cancelado: bool| Fin { id: id.clone(), estado, error, cancelado };

    let resultado = tokio::select! {
        r = peticion => Some(r),
        _ = &mut rx => None,
    };
    let Some(resultado) = resultado else {
        llm.cancelar.lock().expect("llm").remove(&id);
        let _ = app.emit("llm://fin", fin(0, None, true));
        return Ok(());
    };
    let resp = match resultado {
        Ok(r) => r,
        Err(e) => {
            llm.cancelar.lock().expect("llm").remove(&id);
            let _ = app.emit("llm://fin", fin(0, Some(format!("Error de red: {e}")), false));
            return Ok(());
        }
    };
    let estado = resp.status().as_u16();
    if !resp.status().is_success() {
        let texto = resp.text().await.unwrap_or_default();
        llm.cancelar.lock().expect("llm").remove(&id);
        let _ = app.emit("llm://fin", fin(estado, Some(texto.chars().take(2000).collect()), false));
        return Ok(());
    }
    let mut cuerpo = resp.bytes_stream();
    let mut resto: Vec<u8> = Vec::new();
    let mut cancelado = false;
    loop {
        tokio::select! {
            trozo = cuerpo.next() => match trozo {
                Some(Ok(b)) => {
                    resto.extend_from_slice(&b);
                    // Solo se emite hasta el último carácter UTF-8 completo.
                    let corte = match std::str::from_utf8(&resto) {
                        Ok(_) => resto.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    if corte > 0 {
                        let texto = String::from_utf8_lossy(&resto[..corte]).to_string();
                        resto.drain(..corte);
                        let _ = app.emit("llm://datos", Datos { id: id.clone(), texto });
                    }
                }
                Some(Err(e)) => {
                    llm.cancelar.lock().expect("llm").remove(&id);
                    let _ = app.emit("llm://fin", fin(estado, Some(format!("Conexión interrumpida: {e}")), false));
                    return Ok(());
                }
                None => break,
            },
            _ = &mut rx => { cancelado = true; break; }
        }
    }
    llm.cancelar.lock().expect("llm").remove(&id);
    let _ = app.emit("llm://fin", fin(estado, None, cancelado));
    Ok(())
}

pub async fn get(llm: &Llm, url: String, cabeceras: HashMap<String, String>) -> Result<String, String> {
    let resp = construir(llm, "GET", &url, &cabeceras)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Error de red: {e}"))?;
    let estado = resp.status();
    let texto = resp.text().await.map_err(|e| e.to_string())?;
    if !estado.is_success() {
        return Err(format!("HTTP {}: {}", estado.as_u16(), texto.chars().take(400).collect::<String>()));
    }
    Ok(texto)
}

pub fn cancelar(llm: &Llm, id: &str) -> bool {
    match llm.cancelar.lock().expect("llm").remove(id) {
        Some(tx) => tx.send(()).is_ok(),
        None => false,
    }
}
