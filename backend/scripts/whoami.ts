// Checks that AWS credentials work without needing the AWS CLI.
// Usage: npx tsx scripts/whoami.ts
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

const id = await new STSClient({ region: 'us-east-1' }).send(new GetCallerIdentityCommand({}));
console.log(`account ${id.Account}  identity ${id.Arn}`);
