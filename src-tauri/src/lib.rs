// 1688→拼多多上架：本机采集接收服务 + 拼多多商家后台窗口。
// - 采集接收：只监听 127.0.0.1，接收浏览器插件发来的商品 JSON，先落盘到「收件箱」再通知主窗口入库。
// - 拼多多窗口：应用自带的窗口，登录状态只存在本应用里；窗口里的注入脚本只能向主窗口发事件。
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const INJECT: &str = include_str!("inject.js");
const PDD_WIN: &str = "pdd";
const PDD_HOME: &str = "https://mms.pinduoduo.com/goods/category";
const PORT: u16 = 48765;
const MAX_BODY: usize = 30 * 1024 * 1024;
const MAX_HEAD: usize = 64 * 1024;

/// 采集服务状态：空字符串表示正常，否则是失败原因（例如端口被占用）。
struct CollectorState(Mutex<String>);
static SEQ: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------------------
// 采集接收服务（原生 TCP，不引入额外依赖）
// ---------------------------------------------------------------------------

struct Request {
    method: String,
    path: String,
    origin: Option<String>,
    has_marker: bool,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end;
    loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            head_end = pos + 4;
            break;
        }
        if buf.len() > MAX_HEAD {
            return Err("请求头过大".into());
        }
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("连接提前关闭".into());
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_uppercase();
    let path = parts.next().unwrap_or("").split('?').next().unwrap_or("").to_string();
    let (mut origin, mut has_marker, mut len) = (None, false, 0usize);
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            let (k, v) = (k.trim().to_lowercase(), v.trim());
            match k.as_str() {
                "origin" => origin = Some(v.to_string()),
                "x-campfire-collector" => has_marker = true,
                "content-length" => len = v.parse().unwrap_or(0),
                _ => {}
            }
        }
    }
    if len > MAX_BODY {
        return Err("数据太大".into());
    }
    let mut body = buf[head_end..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Ok(Request { method, path, origin, has_marker, body })
}

fn respond(stream: &mut TcpStream, code: u16, origin_ok: Option<&str>, body: &str) {
    let reason = match code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Error",
    };
    let cors = match origin_ok {
        Some(o) => format!(
            "Access-Control-Allow-Origin: {o}\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Campfire-Collector\r\nVary: Origin\r\n"
        ),
        None => String::new(),
    };
    let msg = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json; charset=utf-8\r\n{cors}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(msg.as_bytes());
}

/// 只信任浏览器插件：浏览器里的网页发来的请求会带上网页自己的 Origin，一律拒绝。
/// 没有 Origin 的（命令行、本机其它程序）放行，它们本来就能直接读写本机文件。
fn origin_allowed(origin: &Option<String>) -> bool {
    match origin {
        None => true,
        Some(o) => o.starts_with("chrome-extension://") || o.starts_with("moz-extension://"),
    }
}

