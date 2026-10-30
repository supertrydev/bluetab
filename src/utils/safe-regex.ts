const MAX_USER_REGEX_LENGTH = 200;

/**
 * Conservative guard for user-authored regexes. It rejects common
 * catastrophic-backtracking shapes while keeping simple Flow/archive patterns.
 */
export function isSafeUserRegex(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > MAX_USER_REGEX_LENGTH) return false;
  if (/\\[1-9]/.test(pattern)) return false;
  if (/\([^)]*([+*]|\{\d+,?\d*\})[^)]*\)([+*]|\{\d+,?\d*\})/.test(pattern)) return false;
  if (/(\.\*){2,}/.test(pattern)) return false;
  if (/(\[[^\]]+\]|\([^)]*\)|\\?.)([+*])\2/.test(pattern)) return false;
  return true;
}

export function makeSafeUserRegex(pattern: string, flags = ''): RegExp | null {
  if (!isSafeUserRegex(pattern)) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
