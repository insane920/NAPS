import { parseYamlScm } from './yamlScm';

export const RECOVERY_KEY = 'naps.recovery.v1';
export const PREVIOUS_RECOVERY_KEY = `${RECOVERY_KEY}.previous`;
export interface RecoveryCopy { version: 1; name: string; content: string; savedAt: number }
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function decode(raw: string | null): RecoveryCopy | null {
  if (!raw) return null;
  try {
    const copy = JSON.parse(raw);
    if (copy.version !== 1 || typeof copy.name !== 'string' || typeof copy.content !== 'string' || !Number.isFinite(copy.savedAt)) return null;
    if (!/^scm\s*:/m.test(copy.content) || !/^Objects\s*:/m.test(copy.content)) return null;
    parseYamlScm(copy.content);
    return copy;
  } catch { return null; }
}

export function readRecovery(storage: StorageAccess): RecoveryCopy | null {
  return decode(storage.getItem(RECOVERY_KEY)) ?? decode(storage.getItem(PREVIOUS_RECOVERY_KEY));
}

export function writeRecovery(storage: StorageAccess, copy: RecoveryCopy): void {
  // Validate before touching either slot. A failed/quota-limited write leaves a valid copy.
  if (!decode(JSON.stringify(copy))) throw new Error('Не удалось проверить резервную копию схемы.');
  const current = storage.getItem(RECOVERY_KEY);
  const existing = decode(current);
  if (existing?.content === copy.content && existing.name === copy.name) return;
  if (existing) storage.setItem(PREVIOUS_RECOVERY_KEY, current!);
  storage.setItem(RECOVERY_KEY, JSON.stringify(copy));
}

export function discardRecovery(storage: StorageAccess): void {
  storage.removeItem(RECOVERY_KEY);
  storage.removeItem(PREVIOUS_RECOVERY_KEY);
}
