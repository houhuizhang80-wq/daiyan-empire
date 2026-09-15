/**
 * REST 接口层
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { db, now, currentTick } from '../db.js';
import {
  createPlayer,
  getPlayer,
  getPlayerByUsername,
  verifyPassword,
  selfProfile,
  publicProfile,
  touch,
  performAction,
  attemptPromotion,
  promotionReadiness,
  listEvents,
  resolveEvent,
  createFaction,
  listFactions,
  getFaction,
  joinFaction,
  leaveFaction,
  donateFaction,
  leaderboard,
  courtOverview,
  searchPlayers,
  listAllPlayers,
  recentGazette,
  sendDirectMessage,
  dmHistory,
  dmConversations,
  markDmSeen,
  slotStats,
  scoreOf,
} from '../game/engine.js';
import { actionList, PATH_META } from '../game/actions.js';
import { RANKS, ORGANS, DOCTRINES, CONST, RANK_BY_ID } from '../game/data.js';

const SESSION_DAYS = 30;

export function makeApiRouter(JWT_SECRET) {
  const router = express.Router();

  /* ---------------- 认证 ---------------- */

  function issue(row) {
    // jwtid 保证同一秒内签发的令牌也不重复（否则会撞 sessions 主键）
    const token = jwt.sign({ uid: row.id }, JWT_SECRET, {
      expiresIn: `${SESSION_DAYS}d`,
      jwtid: randomUUID(),
    });
    const t = now();
    db.prepare(
      `INSERT INTO sessions (token, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at`
    ).run(token, row.id, t, t + SESSION_DAYS * 86400_000);
    return token;
  }

  function auth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: '未具名帖，请先登录。' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const session = db
        .prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?')
        .get(token, now());
      if (!session) return res.status(401).json({ error: '名帖已过期，请重新登录。' });
      const row = getPlayer(payload.uid);
      if (!row) return res.status(401).json({ error: '查无此人。' });
      touch(row.id);
      req.player = row;
      req.token = token;
      next();
    } catch {
      return res.status(401).json({ error: '名帖不验，请重新登录。' });
    }
  }

  const wrap = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || '有司出错' });
    }
  };

  router.post(
    '/auth/register',
    wrap((req, res) => {
      const { username, displayName, password } = req.body || {};
      if (!username || !/^[A-Za-z0-9_]{3,20}$/.test(username))
        return res.status(400).json({ error: '名号须为 3-20 位字母、数字或下划线。' });
      if (!password || String(password).length < 6)
        return res.status(400).json({ error: '口令不得少于 6 位。' });
      const name = (displayName || username).trim().slice(0, 12);
      if (!name) return res.status(400).json({ error: '请取一个表字。' });
      const row = createPlayer(username, name, String(password));
      const token = issue(row);
      res.json({ token, profile: selfProfile(getPlayer(row.id)) });
    })
  );

  router.post(
    '/auth/login',
    wrap((req, res) => {
      const { username, password } = req.body || {};
      const row = getPlayerByUsername(String(username || ''));
      if (!row || !verifyPassword(row, String(password || '')))
        return res.status(401).json({ error: '名号或口令有误。' });
      if (row.retired) {
        db.prepare('UPDATE players SET retired = 0 WHERE id = ?').run(row.id);
      }
      const token = issue(row);
      res.json({ token, profile: selfProfile(getPlayer(row.id)) });
    })
  );

  router.post(
    '/auth/logout',
    auth,
    wrap((req, res) => {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
      res.json({ ok: true });
    })
  );

  /* ---------------- 自身 ---------------- */

  router.get(
    '/me',
    auth,
    wrap((req, res) => {
      res.json({ profile: selfProfile(getPlayer(req.player.id)) });
    })
  );

  router.get(
    '/me/readiness',
    auth,
    wrap((req, res) => {
      res.json(promotionReadiness(req.player));
    })
  );

  /* ---------------- 行动 ---------------- */

  router.get('/actions', (req, res) => {
    res.json({ actions: actionList(), paths: PATH_META });
  });

  router.post(
    '/actions/:key',
    auth,
    wrap((req, res) => {
      const targetId = req.body?.targetId ? Number(req.body.targetId) : null;
      const result = performAction(req.player.id, req.params.key, targetId);
      res.json(result);
    })
  );

  router.post(
    '/promote',
    auth,
    wrap((req, res) => {
      res.json(attemptPromotion(req.player.id));
    })
  );

  /* ---------------- 事件 ---------------- */

  router.get(
    '/events',
    auth,
    wrap((req, res) => {
      res.json({ events: listEvents(req.player.id) });
    })
  );

  router.post(
    '/events/:id/resolve',
    auth,
    wrap((req, res) => {
      res.json(resolveEvent(req.player.id, Number(req.params.id), req.body?.optionKey));
    })
  );

  /* ---------------- 朝堂 ---------------- */

  router.get('/court', (req, res) => {
    res.json(courtOverview());
  });

  router.get('/leaderboard', (req, res) => {
    res.json({ list: leaderboard(50) });
  });

  router.get('/ranks', (req, res) => {
    res.json({
      ranks: RANKS.map((r) => {
        const s = slotStats(r.id);
        return { ...r, slotsTotal: s.total, slotsFilled: s.filled };
      }),
      organs: Object.values(ORGANS),
    });
  });

  router.get(
    '/players',
    auth,
    wrap((req, res) => {
      const q = req.query.q;
      res.json({
        list: q ? searchPlayers(String(q), req.player.id) : listAllPlayers(req.player.id),
      });
    })
  );

  router.get(
    '/players/:id',
    auth,
    wrap((req, res) => {
      const row = getPlayer(Number(req.params.id));
      if (!row) return res.status(404).json({ error: '查无此人。' });
      const p = publicProfile(row, req.player.id);
      const stats = JSON.parse(row.stats || '{}');
      p.score = Math.round(scoreOf(stats));
      res.json({ player: p });
    })
  );

  /* ---------------- 邸报 ---------------- */

  router.get(
    '/gazette',
    auth,
    wrap((req, res) => {
      res.json({ list: recentGazette(Number(req.query.limit) || 60, req.player.id), tick: currentTick() });
    })
  );

  /* ---------------- 派系 ---------------- */

  router.get('/factions', (req, res) => {
    res.json({ list: listFactions(), doctrines: Object.values(DOCTRINES) });
  });

  router.post(
    '/factions',
    auth,
    wrap((req, res) => {
      res.json({ faction: createFaction(req.player.id, String(req.body?.name || '').slice(0, 16), req.body?.doctrine) });
    })
  );

  router.post(
    '/factions/:id/join',
    auth,
    wrap((req, res) => {
      res.json({ faction: joinFaction(req.player.id, Number(req.params.id)) });
    })
  );

  router.post(
    '/factions/leave',
    auth,
    wrap((req, res) => {
      leaveFaction(req.player.id);
      res.json({ ok: true, profile: selfProfile(getPlayer(req.player.id)) });
    })
  );

  router.post(
    '/factions/donate',
    auth,
    wrap((req, res) => {
      res.json({ faction: donateFaction(req.player.id, Number(req.body?.amount || 0)) });
    })
  );

  router.get(
    '/factions/:id',
    (req, res) => {
      const f = getFaction(Number(req.params.id));
      if (!f) return res.status(404).json({ error: '并无此党。' });
      res.json({ faction: f });
    }
  );

  /* ---------------- 私函 ---------------- */

  router.post(
    '/dm',
    auth,
    wrap((req, res) => {
      const toId = Number(req.body?.toId);
      const target = getPlayer(toId);
      if (!target) return res.status(404).json({ error: '查无此人。' });
      res.json(sendDirectMessage(req.player.id, toId, req.body?.text));
    })
  );

  // 注意：threads 必须声明在 /dm/:playerId 之前，否则会被参数路由截走
  router.get(
    '/dm/threads',
    auth,
    wrap((req, res) => {
      res.json({ list: dmConversations(req.player.id) });
    })
  );

  router.get(
    '/dm/:playerId',
    auth,
    wrap((req, res) => {
      const peerId = Number(req.params.playerId);
      const list = dmHistory(req.player.id, peerId);
      markDmSeen(req.player.id, peerId);
      res.json({ list });
    })
  );

  /* ---------------- 元数据 ---------------- */

  router.get('/meta', (req, res) => {
    res.json({
      const: CONST,
      paths: PATH_META,
      doctrines: Object.values(DOCTRINES),
      rankCount: RANKS.length,
      tick: currentTick(),
      maxRank: RANK_BY_ID.get(RANKS.length - 1).title,
    });
  });

  return router;
}

export { RANKS };
