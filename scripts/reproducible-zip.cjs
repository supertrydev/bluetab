const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function writeReproducibleZip(root, staging, output) {
  const epoch = process.env.SOURCE_DATE_EPOCH ?? execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (!/^\d+$/.test(epoch) || Number(epoch) > 4354819199) {
    throw new Error('SOURCE_DATE_EPOCH must be a Unix timestamp within the ZIP date range');
  }
  const timestamp = Math.max(315532800, Math.floor(Number(epoch) / 2) * 2);
  const files = [];

  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collect(fullPath);
      } else if (entry.isFile()) {
        fs.chmodSync(fullPath, 0o644);
        fs.utimesSync(fullPath, timestamp, timestamp);
        files.push(path.relative(staging, fullPath));
      } else {
        throw new Error(`Unsupported ZIP entry: ${fullPath}`);
      }
    }
  }

  collect(staging);
  fs.rmSync(output, { force: true });
  const { ZIPOPT: _zipOptions, ...env } = process.env;
  execFileSync('zip', ['-X', '-q', output, '-@'], {
    cwd: staging,
    env: { ...env, TZ: 'UTC' },
    input: `${files.sort().join('\n')}\n`,
  });
}

module.exports = { writeReproducibleZip };
