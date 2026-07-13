use std::{
  fs::{self, File},
  net::{TcpListener, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

struct ServerProcess {
  child: Child,
  #[cfg(target_os = "windows")]
  job: windows_sys::Win32::Foundation::HANDLE,
}

unsafe impl Send for ServerProcess {}
struct ServerState(Mutex<Option<ServerProcess>>);

#[cfg(target_os = "windows")]
fn attach_kill_on_close_job(child: &Child) -> Result<windows_sys::Win32::Foundation::HANDLE, String> {
  use std::mem::{size_of, zeroed};
  use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::{
      JobObjects::{AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
      Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
  };
  unsafe {
    let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
    if job.is_null() { return Err("无法创建 Windows 子进程任务组".into()); }
    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info as *const _ as _, size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0 {
      CloseHandle(job); return Err("无法配置 Windows 子进程任务组".into());
    }
    let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, child.id());
    if process.is_null() { CloseHandle(job); return Err("无法打开本地服务进程".into()); }
    let assigned = AssignProcessToJobObject(job, process);
    CloseHandle(process);
    if assigned == 0 { CloseHandle(job); return Err("无法绑定本地服务进程".into()); }
    Ok(job)
  }
}

fn reserve_port() -> Result<u16, String> {
  let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
  listener.local_addr().map(|address| address.port()).map_err(|error| error.to_string())
}

fn create_log_file(path: &Path) -> Result<File, String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  File::create(path).map_err(|error| error.to_string())
}

fn wait_until_ready(port: u16, timeout: Duration) -> Result<(), String> {
  let started = Instant::now();
  while started.elapsed() < timeout {
    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
      return Ok(());
    }
    thread::sleep(Duration::from_millis(500));
  }
  Err("本地服务启动超时，请检查 BinGO 日志。".into())
}

fn runtime_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
  let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
  let data = app.path().local_data_dir().map_err(|error| error.to_string())?.join("BinGO-Data");
  Ok((resources.join("server"), resources.join("binaries").join("node.exe"), data))
}

fn stop_server(state: &ServerState) {
  if let Ok(mut guard) = state.0.lock() {
    if let Some(server) = guard.as_mut() {
      let _ = server.child.kill();
      let _ = server.child.wait();
      #[cfg(target_os = "windows")]
      unsafe { windows_sys::Win32::Foundation::CloseHandle(server.job); }
    }
    *guard = None;
  }
}

#[tauri::command]
async fn start_bingo_server(app: AppHandle) -> Result<(), String> {
  let state = app.state::<ServerState>();
  if state.0.lock().map_err(|_| "无法访问服务状态")?.is_some() {
    return Ok(());
  }
  let (server_dir, node_path, runtime_root) = runtime_paths(&app)?;
  let server_script = server_dir.join("server.js");
  if !node_path.exists() || !server_script.exists() {
    return Err("客户端运行文件不完整，请重新安装 BinGO。".into());
  }
  let port = reserve_port()?;
  let logs_dir = runtime_root.join("logs");
  let stdout = create_log_file(&logs_dir.join("desktop-server.log"))?;
  let stderr = create_log_file(&logs_dir.join("desktop-server.err.log"))?;
  let mut command = Command::new(node_path);
  command
    .arg("server.js")
    .current_dir(&server_dir)
    .env("NODE_ENV", "production")
    .env("HOSTNAME", "127.0.0.1")
    .env("PORT", port.to_string())
    .env("BINGO_RUNTIME_ROOT", &runtime_root)
    .env("BINGO_DESKTOP", "1")
    .env("npm_package_version", app.package_info().version.to_string())
    .stdin(Stdio::null())
    .stdout(Stdio::from(stdout))
    .stderr(Stdio::from(stderr));
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000);
  }
  let child = command.spawn().map_err(|error| format!("无法启动本地服务：{error}"))?;
  #[cfg(target_os = "windows")]
  let job = attach_kill_on_close_job(&child)?;
  *state.0.lock().map_err(|_| "无法保存服务状态")? = Some(ServerProcess {
    child,
    #[cfg(target_os = "windows")]
    job,
  });
  let app_url = format!("http://127.0.0.1:{port}");
  if let Err(error) = wait_until_ready(port, Duration::from_secs(120)) {
    stop_server(&state);
    return Err(error);
  }
  let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
  window.navigate(app_url.parse().map_err(|error| format!("无效地址：{error}"))?).map_err(|error| error.to_string())?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(ServerState(Mutex::new(None)))
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .invoke_handler(tauri::generate_handler![start_bingo_server])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        stop_server(&window.state::<ServerState>());
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running BinGO");
}
