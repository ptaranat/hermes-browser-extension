import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'extension');
const dest = path.join(root, 'dist');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  }
}

fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);
console.log(`Built unpacked extension: ${dest}`);
