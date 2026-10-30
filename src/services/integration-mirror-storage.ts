import { Storage } from '../utils/storage';

export async function getIntegrationMirrorState<T>(key: string): Promise<T | null> {
  return (await Storage.get<T>(key)) ?? null;
}

export async function saveIntegrationMirrorState<T>(key: string, state: T): Promise<void> {
  await Storage.set(key, state);
}

export async function removeIntegrationMirrorState(key: string): Promise<void> {
  await Storage.remove(key);
}
