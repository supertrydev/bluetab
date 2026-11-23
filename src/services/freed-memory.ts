declare const __BLUETAB_BROWSER__: string | undefined;

/** System-wide estimate, deliberately omitted when the change is small or unavailable. */
export async function readAvailableMemory(): Promise<number | null> {
  // Firefox has no system.memory; the build constant lets the bundler drop the call there.
  if (typeof __BLUETAB_BROWSER__ !== 'undefined' && __BLUETAB_BROWSER__ === 'firefox') return null;
  try {
    if (typeof chrome === 'undefined' || !chrome.system?.memory?.getInfo) return null;
    const info = await chrome.system.memory.getInfo();
    return Number.isFinite(info.availableCapacity) && info.availableCapacity >= 0 ? info.availableCapacity : null;
  } catch {
    return null;
  }
}

export async function measureFreedMemory(before: number | null): Promise<number | null> {
  if (before === null || !Number.isFinite(before) || before < 0) return null;
  await new Promise(resolve => setTimeout(resolve, 3000));
  const after = await readAvailableMemory();
  if (after === null) return null;
  const mb = (after - before) / (1024 * 1024);
  return mb >= 50 ? Math.round(mb / 10) * 10 : null;
}
