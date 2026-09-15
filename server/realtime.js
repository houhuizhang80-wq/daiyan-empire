/**
 * 实时层（Socket.IO）
 * 频道：global 朝堂公议 / faction 党内密议 / dm 私函
 * 广播：在线名录、邸报推送、回合更替
 */

import jwt from 'jsonwebtoken';
import { db, now } from './db.js';
import { getPlayer, gazette, sendDirectMessage, listFactions } from './game/engine.js';
import { RANK_BY_ID } from './game/data.js';

const CHANNEL_KEEP = 120;

export function attachRealtime(io, JWT_SECRET) {
  /** 近期公议缓存，新加入者可见 */
  const history = { global: [] };
  const online = new Map(); // playerId -> Set(socketId)

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const row = getPlayer(payload.uid);
      if (!row) return next(new Error('unauthorized'));
      socket.data.playerId = row.id;
      socket.data.name = row.display_name;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const roster = () => {
    const ids = [...online.keys()];
    if (!ids.length) return [];
    const rows = db
      .prepare(
        `SELECT id, display_name, rank_id, faction_id FROM players WHERE id IN (${ids
          .map(() => '?')
          .join(',')})`
      )
      .all(...ids);
    return rows.map((r) => ({
      id: r.id,
      name: r.display_name,
      title: RANK_BY_ID.get(r.rank_id)?.title,
      rankId: r.rank_id,
      factionId: r.faction_id,
    }));
  };

  const pushRoster = () => io.emit('roster', roster());

  io.on('connection', (socket) => {
    const pid = socket.data.playerId;
    if (!online.has(pid)) online.set(pid, new Set());
    online.get(pid).add(socket.id);

    socket.join('global');
    socket.emit('hello', {
      playerId: pid,
      name: socket.data.name,
      history: history.global.slice(-40),
      roster: roster(),
    });
    pushRoster();

    socket.on('chat', (msg) => {
      const text = String(msg?.text || '').slice(0, 300).trim();
      const channel = String(msg?.channel || 'global');
      if (!text) return;
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        channel,
        from: pid,
        name: socket.data.name,
        text,
        at: Date.now(),
      };

      if (channel === 'global') {
        history.global.push(entry);
        if (history.global.length > CHANNEL_KEEP) history.global.shift();
        io.to('global').emit('chat', entry);
      } else if (channel === 'faction') {
        const me = getPlayer(pid);
        if (!me?.faction_id) return;
        io.to(`faction:${me.faction_id}`).emit('chat', entry);
      }
    });

    socket.on('dm', (msg) => {
      const toId = Number(msg?.toId);
      const text = String(msg?.text || '').slice(0, 500).trim();
      if (!toId || !text) return;
      try {
        sendDirectMessage(pid, toId, text);
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          channel: 'dm',
          from: pid,
          to: toId,
          name: socket.data.name,
          text,
          at: Date.now(),
        };
        for (const sid of online.get(toId) || []) io.to(sid).emit('dm', entry);
        socket.emit('dm', entry);
      } catch {
        /* 忽略 */
      }
    });

    socket.on('faction:join-room', () => {
      const me = getPlayer(pid);
      if (me?.faction_id) socket.join(`faction:${me.faction_id}`);
    });

    socket.on('disconnect', () => {
      const set = online.get(pid);
      if (set) {
        set.delete(socket.id);
        if (!set.size) online.delete(pid);
      }
      pushRoster();
    });
  });

  /** 由主循环调用：向全场推送邸报 */
  function broadcastGazette(kind, text) {
    gazette('global', null, kind, text, now());
    io.emit('gazette', { kind, text, at: Date.now() });
  }

  function broadcastTick(tick) {
    io.emit('tick', { tick, at: Date.now() });
  }

  function broadcastFactions() {
    io.emit('factions', listFactions());
  }

  return { broadcastGazette, broadcastTick, broadcastFactions, pushRoster };
}
