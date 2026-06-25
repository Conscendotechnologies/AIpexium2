/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as https from 'https';

/**
 * Minimal OpenRouter client (OpenAI-compatible chat/completions) over Node's
 * https — no dependencies. Lets SIID Forge make a DIRECT, deterministic LLM
 * call instead of delegating to the (unreliable) interactive agent. The key is
 * supplied by the caller (from Forge's own SecretStorage / settings).
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** 0–2; lower = more deterministic. Default 0.1 for codegen. */
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Sends a chat completion and returns the assistant message content. */
export function openRouterChat(opts: OpenRouterOptions): Promise<string> {
  const body = JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 8000
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          // OpenRouter attribution headers (optional but recommended).
          'HTTP-Referer': 'https://conscendo.tech/siid-forge',
          'X-Title': 'SIID Forge'
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`OpenRouter ${res.statusCode}: ${extractError(raw)}`));
            return;
          }
          try {
            const json = JSON.parse(raw);
            const content = json?.choices?.[0]?.message?.content;
            if (typeof content !== 'string') {
              reject(new Error('OpenRouter returned no message content.'));
              return;
            }
            resolve(content);
          } catch (e: any) {
            reject(new Error(`Failed to parse OpenRouter response: ${e?.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => req.destroy(new Error('Request cancelled.')), { once: true });
    }
    req.write(body);
    req.end();
  });
}

function extractError(raw: string): string {
  try {
    return JSON.parse(raw)?.error?.message ?? raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

/** Strips ```js / ``` fences an LLM often wraps code in. */
export function stripCodeFence(s: string): string {
  const m = s.match(/```(?:js|javascript)?\s*\n([\s\S]*?)\n```/);
  return (m ? m[1] : s).trim();
}
