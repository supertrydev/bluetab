import { measureFreedMemory, readAvailableMemory } from './freed-memory';

const getInfo = jest.fn();
beforeEach(() => {
  jest.useFakeTimers();
  getInfo.mockReset();
  Object.assign(chrome, { system: { memory: { getInfo } } });
});
afterEach(() => { jest.useRealTimers(); });

it.each([[49, null], [49.9, null], [50, 50], [54, 50], [55, 60], [389, 390], [409, 410], [-100, null]])('measures %s MB as %s after three seconds', async (difference, expected) => {
  getInfo.mockResolvedValue({ availableCapacity: (1000 + difference) * 1024 * 1024 });
  const result = measureFreedMemory(1000 * 1024 * 1024);
  await jest.advanceTimersByTimeAsync(2999);
  expect(getInfo).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toBe(expected);
});

it('handles missing API, thrown errors, rejected reads, and invalid results', async () => {
  Object.assign(chrome, { system: undefined });
  expect(await readAvailableMemory()).toBeNull();
  Object.assign(chrome, { system: { memory: { getInfo } } });
  getInfo.mockImplementationOnce(() => { throw new Error('unavailable'); });
  expect(await readAvailableMemory()).toBeNull();
  getInfo.mockRejectedValueOnce(new Error('unavailable'));
  expect(await readAvailableMemory()).toBeNull();
  getInfo.mockResolvedValueOnce({ availableCapacity: NaN });
  expect(await readAvailableMemory()).toBeNull();
  expect(await measureFreedMemory(null)).toBeNull();
  expect(await measureFreedMemory(NaN)).toBeNull();
  getInfo.mockRejectedValueOnce(new Error('gone'));
  const result = measureFreedMemory(100);
  await jest.advanceTimersByTimeAsync(3000);
  expect(await result).toBeNull();
});
