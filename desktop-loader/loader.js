const { invoke } = window.__TAURI_INTERNALS__;
const progress = document.querySelector('#progress');
const error = document.querySelector('#error');
const gear = document.querySelector('#gear');
const retry = document.querySelector('#retry');

async function start() {
  let percent = 0;
  progress.textContent = '正在启动 0%';
  error.style.display = 'none';
  retry.style.display = 'none';
  gear.style.display = 'block';
  const timer = window.setInterval(() => {
    percent = Math.min(95, percent + 5);
    progress.textContent = `正在启动 ${percent}%`;
  }, 600);
  try {
    await invoke('start_bingo_server');
  } catch (reason) {
    window.clearInterval(timer);
    progress.textContent = '启动失败';
    error.textContent = String(reason);
    error.style.display = 'block';
    retry.style.display = 'block';
    gear.style.display = 'none';
  }
}

retry.addEventListener('click', start);
void start();
