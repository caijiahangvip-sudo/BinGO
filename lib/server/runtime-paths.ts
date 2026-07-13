import path from 'path';

const RUNTIME_ROOT_ENV = 'BINGO_RUNTIME_ROOT';

export function getBingoRuntimeRoot(): string {
  const override = process.env[RUNTIME_ROOT_ENV]?.trim();
  if (override) {
    return path.resolve(override);
  }

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return path.join(localAppData, 'Bingo');
  }

  return path.join(process.cwd(), 'runtime-data');
}

export function getBingoDataRoot(): string {
  return path.join(getBingoRuntimeRoot(), 'data');
}

export function getBingoLogsRoot(): string {
  return path.join(getBingoRuntimeRoot(), 'logs');
}

export function getBingoServiceInstallDir(serviceName: 'CosyVoice' | 'SenseVoice' | 'MinerU'): string {
  return path.join(getBingoRuntimeRoot(), 'services', serviceName);
}

export function getBingoCachePaths() {
  const runtimeRoot = getBingoRuntimeRoot();
  const cacheRoot = path.join(runtimeRoot, 'cache');

  return {
    runtimeRoot,
    cacheRoot,
    dataRoot: path.join(runtimeRoot, 'data'),
    logsRoot: path.join(runtimeRoot, 'logs'),
    servicesRoot: path.join(runtimeRoot, 'services'),
    uvCacheDir: path.join(cacheRoot, 'uv'),
    uvPythonDir: path.join(cacheRoot, 'uv-python'),
    hfHome: path.join(cacheRoot, 'hf'),
    matplotlibDir: path.join(cacheRoot, 'matplotlib'),
    modelscopeDir: path.join(cacheRoot, 'modelscope'),
    torchHome: path.join(cacheRoot, 'torch'),
    xdgCacheDir: path.join(cacheRoot, 'xdg'),
  };
}