/// 接收服务和应用的接口：收到商品时通知主窗口、把窗口带到前面。单独成接口是为了测试时不用启动整个应用。
trait Hooks: Send + Sync {
    fn inbox_event(&self, name: &str);
    fn focus(&self);
}
struct AppHooks(AppHandle);
impl Hooks for AppHooks {
    fn inbox_event(&self, name: &str) {
        let _ = self.0.emit("collector-inbox", name.to_string());
    }
    fn focus(&self) {
        if let Some(w) = self.0.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

fn handle(hooks: &dyn Hooks, inbox: &Path, mut stream: TcpStream) {
    let req = match read_request(&mut stream) {
        Ok(r) => r,
        Err(e) => return respond(&mut stream, 400, None, &format!("{{\"success\":false,\"error\":\"{e}\"}}")),
    };
    if !origin_allowed(&req.origin) {
        return respond(&mut stream, 403, None, "{\"success\":false,\"error\":\"只接受浏览器插件发来的数据\"}");
    }
    let echo = req.origin.as_deref();
    match (req.method.as_str(), req.path.as_str()) {
        ("OPTIONS", _) => respond(&mut stream, 204, echo, ""),
        ("GET", "/health") | ("GET", "/") | ("GET", "/ping") => {
            respond(&mut stream, 200, echo, "{\"ok\":true,\"service\":\"campfire-1688-collector\"}")
        }
        ("GET", "/focus") => {
            if !req.has_marker {
                return respond(&mut stream, 403, echo, "{\"ok\":false}");
            }
            hooks.focus();
            respond(&mut stream, 200, echo, "{\"ok\":true,\"focused\":true}")
        }
        ("POST", "/collect") => {
            if !req.has_marker {
                return respond(&mut stream, 403, echo, "{\"success\":false,\"error\":\"缺少插件标记\"}");
            }
            let parsed: serde_json::Value = match serde_json::from_slice(&req.body) {
                Ok(v) => v,
                Err(e) => return respond(&mut stream, 400, echo, &format!("{{\"success\":false,\"error\":\"JSON 解析失败: {e}\"}}")),
            };
            let data = parsed.get("data").cloned().unwrap_or(parsed);
            let has_name = data.get("productName").and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false);
            if !has_name {
                return respond(&mut stream, 400, echo, "{\"success\":false,\"error\":\"无效的商品数据（缺 productName）\"}");
            }
            let name = format!(
                "{}-{}.json",
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0),
                SEQ.fetch_add(1, Ordering::Relaxed)
            );
            let file = inbox.join(&name);
            // 先写临时文件再改名，避免主窗口读到写了一半的文件
            let tmp = inbox.join(format!("{name}.part"));
            let ok = fs::write(&tmp, serde_json::to_vec(&data).unwrap_or_default()).and_then(|_| fs::rename(&tmp, &file));
            if let Err(e) = ok {
                return respond(&mut stream, 500, echo, &format!("{{\"success\":false,\"error\":\"落盘失败: {e}\"}}"));
            }
            hooks.inbox_event(&name);
            respond(&mut stream, 200, echo, &format!("{{\"success\":true,\"filename\":\"{name}\"}}"))
        }
        _ => respond(&mut stream, 404, echo, "{\"success\":false,\"error\":\"未知路径\"}"),
    }
}

fn serve(listener: TcpListener, hooks: Arc<dyn Hooks>, inbox: PathBuf) {
    for conn in listener.incoming().flatten() {
        let hooks = hooks.clone();
        let inbox = inbox.clone();
        std::thread::spawn(move || handle(hooks.as_ref(), &inbox, conn));
    }
}

fn start_collector(app: AppHandle) {
    let inbox = match app.path().app_data_dir() {
        Ok(d) => d.join("inbox"),
        Err(e) => {
            *app.state::<CollectorState>().0.lock().unwrap() = format!("找不到应用数据目录：{e}");
            return;
        }
    };
    let _ = fs::create_dir_all(&inbox);
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(l) => l,
        Err(e) => {
            *app.state::<CollectorState>().0.lock().unwrap() =
                format!("采集端口 {PORT} 打不开（多半是这个应用已经开着另一个窗口）：{e}");
            return;
        }
    };
    let hooks: Arc<dyn Hooks> = Arc::new(AppHooks(app));
    std::thread::spawn(move || serve(listener, hooks, inbox));
}

#[tauri::command]
fn collector_status(state: tauri::State<CollectorState>) -> Result<String, String> {
    let s = state.0.lock().map_err(|e| e.to_string())?.clone();
    if s.is_empty() { Ok(format!("http://127.0.0.1:{PORT}")) } else { Err(s) }
}

// ---------------------------------------------------------------------------
// 浏览器插件文件：从应用资源复制到用户数据目录里一个固定位置，浏览器只需加载一次
// ---------------------------------------------------------------------------

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if src.is_dir() { copy_dir(&src, &dst)?; } else { fs::copy(&src, &dst)?; }
    }
    Ok(())
}

