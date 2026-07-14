use std::{
  fs::{self, File, OpenOptions},
  io::{Read, Write},
  net::{TcpListener, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use serde::Serialize;
use tauri::{AppHandle, Manager};

const SECRET_SCOPES: &[&str] = &[
  "llm",
  "lightweight-llm",
  "tts",
  "asr",
  "pdf",
  "vector",
  "web-search",
];

struct ServerProcess {
  child: Child,
  port: u16,
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

fn rotate_log(path: &Path) -> Result<(), String> {
  const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024;
  if fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0) < MAX_LOG_SIZE {
    return Ok(());
  }
  for generation in (1..=3).rev() {
    let source = if generation == 1 {
      path.to_path_buf()
    } else {
      PathBuf::from(format!("{}.{}", path.display(), generation - 1))
    };
    let destination = PathBuf::from(format!("{}.{}", path.display(), generation));
    if source.exists() {
      let _ = fs::remove_file(&destination);
      fs::rename(source, destination).map_err(|error| error.to_string())?;
    }
  }
  Ok(())
}

fn create_log_file(path: &Path) -> Result<File, String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }
  rotate_log(path)?;
  let mut file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
    .map_err(|error| error.to_string())?;
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs())
    .unwrap_or_default();
  writeln!(file, "\n--- BinGO desktop session {timestamp} ---")
    .map_err(|error| error.to_string())?;
  Ok(file)
}

