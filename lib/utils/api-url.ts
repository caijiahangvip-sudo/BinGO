export function trimUrl(url?: string): string | undefined {
  const trimmed = url?.trim().replace(/\/+$/, '');
  return trimmed || undefined;
}

export function stripEndpointPath(
  url: string | undefined,
  endpointPaths: string[],
): string | undefined {
  const trimmed = trimUrl(url);
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  for (const endpointPath of endpointPaths) {
    const suffix = endpointPath.toLowerCase();
    if (lower.endsWith(suffix)) {
      return trimUrl(trimmed.slice(0, -endpointPath.length));
    }
  }
  return trimmed;
}

export function resolveEndpointUrl(
  configuredUrl: string | undefined,
  defaultBaseUrl: string | undefined,
  endpointPath: string,
): string {
  const configured = trimUrl(configuredUrl);
  if (configured?.toLowerCase().endsWith(endpointPath.toLowerCase())) {
    return configured;
  }

  const baseUrl = trimUrl(configured || defaultBaseUrl);
  if (!baseUrl) {
    throw new Error('API URL is required');
  }
  return `${baseUrl}${endpointPath}`;
}
