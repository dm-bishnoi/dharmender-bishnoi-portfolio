/**
 * OpenRouter runtime configuration for the Angular app.
 *
 * Values are read from the build environment (e.g. via `fileReplacements`
 * in angular.json or `@angular/build`'s `define`/`envFile` support).
 * Falls back to safe defaults if not provided.
 *
 * NEVER hard-code real API keys here. The API key is read directly from
 * `process.env` / `globalThis` at runtime — never bundle it into the
 * client. For browser apps, route calls through a backend or a serverless
 * proxy; do not expose the key in shipped JS.
 */

export interface OpenRouterConfig {
  /** OpenRouter chat completions endpoint. */
  readonly apiUrl: string;

  /** Bearer token used to authenticate against OpenRouter. */
  readonly apiKey: string;

  /** Default model identifier (e.g. `openai/gpt-4o-mini`). */
  readonly defaultModel: string;

  /** Public site/app URL — sent as the `HTTP-Referer` header (required by OpenRouter). */
  readonly appUrl: string;

  /** Human-readable app name — sent as the `X-Title` header (optional, shown on openrouter.ai rankings). */
  readonly appName: string;
}

declare const process: { env: Record<string, string | undefined> };

/**
 * Resolve the runtime config from environment variables with safe fallbacks.
 * Adjust `readEnv` if you wire up a custom env loader (Angular `envFile`,
 * runtime config endpoint, etc.).
 */
function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process?.env) {
    return process.env[key];
  }
  return undefined;
}

export const OPENROUTER_CONFIG: OpenRouterConfig = {
  apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: readEnv('OPENROUTER_API_KEY') ?? '',
  defaultModel:
    readEnv('OPENROUTER_DEFAULT_MODEL') ?? 'openai/gpt-4o-mini',
  appUrl: readEnv('OPENROUTER_APP_URL') ?? 'http://localhost:4200',
  appName:
    readEnv('OPENROUTER_APP_NAME') ?? 'Dharmender Bishnoi Portfolio',
};

/**
 * Standard headers required by the OpenRouter API.
 * Reference: https://openrouter.ai/docs#request-headers
 */
export function buildOpenRouterHeaders(
  cfg: OpenRouterConfig = OPENROUTER_CONFIG
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (cfg.appUrl) headers['HTTP-Referer'] = cfg.appUrl;
  if (cfg.appName) headers['X-Title'] = cfg.appName;
  return headers;
}
