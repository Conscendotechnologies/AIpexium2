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

/** Token usage (+ cost in USD credits) reported by OpenRouter for one call. */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cost in USD (OpenRouter credits) — present when the account exposes it. */
  cost?: number;
}

/** A chat reply plus the usage/cost for that single call. */
export interface ChatReply {
  content: string;
  usage?: Usage;
}

/** Sends a chat completion and returns the assistant message content. */
export async function openRouterChat(opts: OpenRouterOptions): Promise<string> {
  return (await openRouterChatWithUsage(opts)).content;
}

/**
 * Like `openRouterChat` but also returns token usage + cost (asks OpenRouter to
 * include cost via `usage: { include: true }`). Used by the Apex generator to
 * surface tokens/credits per attempt in the panel.
 */
export function openRouterChatWithUsage(opts: OpenRouterOptions): Promise<ChatReply> {
  const body = JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 8000,
    // Ask OpenRouter to include cost (credits) in the usage object.
    usage: { include: true }
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
            resolve({ content, usage: parseUsage(json?.usage) });
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

/** Normalizes OpenRouter's usage object (OpenAI-compatible + optional cost). */
function parseUsage(u: any): Usage | undefined {
  if (!u || typeof u !== 'object') {
    return undefined;
  }
  return {
    promptTokens: Number(u.prompt_tokens ?? 0),
    completionTokens: Number(u.completion_tokens ?? 0),
    totalTokens: Number(u.total_tokens ?? 0),
    cost: typeof u.cost === 'number' ? u.cost : undefined
  };
}

function extractError(raw: string): string {
  try {
    return JSON.parse(raw)?.error?.message ?? raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

/** Strips ```js / ``` fences an LLM often wraps code in. */
/**
 * Extracts the code from a fenced block if the reply is wrapped in one. Handles
 * ANY language tag (```apex, ```java, ```js, or none) — matching only js/javascript
 * (the old behaviour) left Apex `​```apex` fences in the written .cls, causing
 * bogus compile errors. Falls back to the raw (trimmed) text when unfenced.
 */
export function stripCodeFence(s: string): string {
  const t = s.trim();
  // Prefer a fully-fenced block: optional lang tag on the opening fence.
  const full = t.match(/```[^\n`]*\n([\s\S]*?)```/);
  if (full) {
    return full[1].trim();
  }
  // Reply starts with a fence but the closing one is missing — strip the opener.
  if (t.startsWith('```')) {
    return t.replace(/^```[^\n`]*\n?/, '').replace(/```\s*$/, '').trim();
  }
  return t;
}
