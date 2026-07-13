/**
 * Web Search Provider Type Definitions
 */

/**
 * Web Search Provider IDs
 */
export type BuiltInWebSearchProviderId = 'tavily';
export type WebSearchProviderId = BuiltInWebSearchProviderId | (string & {});

/**
 * Web Search Provider Configuration
 */
export interface WebSearchProviderConfig {
  id: WebSearchProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  icon?: string;
}
