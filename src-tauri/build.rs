fn main() {
    // 声明本应用自己的命令：只有在能力文件里明确授权的窗口才能调用。
    // 拼多多窗口（远程页面）的能力里只有「发事件」，调不到这些命令。
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "collector_status",
        "prepare_extension",
        "open_pdd",
        "call_pdd",
        "pdd_window_open",
        "clear_pdd_login",
    ])))
    .expect("构建失败");
}