#[tauri::command]
fn prepare_extension(app: AppHandle) -> Result<String, String> {
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(r) = app.path().resource_dir() {
        candidates.push(r.join("extension"));
        candidates.push(r.join("_up_").join("extension"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("extension"));
    let src = candidates.into_iter().find(|p| p.join("manifest.json").exists()).ok_or("找不到随应用打包的插件文件")?;
    let dst = app.path().app_data_dir().map_err(|e| e.to_string())?.join("campfire-extension");
    // 先清掉旧文件再复制，避免更新后残留已删除的脚本
    if dst.exists() { fs::remove_dir_all(&dst).map_err(|e| e.to_string())?; }
    copy_dir(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// 拼多多商家后台窗口
// ---------------------------------------------------------------------------

/// 打开（或带到前面）拼多多商家后台窗口。窗口用应用自己的浏览器数据，不读取、不同步本机 Chrome。
#[tauri::command]
fn open_pdd(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PDD_WIN) {
        w.show().map_err(|e| e.to_string())?;
        return w.set_focus().map_err(|e| e.to_string());
    }
    let url = PDD_HOME.parse().map_err(|e| format!("{e}"))?;
    WebviewWindowBuilder::new(&app, PDD_WIN, WebviewUrl::External(url))
        .title("拼多多商家后台（请在这里自己登录；验证码、滑块也由你自己处理）")
        .inner_size(1280.0, 860.0)
        .initialization_script(INJECT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 调用注入脚本里的 window.__campfire.dispatch(id, 函数名, 参数)。
/// 函数名只允许字母数字下划线，参数必须是合法 JSON，不会拼出任意脚本。
#[tauri::command]
fn call_pdd(app: AppHandle, call_id: String, func: String, args_json: String) -> Result<(), String> {
    if func.is_empty() || !func.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("函数名不合法".into());
    }
    let args: serde_json::Value = serde_json::from_str(&args_json).map_err(|e| format!("参数不是合法 JSON：{e}"))?;
    let w = app.get_webview_window(PDD_WIN).ok_or("还没有打开拼多多商家后台窗口")?;
    let script = format!(
        "window.__campfire&&window.__campfire.dispatch({},{},{})",
        serde_json::to_string(&call_id).map_err(|e| e.to_string())?,
        serde_json::to_string(&func).map_err(|e| e.to_string())?,
        serde_json::to_string(&args).map_err(|e| e.to_string())?
    );
    w.eval(&script).map_err(|e| e.to_string())
}

#[tauri::command]
fn pdd_window_open(app: AppHandle) -> bool {
    app.get_webview_window(PDD_WIN).is_some()
}

/// 清除该窗口里保存的登录状态（换账号用）。
#[tauri::command]
fn clear_pdd_login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PDD_WIN) {
        w.clear_all_browsing_data().map_err(|e| e.to_string())?;
        return w.close().map_err(|e| e.to_string());
    }
    let url = "about:blank".parse().map_err(|e| format!("{e}"))?;
    let w = WebviewWindowBuilder::new(&app, "pdd-clear", WebviewUrl::External(url))
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    w.clear_all_browsing_data().map_err(|e| e.to_string())?;
    w.close().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .manage(CollectorState(Mutex::new(String::new())))
        .setup(|app| {
            start_collector(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            collector_status,
            prepare_extension,
            open_pdd,
            call_pdd,
            pdd_window_open,
            clear_pdd_login
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    struct Rec(Mutex<Vec<String>>);
    impl Hooks for Rec {
        fn inbox_event(&self, name: &str) { self.0.lock().unwrap().push(format!("inbox:{name}")); }
        fn focus(&self) { self.0.lock().unwrap().push("focus".into()); }
    }

    /// 起一个真实的本机服务（端口由系统分配），返回地址、收件箱目录、记录
    fn start() -> (String, PathBuf, Arc<Rec>) {
        let dir = std::env::temp_dir().join(format!("campfire-inbox-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&dir).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let rec = Arc::new(Rec(Mutex::new(vec![])));
        let hooks: Arc<dyn Hooks> = rec.clone();
        let d2 = dir.clone();
        std::thread::spawn(move || serve(listener, hooks, d2));
        (addr, dir, rec)
    }

    fn send(addr: &str, req: &str) -> String {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }
    fn post(addr: &str, origin: Option<&str>, marker: bool, body: &str) -> String {
        let mut h = format!("POST /collect HTTP/1.1\r\nHost: {addr}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n", body.len());
        if let Some(o) = origin { h += &format!("Origin: {o}\r\n"); }
        if marker { h += "X-Campfire-Collector: 1\r\n"; }
        send(addr, &format!("{h}\r\n{body}"))
    }

    #[test]
    fn origin_rules() {
        assert!(origin_allowed(&None));
        assert!(origin_allowed(&Some("chrome-extension://abcdef".into())));
        assert!(!origin_allowed(&Some("https://evil.example".into())));
        assert!(!origin_allowed(&Some("http://127.0.0.1:3000".into())));
    }

    #[test]
    fn health_and_cors() {
        let (addr, _dir, _rec) = start();
        let r = send(&addr, &format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nOrigin: chrome-extension://abc\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        assert!(r.contains("Access-Control-Allow-Origin: chrome-extension://abc"));
        assert!(r.contains("campfire-1688-collector"));
        let r = send(&addr, &format!("OPTIONS /collect HTTP/1.1\r\nHost: {addr}\r\nOrigin: chrome-extension://abc\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 204") && r.contains("X-Campfire-Collector"), "{r}");
        // 网页发来的预检被拒绝，且不带跨域放行头
        let r = send(&addr, &format!("OPTIONS /collect HTTP/1.1\r\nHost: {addr}\r\nOrigin: https://evil.example\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 403") && !r.contains("Access-Control-Allow-Origin"), "{r}");
    }

    #[test]
    fn accepts_extension_post_and_writes_inbox() {
        let (addr, dir, rec) = start();
        let body = r#"{"data":{"productName":"示例 杯子","sourceUrl":"https://detail.1688.com/offer/1.html","skuList":[]}}"#;
        let r = post(&addr, Some("chrome-extension://abc"), true, body);
        assert!(r.starts_with("HTTP/1.1 200") && r.contains("\"success\":true"), "{r}");
        let files: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
        assert_eq!(files.len(), 1);
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(files[0].path()).unwrap()).unwrap();
        assert_eq!(saved["productName"], "示例 杯子");
        assert!(rec.0.lock().unwrap().iter().any(|x| x.starts_with("inbox:")));
        // 没有 Origin（命令行自测）带标记也可以
        assert!(post(&addr, None, true, body).starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn rejects_web_pages_missing_marker_and_bad_data() {
        let (addr, dir, rec) = start();
        let body = r#"{"data":{"productName":"示例"}}"#;
        assert!(post(&addr, Some("https://evil.example"), true, body).starts_with("HTTP/1.1 403"));
        assert!(post(&addr, Some("chrome-extension://abc"), false, body).starts_with("HTTP/1.1 403"));
        assert!(post(&addr, Some("chrome-extension://abc"), true, "不是 JSON").starts_with("HTTP/1.1 400"));
        assert!(post(&addr, Some("chrome-extension://abc"), true, r#"{"data":{"productName":"  "}}"#).starts_with("HTTP/1.1 400"));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        assert!(rec.0.lock().unwrap().is_empty());
        let r = send(&addr, &format!("GET /focus HTTP/1.1\r\nHost: {addr}\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 403"), "{r}");
        assert!(rec.0.lock().unwrap().is_empty());
        let r = send(&addr, &format!("GET /focus HTTP/1.1\r\nHost: {addr}\r\nX-Campfire-Collector: 1\r\n\r\n"));
        assert!(r.starts_with("HTTP/1.1 200"));
        assert_eq!(rec.0.lock().unwrap().as_slice(), ["focus"]);
    }

    #[test]
    fn large_body_in_several_reads() {
        let (addr, dir, _rec) = start();
        let big = "图".repeat(200_000);
        let body = format!(r#"{{"data":{{"productName":"示例","description":"{big}"}}}}"#);
        assert!(post(&addr, Some("chrome-extension://abc"), true, &body).starts_with("HTTP/1.1 200"));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn copy_dir_copies_nested_files() {
        let src = std::env::temp_dir().join(format!("campfire-src-{}", std::process::id()));
        let dst = std::env::temp_dir().join(format!("campfire-dst-{}", std::process::id()));
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst);
        fs::create_dir_all(src.join("a")).unwrap();
        fs::write(src.join("a/b.txt"), "x").unwrap();
        copy_dir(&src, &dst).unwrap();
        assert_eq!(fs::read_to_string(dst.join("a/b.txt")).unwrap(), "x");
    }
}
