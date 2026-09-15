/**
 * 《大衍帝国》服务端入口
 *
 *   node server/index.js
 *
 * 环境变量：
 *   PORT        监听端口，默认 8787
 *   HOST        监听地址，默认 0.0.0.0
 *   DB_PATH     SQLite 文件路径，默认 ./data/empire.db
 *   JWT_SECRET  令牌密钥；不设则自动生成并持久化到 ./data/jwt.secret
 *   TICK_MS     回合间隔毫秒，默认 180000（3 分钟）
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { Server as SocketServer } from 'socket.io';

import { db, now, worldGet, worldSet, currentTick } from './db.js';
import { initOfficeSlots, runTick, gazette } from './game/engine.js';
import { seedCourt } from './game/npc.js';
import { CONST, RANK_BY_ID } from './game/data.js';
import { makeApiRouter } from './routes/api.js';
import { attachRealtime } from './realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------------- 密钥 ---------------- */

function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, 'jwt.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const JWT_SECRET = resolveSecret();

/* ---------------- 初始化 ---------------- */

initOfficeSlots();
if (worldGet('tick', null) === null) {
  worldSet('tick', 0);
  worldSet('founded', now());
  gazette('global', null, 'system', '大衍承平，朝廷开科取士，四方士子释褐入仕。');
}
// 铺设朝廷原班底（幂等：已有朝臣则跳过）
const courtSeed = seedCourt();

/* ---------------- HTTP ---------------- */

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '256kb' }));

app.use('/api', makeApiRouter(JWT_SECRET));

app.get('/healthz', (req, res) => {
  const all = db.prepare('SELECT COUNT(*) AS c FROM players WHERE retired = 0').get().c;
  const humans = db
    .prepare('SELECT COUNT(*) AS c FROM players WHERE retired = 0 AND is_npc = 0')
    .get().c;
  res.json({
    ok: true,
    tick: currentTick(),
    players: humans,
    npcs: all - humans,
    uptime: Math.round(process.uptime()),
  });
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.use((req, res) => {
  res.status(404).json({ error: '无此路径' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || '有司出错' });
});

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: true, credentials: true },
});
const rt = attachRealtime(io, JWT_SECRET);

/* ---------------- 回合循环 ---------------- */

const TICK_MS = Number(process.env.TICK_MS || CONST.TICK_MS);
let lastTickAt = Date.now();

setInterval(() => {
  try {
    const tick = runTick();
    rt.broadcastTick(tick);
    rt.broadcastFactions();

    // 每 10 回合发布一次朝局邸报
    if (tick % 10 === 0) {
      const top = db
        .prepare('SELECT * FROM players WHERE retired = 0 ORDER BY rank_id DESC LIMIT 1')
        .get();
      if (top) {
        rt.broadcastGazette(
          'system',
          `【朝局】第 ${tick} 回合。今居庙堂之首者，${top.display_name}，${RANK_BY_ID.get(top.rank_id).grade}${RANK_BY_ID.get(top.rank_id).title}。`
        );
      }
    }
    lastTickAt = Date.now();
  } catch (e) {
    console.error('[tick]', e);
  }
}, TICK_MS);

/* ---------------- 启动 ---------------- */

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  const t = currentTick();
  console.log('');
  console.log('  ┌──────────────────────────────────────────┐');
  console.log('  │            大 衍 帝 国                    │');
  console.log('  └──────────────────────────────────────────┘');
  console.log(`   监听      http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   数据库    ${path.resolve(DATA_DIR, 'empire.db')}`);
  console.log(`   当前回合  ${t}`);
  console.log(`   回合间隔  ${Math.round(TICK_MS / 1000)} 秒`);
  if (courtSeed.created) {
    console.log(`   开朝建制  朝臣 ${courtSeed.created} 员入列，${courtSeed.factions} 党并立`);
  }
  console.log('');
  void lastTickAt;
});

function shutdown(sig) {
  console.log(`\n[${sig}] 正在收档…`);
  io.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
