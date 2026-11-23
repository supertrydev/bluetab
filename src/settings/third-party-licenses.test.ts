import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dependencies } from '../../package.json';
import { THIRD_PARTY_LICENSES } from './third-party-licenses';

describe('generated third-party licenses (regenerate with node scripts/generate-third-party-licenses.cjs)', () => {
  it('lists every production dependency exactly once', () => {
    expect(THIRD_PARTY_LICENSES.map(({ name }) => name)).toEqual(Object.keys(dependencies).sort());
  });

  it('matches installed dependency versions and licenses', () => {
    for (const entry of THIRD_PARTY_LICENSES) {
      const metadata = JSON.parse(readFileSync(resolve('node_modules', entry.name, 'package.json'), 'utf8'));
      const licenses = metadata.license ?? metadata.licenses;
      const license = (Array.isArray(licenses) ? licenses : [licenses])
        .map((item: string | { type: string }) => typeof item === 'string' ? item : item.type)
        .join(' OR ');
      expect(entry).toEqual({ name: metadata.name, version: metadata.version, license });
    }
  });
});
