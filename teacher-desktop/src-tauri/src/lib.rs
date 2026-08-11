#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .run(tauri::generate_context!())
    .expect("error while running BinGO Teacher");
}
