// Checks Bedrock model access with the model ID from cdk.json.
// Usage: npx tsx scripts/check-bedrock.ts
import { readFileSync } from 'node:fs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const ctx = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8')).context;
const client = new BedrockRuntimeClient({ region: ctx.region });
const t0 = Date.now();
const res = await client.send(
  new InvokeModelCommand({
    modelId: ctx.modelId,
    contentType: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    }),
  }),
);
const body = JSON.parse(new TextDecoder().decode(res.body));
console.log(`${ctx.modelId}: "${body.content?.[0]?.text}" in ${Date.now() - t0} ms`);
