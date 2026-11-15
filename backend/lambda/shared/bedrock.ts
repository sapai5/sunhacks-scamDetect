import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({});

/** One Claude call on Bedrock; returns the text of the reply. */
export async function askClaude(modelId: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(res.body)) as { content?: { type: string; text?: string }[] };
  return body.content?.find((c) => c.type === 'text')?.text ?? '';
}
