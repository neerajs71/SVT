import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { SYSTEM_PROMPT } from '$lib/ai/systemPrompt.js';

export async function POST({ request }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw error(500, 'ANTHROPIC_API_KEY is not configured');

  let messages;
  try {
    ({ messages } = await request.json());
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw error(400, 'messages array is required');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages
    })
  });

  if (!res.ok) {
    const body = await res.text();
    let msg;
    try { msg = JSON.parse(body)?.error?.message; } catch {}
    throw error(res.status, msg || `Anthropic API error ${res.status}`);
  }

  const data = await res.json();
  return json({ content: data.content[0]?.text ?? '' });
}
