import { createHash } from 'node:crypto';

export function memoryContentFingerprint(category: string, content: string): string {
  return createHash('sha256').update(`${category}\0${content}`).digest('hex');
}
