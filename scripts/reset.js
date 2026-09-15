/**
 * 重置世界：清空全部存档，重新建表。
 * 用法：node scripts/reset.js --yes
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB = process.env.DB_PATH || path.join(ROOT, 'data', 'empire.db');

if (!process.argv.includes('--yes')) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`将清空 ${DB} 的全部存档，不可恢复。确认？(yes/NO) `, (ans) => {
    rl.close();
    if (ans.trim().toLowerCase() !== 'yes') {
      console.log('已取消。');
      process.exit(0);
    }
    wipe();
  });
} else {
  wipe();
}

function wipe() {
  let removed = 0;
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}-journal`]) {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      removed += 1;
      console.log(`  已删 ${f}`);
    }
  }
  if (!removed) console.log('  无存档可清。');
  console.log('世界已重置。下次启动将重新开朝。');
}
