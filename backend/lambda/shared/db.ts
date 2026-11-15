import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { ElderSettings } from '../../../contracts/index.js';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

const ELDERS_TABLE = process.env.ELDERS_TABLE;

/** The cdk.json values the Lambda was deployed with. */
const fromEnv = (elderId: string): ElderSettings => ({
  elderId,
  elderName: process.env.ELDER_NAME ?? 'the elder',
  verificationQuestion: process.env.VERIFICATION_QUESTION ?? '',
  verificationAnswer: process.env.VERIFICATION_ANSWER ?? '',
  agentName: process.env.AGENT_NAME ?? 'Mike',
  agentRelation: process.env.AGENT_RELATION ?? 'son',
  family: [],
  trustedContacts: [],
});

/**
 * Settings from the Elders table, on top of the env values. A missing table or item,
 * or a read error, falls back to env so scoring never stops over settings.
 */
export async function loadElder(elderId: string): Promise<ElderSettings> {
  const base = fromEnv(elderId);
  if (!ELDERS_TABLE) return base;
  try {
    const { Item } = await ddb.send(new GetCommand({ TableName: ELDERS_TABLE, Key: { elderId } }));
    if (!Item) return base;
    const { connections: _, ...settings } = Item;
    return { ...base, ...settings };
  } catch (err) {
    console.error('elder settings read failed, using env values', err);
    return base;
  }
}