fn desktop_session_token() -> Result<String, String> {
  let mut bytes = [0u8; 32];
  getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
  Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn health_is_ready(port: u16, token: &str, version: &str) -> bool {
  let Ok(mut stream) = TcpStream::connect_timeout(
    &format!("127.0.0.1:{port}").parse().expect("valid loopback address"),
    Duration::from_secs(1),
  ) else {
    return false;
  };
  let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
  let request = format!(
    "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
  );
  if stream.write_all(request.as_bytes()).is_err() {
    return false;
  }
  let mut response = String::new();
  if stream.read_to_string(&mut response).is_err() {
    return false;
  }
  response.starts_with("HTTP/1.1 200")
    && response.contains("\"status\":\"ok\"")
    && response.contains("\"desktop\":true")
    && response.contains(&format!("\"version\":\"{version}\""))
}

fn wait_until_ready(
  child: &mut Child,
  port: u16,
  token: &str,
  version: &str,
  timeout: Duration,
) -> Result<(), String> {
  let started = Instant::now();
  while started.elapsed() < timeout {
    if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
      return Err(format!("本地服务提前退出：{status}"));
    }
    if health_is_ready(port, token, version) {
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
fn desktop_system_proxy() -> Option<String> {
  #[cfg(target_os = "windows")]
  {
    return windows_system_proxy();
  }
  #[cfg(not(target_os = "windows"))]
  None
}

fn normalize_proxy_address(value: &str) -> Option<String> {
  let address = value.split(';').map(str::trim).find_map(|entry| {
    if entry.is_empty() || entry.eq_ignore_ascii_case("direct") {
      return None;
    }
    let without_kind = entry
      .strip_prefix("PROXY ")
      .or_else(|| entry.strip_prefix("proxy "))
      .or_else(|| entry.strip_prefix("HTTPS "))
      .or_else(|| entry.strip_prefix("HTTP "))
      .unwrap_or(entry);
    Some(
      without_kind
        .strip_prefix("https=")
        .or_else(|| without_kind.strip_prefix("http="))
        .unwrap_or(without_kind),
    )
  })?;
  Some(if address.contains("://") {
    address.to_string()
  } else {
    format!("http://{address}")
  })
}

#[cfg(target_os = "windows")]
unsafe fn wide_ptr_to_string(value: windows_sys::core::PWSTR) -> Option<String> {
  if value.is_null() {
    return None;
  }
  let mut length = 0;
  while *value.add(length) != 0 {
    length += 1;
  }
  String::from_utf16(std::slice::from_raw_parts(value, length)).ok()
}

#[cfg(target_os = "windows")]
fn windows_system_proxy() -> Option<String> {
  use std::ptr::null;
  use windows_sys::Win32::{
    Foundation::GlobalFree,
    Networking::WinHttp::{
      WinHttpCloseHandle, WinHttpGetDefaultProxyConfiguration,
      WinHttpGetIEProxyConfigForCurrentUser, WinHttpGetProxyForUrl, WinHttpOpen,
      WINHTTP_ACCESS_TYPE_NAMED_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY,
      WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL,
      WINHTTP_AUTOPROXY_OPTIONS, WINHTTP_AUTO_DETECT_TYPE_DHCP,
      WINHTTP_AUTO_DETECT_TYPE_DNS_A, WINHTTP_CURRENT_USER_IE_PROXY_CONFIG,
      WINHTTP_PROXY_INFO,
    },
  };

  unsafe {
    let mut config = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
    if WinHttpGetIEProxyConfigForCurrentUser(&mut config) != 0 {
      let static_proxy = wide_ptr_to_string(config.lpszProxy)
        .and_then(|value| normalize_proxy_address(&value));
      if static_proxy.is_some() {
        GlobalFree(config.lpszAutoConfigUrl as _);
        GlobalFree(config.lpszProxy as _);
        GlobalFree(config.lpszProxyBypass as _);
        return static_proxy;
      }

      if config.fAutoDetect != 0 || !config.lpszAutoConfigUrl.is_null() {
        let agent = wide_null("BinGO Desktop Updater");
        let session = WinHttpOpen(agent.as_ptr(), WINHTTP_ACCESS_TYPE_NO_PROXY, null(), null(), 0);
        if !session.is_null() {
          let mut options = WINHTTP_AUTOPROXY_OPTIONS::default();
          if config.fAutoDetect != 0 {
            options.dwFlags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
            options.dwAutoDetectFlags =
              WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
          }
          if !config.lpszAutoConfigUrl.is_null() {
            options.dwFlags |= WINHTTP_AUTOPROXY_CONFIG_URL;
            options.lpszAutoConfigUrl = config.lpszAutoConfigUrl;
          }
          options.fAutoLogonIfChallenged = 1;
          let update_url = wide_null("https://github.com/");
          let mut proxy_info = WINHTTP_PROXY_INFO::default();
          let resolved = if WinHttpGetProxyForUrl(
            session,
            update_url.as_ptr(),
            &mut options,
            &mut proxy_info,
          ) != 0
          {
            wide_ptr_to_string(proxy_info.lpszProxy)
              .and_then(|value| normalize_proxy_address(&value))
          } else {
            None
          };
          GlobalFree(proxy_info.lpszProxy as _);
          GlobalFree(proxy_info.lpszProxyBypass as _);
          WinHttpCloseHandle(session);
          if resolved.is_some() {
            GlobalFree(config.lpszAutoConfigUrl as _);
            GlobalFree(config.lpszProxy as _);
            GlobalFree(config.lpszProxyBypass as _);
            return resolved;
          }
        }
      }
      GlobalFree(config.lpszAutoConfigUrl as _);
      GlobalFree(config.lpszProxy as _);
      GlobalFree(config.lpszProxyBypass as _);
    }

    let mut proxy_info = WINHTTP_PROXY_INFO::default();
    if WinHttpGetDefaultProxyConfiguration(&mut proxy_info) != 0
      && proxy_info.dwAccessType == WINHTTP_ACCESS_TYPE_NAMED_PROXY
    {
      let proxy = wide_ptr_to_string(proxy_info.lpszProxy)
        .and_then(|value| normalize_proxy_address(&value));
      GlobalFree(proxy_info.lpszProxy as _);
      GlobalFree(proxy_info.lpszProxyBypass as _);
      return proxy;
    }
    None
  }
}

fn secret_target(scope: &str, provider_id: &str) -> Result<String, String> {
  if !SECRET_SCOPES.contains(&scope) {
    return Err("不支持的密钥类型".into());
  }
  if provider_id.is_empty()
    || !provider_id
      .chars()
      .all(|character| character.is_ascii_alphanumeric() || ".:_-".contains(character))
  {
    return Err("无效的服务商标识".into());
  }
  Ok(format!("BinGO/{scope}/{provider_id}"))
}

#[cfg(test)]
mod tests {
  use super::{normalize_proxy_address, secret_target};

  #[test]
  fn validates_secret_targets() {
    assert_eq!(
      secret_target("llm", "openai-compatible").unwrap(),
      "BinGO/llm/openai-compatible"
    );
    assert!(secret_target("unknown", "openai").is_err());
    assert!(secret_target("llm", "").is_err());
    assert!(secret_target("llm", "../openai").is_err());
    assert!(secret_target("llm", "openai key").is_err());
  }

  #[test]
  fn normalizes_windows_proxy_formats() {
    assert_eq!(
      normalize_proxy_address("127.0.0.1:7897").as_deref(),
      Some("http://127.0.0.1:7897")
    );
    assert_eq!(
      normalize_proxy_address("https=proxy.example:443;http=proxy.example:80").as_deref(),
      Some("http://proxy.example:443")
    );
    assert_eq!(
      normalize_proxy_address("PROXY proxy.example:8080; DIRECT").as_deref(),
      Some("http://proxy.example:8080")
    );
    assert_eq!(normalize_proxy_address("DIRECT"), None);
  }
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
  use std::os::windows::ffi::OsStrExt;
  std::ffi::OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[tauri::command]
fn desktop_secret_read(scope: String, provider_id: String) -> Result<Option<String>, String> {
  #[cfg(target_os = "windows")]
  {
    use std::{ptr::null_mut, slice};
    use windows_sys::Win32::{
      Foundation::{GetLastError, ERROR_NOT_FOUND},
      Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC},
    };
    let target = wide_null(&secret_target(&scope, &provider_id)?);
    let mut credential: *mut CREDENTIALW = null_mut();
    unsafe {
      if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
        let error = GetLastError();
        return if error == ERROR_NOT_FOUND {
          Ok(None)
        } else {
          Err(format!("读取 Windows 凭据失败：{error}"))
        };
      }
      let value_result = if (*credential).CredentialBlobSize == 0 {
        Ok(String::new())
      } else {
        let bytes = slice::from_raw_parts(
          (*credential).CredentialBlob,
          (*credential).CredentialBlobSize as usize,
        );
        String::from_utf8(bytes.to_vec()).map_err(|_| "Windows 凭据内容格式无效".to_string())
      };
      CredFree(credential as _);
      Ok(Some(value_result?))
    }
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = (scope, provider_id);
    Err("安全密钥存储仅支持 Windows 客户端".into())
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeStatus {
  running: bool,
  port: Option<u16>,
  version: String,
  log_dir: String,
}

#[tauri::command]
fn desktop_runtime_status(app: AppHandle) -> Result<DesktopRuntimeStatus, String> {
  let (_, _, runtime_root) = runtime_paths(&app)?;
  let state = app.state::<ServerState>();
  let guard = state.0.lock().map_err(|_| "无法访问服务状态")?;
  Ok(DesktopRuntimeStatus {
    running: guard.is_some(),
    port: guard.as_ref().map(|server| server.port),
    version: app.package_info().version.to_string(),
    log_dir: runtime_root.join("logs").display().to_string(),
  })
}

#[tauri::command]
fn desktop_open_log_dir(app: AppHandle) -> Result<(), String> {
  let (_, _, runtime_root) = runtime_paths(&app)?;
  let log_dir = runtime_root.join("logs");
  fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
  Command::new("explorer.exe")
    .arg(log_dir)
    .spawn()
    .map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
fn desktop_secret_write(scope: String, provider_id: String, value: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::{
      Foundation::GetLastError,
      Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
      },
    };
    let mut target = wide_null(&secret_target(&scope, &provider_id)?);
    let mut username = wide_null("BinGO");
    let mut blob = value.into_bytes();
    let mut credential = CREDENTIALW {
      Type: CRED_TYPE_GENERIC,
      TargetName: target.as_mut_ptr(),
      CredentialBlobSize: blob.len() as u32,
      CredentialBlob: blob.as_mut_ptr(),
      Persist: CRED_PERSIST_LOCAL_MACHINE,
      UserName: username.as_mut_ptr(),
      ..Default::default()
    };
    unsafe {
      if CredWriteW(&mut credential, 0) == 0 {
        return Err(format!("写入 Windows 凭据失败：{}", GetLastError()));
      }
    }
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = (scope, provider_id, value);
    Err("安全密钥存储仅支持 Windows 客户端".into())
  }
}

#[tauri::command]
fn desktop_secret_delete(scope: String, provider_id: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::{
      Foundation::{GetLastError, ERROR_NOT_FOUND},
      Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
    };
    let target = wide_null(&secret_target(&scope, &provider_id)?);
    unsafe {
      if CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) == 0 {
        let error = GetLastError();
        if error != ERROR_NOT_FOUND {
          return Err(format!("删除 Windows 凭据失败：{error}"));
        }
      }
    }
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = (scope, provider_id);
    Err("安全密钥存储仅支持 Windows 客户端".into())
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
  let version = app.package_info().version.to_string();
  let logs_dir = runtime_root.join("logs");
  let mut started_server = None;
  let mut last_error = String::from("本地服务启动失败");
  for _attempt in 1..=5 {
    let port = reserve_port()?;
    let session_token = desktop_session_token()?;
    let stdout = create_log_file(&logs_dir.join("desktop-server.log"))?;
    let stderr = create_log_file(&logs_dir.join("desktop-server.err.log"))?;
    let mut command = Command::new(&node_path);
    command
      .arg("server.js")
      .current_dir(&server_dir)
      .env("NODE_ENV", "production")
      .env("HOSTNAME", "127.0.0.1")
      .env("PORT", port.to_string())
      .env("BINGO_RUNTIME_ROOT", &runtime_root)
      .env("BINGO_DESKTOP", "1")
      .env("BINGO_DESKTOP_TOKEN", &session_token)
      .env("npm_package_version", &version)
      .stdin(Stdio::null())
      .stdout(Stdio::from(stdout))
      .stderr(Stdio::from(stderr));
    #[cfg(target_os = "windows")]
    {
      use std::os::windows::process::CommandExt;
      command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|error| format!("无法启动本地服务：{error}"))?;
    #[cfg(target_os = "windows")]
    let job = attach_kill_on_close_job(&child)?;
    match wait_until_ready(
      &mut child,
      port,
      &session_token,
      &version,
      Duration::from_secs(24),
    ) {
      Ok(()) => {
        started_server = Some((child, port, session_token, job));
        break;
      }
      Err(error) => {
        last_error = error;
        let _ = child.kill();
        let _ = child.wait();
        #[cfg(target_os = "windows")]
        unsafe { windows_sys::Win32::Foundation::CloseHandle(job); }
      }
    }
  }
  let (child, port, session_token, job) = started_server.ok_or(last_error)?;
  *state.0.lock().map_err(|_| "无法保存服务状态")? = Some(ServerProcess {
    child,
    port,
    #[cfg(target_os = "windows")]
    job,
  });
  let app_url = format!("http://127.0.0.1:{port}/#desktopToken={session_token}");
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
    .invoke_handler(tauri::generate_handler![
      start_bingo_server,
      desktop_system_proxy,
      desktop_secret_read,
      desktop_secret_write,
      desktop_secret_delete,
      desktop_runtime_status,
      desktop_open_log_dir
    ])
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
