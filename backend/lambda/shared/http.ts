import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BadRequest } from '../analyze/rules.js';

const MAX_BODY_BYTES = 256 * 1024;

export const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Read and JSON-parse a function URL body, with a size cap. */
export function readBody(event: APIGatewayProxyEventV2): unknown {
  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : (event.body ?? '');
  if (raw.length > MAX_BODY_BYTES) throw new BadRequest('body too large');
  try {
    return JSON.parse(raw || 'null');
  } catch {
    throw new BadRequest('invalid JSON');
  }
}
