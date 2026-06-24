import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'artifacts');
const out = path.join(outDir, 'hermes-browser-extension.tar.gz');
const outRel = path.relative(root, out).replaceAll(path.sep, '/');
const distRel = path.relative(root, dist).replaceAll(path.sep, '/');

if (!fs.existsSync(dist)) {
  console.error('dist/ does not exist. Run npm run build first.');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(out, { force: true });

// Use paths relative to cwd so Git Bash tar on Windows does not parse `D:` as a remote host.
const result = spawnSync('tar', ['-czf', outRel, '-C', distRel, '.'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('tar packaging failed. You can still load the unpacked extension from dist/.');
  process.exit(result.status || 1);
}
console.log(`Packaged extension archive: ${out}`);
