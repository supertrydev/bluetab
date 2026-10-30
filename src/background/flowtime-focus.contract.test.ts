import * as fs from 'fs';
import * as path from 'path';

const SERVICE_WORKER_FILE = path.resolve(__dirname, 'service-worker.ts');
const source = fs.readFileSync(SERVICE_WORKER_FILE, 'utf-8');

describe('background flowtime auto-focus contract', () => {
  it('supports a dedicated flowtime-managed focus source', () => {
    expect(source).toContain("source: 'flowtime'");
  });

  it('checks Flowtime auto-focus settings during pomodoroState changes', () => {
    expect(source).toContain("newState.mode === 'flowtime'");
    expect(source).toContain('flowtimeTimer?.autoFocusEnabled');
  });
});
