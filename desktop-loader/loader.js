const { invoke } = window.__TAURI_INTERNALS__;
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const spinner = document.querySelector('#spinner');
const retry = document.querySelector('#retry');

async function start() {
  status.textContent = '正在启动本地教学服务，请稍候…';
  error.style.display = 'none';
  retry.style.display = 'none';
  spinner.style.display = 'block';
  try {
    await invoke('start_bingo_server');
  } catch (reason) {
    status.textContent = 'BinGO 启动失败';
    error.textContent = String(reason);
    error.style.display = 'block';
    retry.style.display = 'block';
    spinner.style.display = 'none';
  }
}

retry.addEventListener('click', start);
void start();
