(() => {
  const CLOUD_API_KEY = 'bingo:ipad-cloud-api-base-url';
  const CLOUD_API_TOKEN_KEY = 'bingo:ipad-cloud-api-token';
  const CLOUD_APP_KEY = 'bingo:ipad-cloud-app-url';
  const status = document.querySelector('#status');
  const cloudApiForm = document.querySelector('#cloud-api-form');
  const cloudApiInput = document.querySelector('#cloud-api-url');
  const cloudApiTokenInput = document.querySelector('#cloud-api-token');
  const cloudAppInput = document.querySelector('#cloud-app-url');
  const openCloudAppButton = document.querySelector('#open-cloud-app');
  const clearCloudApiButton = document.querySelector('#clear-cloud-api');
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) status.textContent = 'BinGO iPad 本地运行时已就绪。';

  const configuredApiUrl =
    window.__BINGO_RUNTIME_CONFIG__?.apiBaseUrl || localStorage.getItem(CLOUD_API_KEY) || '';
  const configuredApiToken =
    window.__BINGO_RUNTIME_CONFIG__?.apiToken || localStorage.getItem(CLOUD_API_TOKEN_KEY) || '';
  const configuredAppUrl =
    window.__BINGO_RUNTIME_CONFIG__?.appUrl || localStorage.getItem(CLOUD_APP_KEY) || configuredApiUrl;
  cloudApiInput.value = configuredApiUrl;
  cloudApiTokenInput.value = configuredApiToken;
  cloudAppInput.value = configuredAppUrl;

  function getAppUrl() {
    return cloudAppInput.value.trim().replace(/\/+$/, '');
  }

  function openCloudApp() {
    const value = getAppUrl();
    if (!value) {
      status.classList.add('error');
      status.textContent = '请先填写 BinGO 云端页面地址。';
      return;
    }
    window.location.assign(value);
  }

  cloudApiForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = cloudApiInput.value.trim().replace(/\/+$/, '');
    if (!value) {
      localStorage.removeItem(CLOUD_API_KEY);
      localStorage.removeItem(CLOUD_API_TOKEN_KEY);
      localStorage.removeItem(CLOUD_APP_KEY);
      status.textContent = '已清除云端 API 地址。';
      return;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') throw new Error('云端地址必须使用 HTTPS');
      localStorage.setItem(CLOUD_API_KEY, value);
      const appUrl = getAppUrl();
      const appUrlObject = new URL(appUrl || value);
      if (appUrlObject.protocol !== 'https:') throw new Error('BinGO 页面地址必须使用 HTTPS');
      localStorage.setItem(CLOUD_APP_KEY, appUrl || value);
      if (cloudApiTokenInput.value.trim()) {
        localStorage.setItem(CLOUD_API_TOKEN_KEY, cloudApiTokenInput.value.trim());
      } else {
        localStorage.removeItem(CLOUD_API_TOKEN_KEY);
      }
      status.textContent = '云端 API 地址已保存；本地课堂功能不受影响。';
    } catch (error) {
      status.classList.add('error');
      status.textContent = `无法保存：${String(error)}`;
    }
  });

  openCloudAppButton.addEventListener('click', openCloudApp);

  clearCloudApiButton.addEventListener('click', () => {
    localStorage.removeItem(CLOUD_API_KEY);
    cloudApiInput.value = '';
    cloudAppInput.value = '';
    cloudApiTokenInput.value = '';
    localStorage.removeItem(CLOUD_API_TOKEN_KEY);
    status.classList.remove('error');
    status.textContent = '已切换为仅使用应用内供应商配置。';
  });
})();
