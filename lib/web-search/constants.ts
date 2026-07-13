/**
 * Web Search Provider Constants
 */

import type {
  BuiltInWebSearchProviderId,
  WebSearchProviderConfig,
} from './types';

/**
 * Web Search Provider Registry
 */
export const WEB_SEARCH_PROVIDERS: Record<BuiltInWebSearchProviderId, WebSearchProviderConfig> &
  Record<string, WebSearchProviderConfig> = {
  tavily: {
    id: 'tavily',
    name: 'Tavily',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.tavily.com',
  },
};

/**
 * Get all available web search providers
 */
export function getAllWebSearchProviders(): WebSearchProviderConfig[] {
  return Object.values(WEB_SEARCH_PROVIDERS);
}
