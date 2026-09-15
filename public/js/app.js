/* ══════════════════════════════════════════════════
   大衍帝国 · 前端应用
   ══════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const S = {
  profile: null,
  actions: [],
  paths: {},
  ranks: [],
  organs: [],
  court: null,
  board: [],
  players: [],
  factions: [],
  doctrines: [],
  gazette: [],
  events: [],
  roster: [],
  chat: [],
  channel: 'global',
  threads: [],
  activePeer: null,
  messages: [],
  view: 'court',
  const: { TICK_MS: 180000 },
  lastTickAt: Date.now(),
  busy: false,
};

/* ────────── 提示 ────────── */

function toast(text, kind = 'ok', ms = 4200) {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'ok' ? '' : kind}`;
  node.textContent = text;
  $('#toasts').appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .3s';
    setTimeout(() => node.remove(), 320);
  }, ms);
}

const errText = (e) => (e && e.message) || '有司出错';

/* ────────── 通用弹窗 ────────── */

function modal({ title, bodyHTML, footerHTML = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `
    <div class="modal-card">
      <h3>${esc(title)}</h3>
      <div class="modal-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal-actions">${footerHTML}</div>` : ''}
    </div>`;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  function close() {
    wrap.remove();
  }
  document.body.appendChild(wrap);
  return { wrap, close };
}

/* ────────── 选人 ────────── */

function pickTarget(title, onPick, filterFn = () => true) {
  const candidates = S.players.filter((p) => p.id !== S.profile.id && filterFn(p));
  const { wrap, close } = modal({
    title,
    bodyHTML: `
      <input id="pk-search" placeholder="按表字检索…" autocomplete="off" />
      <div class="picker-list" id="pk-list"></div>`,
    footerHTML: `<button class="btn ghost" data-close>罢</button>`,
  });
  const list = wrap.querySelector('#pk-list');
  const search = wrap.querySelector('#pk-search');

  const paint = (q) => {
    const kw = (q || '').trim();
    const rows = candidates.filter((p) => !kw || p.name.includes(kw));
    list.innerHTML = rows.length
      ? rows
          .map(
            (p) => `<div class="picker-row" data-id="${p.id}">
              <b>${esc(p.name)}</b>
              <span class="rel-badge">${esc(p.grade)}${esc(p.title)}</span>
              <span class="t">权势 ${p.power}</span>
            </div>`
          )
          .join('')
      : `<div style="color:var(--ink-3);padding:10px">朝中无此人。</div>`;
  };
  paint('');

  search.addEventListener('input', () => paint(search.value));
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.picker-row');
    if (!row) return;
    const p = candidates.find((x) => x.id === Number(row.dataset.id));
    close();
    onPick(p);
  });
  wrap.querySelector('[data-close]').addEventListener('click', close);
}

/* ────────── 顶栏 ────────── */

function renderTopbar() {
  const p = S.profile;
  if (!p) return;
  const st = p.stats;
  const rs = p.resources;
  const items = [
    ['本官', `${p.grade}${p.title}`, ''],
    ['职任', p.organ, ''],
    ['权势', p.power, ''],
    ['银两', Math.round(rs.silver), ''],
    ['政令', `${Math.round(rs.mandate)}/${p.mandateMax}`, ''],
    ['政绩', Math.round(st.merit), ''],
    ['圣眷', Math.round(st.favor), ''],
    ['暴露', `${Math.round(st.exposure)}`, st.exposure > 60 ? 'color:var(--seal)' : ''],
  ];
  $('#stat-strip').innerHTML = items
    .map(
      ([k, v, style]) =>
        `<div class="stat"><span class="k">${k}</span><span class="v" style="${style}">${esc(v)}</span></div>`
    )
    .join('');
}

/* ────────── 视图：朝堂 ────────── */

function viewCourt() {
  const p = S.profile;
  const st = p.stats;
  const rs = p.resources;
  const c = S.court || { players: 0, online: 0, vacancies: [] };

  const bars = [
    ['政绩 merit', st.merit, 'jade', 600],
    ['声望 renown', st.renown, 'gold', 400],
    ['权谋 guile', st.guile, 'seal', 300],
    ['人脉 network', st.network, 'jade', 400],
    ['圣眷 favor', st.favor, 'gold', 300],
    ['暴露 exposure', st.exposure, 'seal', 100],
  ]
    .map(
      ([label, val, cls, max]) => `
      <div style="margin-bottom:11px">
        <div style="display:flex;justify-content:space-between;font-size:12.5px">
          <span style="color:var(--ink-2)">${label}</span>
          <b style="font-variant-numeric:tabular-nums">${Math.round(val)}</b>
        </div>
        <div class="bar ${cls}"><i style="width:${Math.min(100, (val / max) * 100)}%"></i></div>
      </div>`
    )
    .join('');

  const vac = (c.vacancies || [])
    .filter((v) => v.filled < v.total)
    .slice(0, 6)
    .map(
      (v) => `<div class="kv"><span class="k">${esc(v.grade)}${esc(v.title)}</span>
        <span class="v" style="color:var(--jade)">缺 ${v.total - v.filled} / ${v.total}</span></div>`
    )
    .join('') || `<p class="hint">当前各缺皆满，须待有人去位。</p>`;

  const top = S.board
    .slice(0, 8)
    .map(
      (r, i) => `<div class="kv">
        <span class="k">${i + 1}. ${esc(r.name)} ${
          r.npc ? '<span class="npc-badge">朝臣</span>' : r.online ? '<span class="dot" style="display:inline-block"></span>' : ''
        }</span>
        <span class="v">${esc(r.grade)}${esc(r.title)}</span></div>`
    )
    .join('') || `<p class="hint">朝中尚无人。</p>`;

  const evs = S.events.length
    ? `<div class="card" style="border-left:3px solid var(--gold);margin-bottom:16px">
        <h3>待决之事 · ${S.events.length}</h3>
        <p class="hint">${esc(S.events[0].title)}：${esc(S.events[0].text)}</p>
        <button class="btn primary" id="open-event">即刻裁断</button>
      </div>`
    : '';

  return `
    <h2 class="page-title">朝 堂</h2>
    <p class="page-desc">
      第 ${S.court?.tick ?? 0} 回合 ·
      在册玩家 ${c.players} 人（在线 ${c.online}）·
      朝廷旧人 ${c.npcs ?? 0} 员
    </p>

    ${evs}

    <div class="grid c3" style="margin-bottom:16px">
      <div class="card">
        <h3>本 官</h3>
        <div class="bignum seal-c" style="font-size:22px">${esc(p.grade)}</div>
        <div style="font-family:var(--font);font-size:19px;letter-spacing:.14em;margin-top:2px">${esc(p.title)}</div>
        <div class="hint" style="margin:8px 0 0">${esc(p.organ)} · 在任 ${p.tenure} 回合</div>
      </div>
      <div class="card">
        <h3>权 势</h3>
        <div class="bignum jade-c">${p.power}</div>
        <div class="hint" style="margin:8px 0 0">功绩分 ${p.score} · 生涯顶点第 ${p.peak} 级</div>
        <div class="hint" style="margin:4px 0 0">门第 ${p.familyPower ?? 0} · 姻亲 ${p.kinCount ?? 0} 家 · 心腹 ${(p.retinue || []).length} 人</div>
      </div>
      <div class="card">
        <h3>库 房</h3>
        <div class="bignum">${Math.round(rs.silver)}<span style="font-size:14px;color:var(--ink-3)"> 两</span></div>
        <div class="hint" style="margin:8px 0 0">俸禄 ${p.salary} 两/回合 · 政令 ${Math.round(rs.mandate)}/${p.mandateMax}</div>
      </div>
    </div>

    <div class="grid c2">
      <div class="card">
        <h3>禀 赋</h3>
        ${bars}
      </div>
      <div>
        <div class="card" style="margin-bottom:14px">
          <h3>缺 额</h3>
          ${vac}
        </div>
        <div class="card">
          <h3>朝 局 榜</h3>
          ${top}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>近 日 邸 报</h3>
      ${gazetteHTML(S.gazette.slice(0, 8))}
    </div>`;
}

/* ────────── 视图：施政 ────────── */

function costChips(cost, stats, resources) {
  const label = { mandate: '政令', silver: '银两', guile: '权谋', merit: '政绩', renown: '声望' };
  return Object.entries(cost || {})
    .map(([k, v]) => {
      const have = k === 'silver' || k === 'mandate' ? resources[k] : stats[k];
      const lack = (have || 0) < v;
      return `<span class="${lack ? 'lack' : ''}">${label[k] || k} ${v}</span>`;
    })
    .join('');
}

function viewActs() {
  const p = S.profile;
  const order = ['open', 'shadow', 'social', 'career'];
  return `
    <h2 class="page-title">施 政</h2>
    <p class="page-desc">明线以政令行于朝堂，暗线以权谋行于案下，二者皆可通天，代价不同。</p>
    ${order
      .map((pathKey) => {
        const meta = S.paths[pathKey];
        if (!meta) return '';
        const list = S.actions.filter((a) => a.path === pathKey);
        if (!list.length) return '';
        return `
        <section class="path-group">
          <div class="path-head">
            <h2>${esc(meta.name)}</h2>
            <span class="tag ${pathKey}">${list.length} 条</span>
          </div>
          <p class="path-desc">${esc(meta.desc)}</p>
          <div class="grid c3">
            ${list
              .map((a) => {
                const cd = p.cooldowns[a.key];
                const onCd = cd && cd > (S.court?.tick ?? 0);
                return `<div class="act">
                  <div class="name">${esc(a.name)}</div>
                  <div class="desc">${esc(a.desc)}</div>
                  <div class="foot">
                    <div class="cost">${costChips(a.cost, p.stats, p.resources)}</div>
                    <button class="btn sm" data-act="${esc(a.key)}" ${onCd ? 'disabled' : ''}>
                      ${onCd ? `候 ${cd} 回合` : a.target === 'player' ? '择人施行' : '施 行'}
                    </button>
                  </div>
                </div>`;
              })
              .join('')}
          </div>
        </section>`;
      })
      .join('')}`;
}

/* ────────── 视图：仕途 ────────── */

function viewCareer() {
  const p = S.profile;
  const n = p.nextRank;
  const ladder = S.ranks
    .slice()
    .reverse()
    .map((r) => {
      const mine = r.id === p.rankId;
      const locked = r.id > p.rankId;
      const full = r.slotsTotal !== null && r.slotsFilled >= r.slotsTotal;
      const slotText =
        r.slotsTotal === null
          ? '不限员额'
          : `${r.slotsFilled} / ${r.slotsTotal}${full ? ' · 满' : ''}`;
      return `<div class="rung ${mine ? 'mine' : ''} ${locked ? 'locked' : ''}">
        <span class="g">${esc(r.grade)}</span>
        <span class="t">${esc(r.title)}<span class="o">${esc(r.note.slice(0, 22))}…</span></span>
        <span class="slots ${full ? 'full' : ''}">${slotText}</span>
      </div>`;
    })
    .join('');

  let promoteHTML = `<p class="hint">已位极人臣，无可复加。</p>`;
  if (n) {
    const pct = Math.min(100, (p.score / n.cap) * 100);
    promoteHTML = `
      <div class="kv"><span class="k">可迁之阶</span><span class="v">${esc(n.grade)}${esc(n.title)}</span></div>
      <div class="kv"><span class="k">功绩分</span><span class="v">${p.score} / ${n.cap}</span></div>
      <div class="kv"><span class="k">该阶员额</span><span class="v">${n.filled} / ${n.slots}</span></div>
      <div class="bar ${n.ready ? 'jade' : 'gold'}" style="margin:10px 0 14px"><i style="width:${pct}%"></i></div>
      <button class="btn primary" id="btn-promote" ${n.ready ? '' : 'disabled'} style="width:100%">
        ${n.ready ? '递 呈 铨 选' : '资 历 未 足'}
      </button>
      <p class="hint" style="margin:10px 0 0">
        在任 ${p.tenure} 回合（须满 3 回合）。铨选看功绩、圣眷与清议，亦看运气；缺满则须待有人去位。
      </p>`;
  }

  return `
    <h2 class="page-title">仕 途</h2>
    <p class="page-desc">十八级官阶，自书办至首辅。基层不限员额，从七品以上逐缺竞争。</p>
    <div class="grid c2" style="margin-bottom:16px">
      <div class="card">
        <h3>铨 选</h3>
        ${promoteHTML}
      </div>
      <div class="card">
        <h3>履 历</h3>
        ${(p.history || [])
          .slice(0, 8)
          .map(
            (h) =>
              `<div class="kv"><span class="k">第 ${h.tick} 回合</span><span class="v">${esc(h.title)} <span style="color:var(--ink-3);font-weight:400">${esc(h.note || '')}</span></span></div>`
          )
          .join('') || '<p class="hint">尚无履历。</p>'}
      </div>
    </div>
    <div class="card">
      <h3>官 阶 全 表</h3>
      <div class="ladder">${ladder}</div>
    </div>`;
}

/* ────────── 视图：人脉 ────────── */

const REL_NAME = {
  patron: '恩主',
  protege: '门生',
  ally: '盟友',
  rival: '政敌',
  nemesis: '死敌',
  kin: '姻亲',
  confidant: '心腹',
};

/**
 * 门第卡：姻亲与心腹。
 *
 * 这两样都不只是收藏品，而是**风险敞口** —— 姻亲一损俱损，心腹倒下会牵连东家。
 * 心腹还要标出「肯不肯替你担事」：交情不到那条线，托付了也只会被推回来，
 * 这条规则不摆到台面上，玩家就不知道「托付心腹」这个动作到底有没有用。
 */
function houseCard() {
  const p = S.profile || {};
  const kin = p.kin || [];
  const retinue = p.retinue || [];
  const willing = retinue.filter((r) => r.willing).length;
  const row = (r, note) => `
    <div class="kv" data-person="${r.id}" style="cursor:pointer">
      <span class="k">${esc(r.name)} <span style="color:var(--ink-3)">${esc(r.title || '')}</span></span>
      <span class="v">交情 ${r.strength}${note}</span>
    </div>`;

  return `
    <div class="card" style="margin-bottom:12px">
      <h3>门 第 <span class="pill">家族势力 ${p.familyPower ?? 0}</span></h3>
      <div class="kv"><span class="k">姻亲</span><span class="v">${kin.length} 家</span></div>
      ${kin.map((r) => row(r, '')).join('')}
      <div class="kv" style="margin-top:10px">
        <span class="k">心腹</span><span class="v">${retinue.length} 人 · 肯替你担事者 ${willing} 人</span>
      </div>
      ${retinue
        .map((r) => row(r, r.willing ? '' : ' · <span style="color:var(--seal)">交情未到，不肯担事</span>'))
        .join('')}
      <p class="hint" style="margin:12px 0 0">姻亲一荣俱荣、一损俱损。心腹替你分担暗线留下的痕迹，但他一旦倒下，你的圣眷与人脉也会跟着损。</p>
    </div>`;
}

function viewRelations() {
  const rels = S.profile.relations || [];
  const groups = {};
  for (const r of rels) (groups[r.type] ||= []).push(r);

  const body = Object.keys(groups).length
    ? Object.entries(groups)
        .map(
          ([type, list]) => `
        <div class="card" style="margin-bottom:12px">
          <h3>${esc(REL_NAME[type] || type)} <span class="pill">${list.length}</span></h3>
          ${list
            .map(
              (r) => `<div class="kv" data-person="${r.id}" style="cursor:pointer">
                <span class="k">${esc(r.name)} <span style="color:var(--ink-3)">${esc(r.title || '')}</span></span>
                <span class="v">交情 ${r.strength}</span></div>`
            )
            .join('')}
        </div>`
        )
        .join('')
    : `<div class="card"><p class="hint">你还没有人脉。赠礼、修书、设宴，皆可结缘。</p></div>`;

  return `
    <h2 class="page-title">人 脉</h2>
    <p class="page-desc">恩主提携你，门生倚仗你，盟友与你共进退。关系会随事件与派系消长。</p>
    ${houseCard()}
    ${body}
    <div class="card" style="margin-top:14px">
      <h3>快 捷 经 营</h3>
      <div class="grid c3">
        ${['gift', 'letter', 'marry', 'confide', 'banquet', 'assess']
          .map((k) => {
            const a = S.actions.find((x) => x.key === k);
            if (!a) return '';
            return `<div class="act">
              <div class="name">${esc(a.name)}</div>
              <div class="desc">${esc(a.desc)}</div>
              <div class="foot">
                <div class="cost">${costChips(a.cost, S.profile.stats, S.profile.resources)}</div>
                <button class="btn sm" data-act="${esc(a.key)}">${a.target === 'player' ? '择人施行' : '施 行'}</button>
              </div>
            </div>`;
          })
          .join('')}
      </div>
    </div>`;
}

/* ────────── 视图：党派 ────────── */

function viewFactions() {
  const mine = S.profile.faction;
  let mineHTML;
  if (mine) {
    const f = S.factions.find((x) => x.id === mine.id) || mine;
    mineHTML = `
      <div class="card" style="border-left:3px solid var(--gold)">
        <h3>本 党 · ${esc(f.name)}</h3>
        <p class="hint">宗旨「${esc(f.doctrineMeta?.name || '')}」—— ${esc(f.doctrineMeta?.desc || '')}</p>
        <div class="kv"><span class="k">党势</span><span class="v">${f.power ?? 0}</span></div>
        <div class="kv"><span class="k">党库</span><span class="v">${f.treasury ?? 0} 两</span></div>
        <div class="kv"><span class="k">党员</span><span class="v">${(f.members || []).length} 人</span></div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn sm" id="btn-donate">输金入党库</button>
          <button class="btn ghost sm" id="btn-leave-faction">退 党</button>
        </div>
        <div style="margin-top:12px">
          ${(f.members || [])
            .map(
              (m) =>
                `<div class="kv" data-person="${m.id}" style="cursor:pointer">
                  <span class="k">${esc(m.name)}</span><span class="v">${esc(m.title || '')}</span></div>`
            )
            .join('')}
        </div>
      </div>`;
  } else {
    mineHTML = `
      <div class="card">
        <h3>立 党</h3>
        <p class="hint">须人脉满 40、银两 300 两。宗旨一旦择定，将影响此后一切行动的得失。</p>
        <label style="display:block;margin-bottom:10px">党名
          <input id="faction-name" maxlength="16" placeholder="如「清议堂」「实务派」" style="margin-top:5px" />
        </label>
        <label style="display:block;margin-bottom:12px">宗旨
          <select id="faction-doctrine" style="margin-top:5px">
            ${S.doctrines
              .map((d) => `<option value="${esc(d.key)}">${esc(d.name)} — ${esc(d.desc)}</option>`)
              .join('')}
          </select>
        </label>
        <button class="btn primary" id="btn-create-faction" style="width:100%">立 党</button>
      </div>`;
  }

  const list = S.factions
    .map(
      (f) => `<div class="card">
        <h3>${esc(f.name)} <span class="pill">${esc(f.doctrineMeta?.name || '')}</span></h3>
        <div class="kv"><span class="k">党势</span><span class="v">${f.power}</span></div>
        <div class="kv"><span class="k">党员</span><span class="v">${f.members.length} 人</span></div>
        <div class="kv"><span class="k">党库</span><span class="v">${f.treasury} 两</span></div>
        ${
          S.profile.faction
            ? ''
            : `<button class="btn sm" style="margin-top:10px;width:100%" data-join="${f.id}">入 伙</button>`
        }
      </div>`
    )
    .join('') || `<p class="hint">朝中尚无成党者。第一个立党的，往往能拉走最多的人。</p>`;

  return `
    <h2 class="page-title">党 派</h2>
    <p class="page-desc">结党不是罪，是活法。宗旨决定你的收益曲线与翻车概率。</p>
    ${mineHTML}
    <h3 style="font-family:var(--font);letter-spacing:.14em;margin:22px 0 12px;font-size:15px">朝中诸党</h3>
    <div class="grid c3">${list}</div>`;
}

/* ────────── 视图：私函 ────────── */

function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function viewInbox() {
  const threads = S.threads
    .map(
      (t) => `<div class="thread ${t.peerId === S.activePeer ? 'active' : ''}" data-peer="${t.peerId}">
        <div class="who">${esc(t.name)} ${t.npc ? '<span class="npc-badge">朝臣</span>' : ''}</div>
        <div class="snip">${t.lastFromMe ? '我：' : ''}${esc(t.last)}</div>
        <div class="meta">
          <span class="tm">${fmtTime(t.at)}</span>
          ${t.unread ? `<span class="unread">${t.unread}</span>` : ''}
        </div>
      </div>`
    )
    .join('') || `<p class="hint">尚无往来私函。可在「名录」中择人递函，或先赠一份礼。</p>`;

  // 会话可能是新开的：此人尚未有过往来，从名录里补一份档案，否则发不出第一封信
  let peer = S.threads.find((t) => t.peerId === S.activePeer);
  if (!peer && S.activePeer) {
    const p = S.players.find((x) => x.id === S.activePeer);
    if (p) peer = { peerId: p.id, name: p.name, title: p.title, npc: p.npc, unread: 0 };
  }

  let pane;
  if (!peer) {
    pane = `<div class="empty-pane">左手择一人，展信细读。</div>`;
  } else {
    const msgs = S.messages
      .map((m) => {
        const mine = m.from_id === S.profile.id;
        return `<div class="msg ${mine ? 'out' : 'in'}">${esc(m.text)}<span class="tm">${fmtTime(m.created_at)}</span></div>`;
      })
      .join('') || `<div class="empty-pane">此函尚无只字。</div>`;
    pane = `
      <div class="thread-pane">
        <div class="thread-head">
          <span class="nm">${esc(peer.name)}</span>
          ${peer.npc ? '<span class="npc-badge">朝臣</span>' : ''}
          <span class="pill">${esc(peer.title || '')}</span>
          <button class="btn ghost sm" style="margin-left:auto" data-person="${peer.peerId}">阅其档</button>
        </div>
        <div class="msgs">${msgs}</div>
        <form class="msg-form" id="dm-form">
          <input id="dm-text" placeholder="修书一封…" maxlength="500" autocomplete="off" />
          <button class="btn primary" type="submit">寄 出</button>
        </form>
      </div>`;
  }

  return `
    <h2 class="page-title">私 函</h2>
    <p class="page-desc">私函不载于邸报，亦不留痕于清议。朝中诸事，多成于案下。</p>
    <div class="inbox">
      <div class="card" style="padding:12px">
        <h3 style="margin-bottom:8px">往 来 <span class="pill">${S.threads.length}</span></h3>
        <div class="threads">${threads}</div>
      </div>
      <div class="card">${pane}</div>
    </div>`;
}

/* ────────── 视图：邸报 ────────── */

function gazetteHTML(list) {
  if (!list.length) return '<p class="hint">邸报空空，朝中无事。</p>';
  return `<div class="gazette">${list
    .map((g) => {
      const d = new Date(g.created_at);
      const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `<div class="gitem ${esc(g.kind)}">
        <span class="time">${t}</span>
        <span class="txt">${esc(g.text)}</span></div>`;
    })
    .join('')}</div>`;
}

function viewGazette() {
  return `
    <h2 class="page-title">邸 报</h2>
    <p class="page-desc">朝中迁转、弹劾、风闻，皆载于此。私事只你可见。</p>
    <div class="card">${gazetteHTML(S.gazette)}</div>`;
}

/* ────────── 视图：名录 ────────── */

function viewRoster() {
  const humans = S.players.filter((p) => !p.npc).length;
  const people = S.players.map(personHTML).join('') || `<p class="hint">朝中尚无人。</p>`;

  return `
    <h2 class="page-title">名 录</h2>
    <p class="page-desc">
      在册 ${S.players.length} 员 —— 玩家 ${humans} 人，朝廷旧人 ${S.players.length - humans} 员。
      点击可查看详情、递私函。
    </p>
    <div class="card" style="margin-bottom:14px">
      <input id="roster-search" placeholder="按表字检索…" autocomplete="off" />
    </div>
    <div class="people" id="people-grid">${people}</div>`;
}

function personHTML(p) {
  return `<div class="person" data-person="${p.id}">
    <div class="nm">
      ${esc(p.name)}
      ${p.npc ? '<span class="npc-badge">朝臣</span>' : p.online ? '<span class="dot"></span>' : ''}
    </div>
    <div class="of">${esc(p.grade)}${esc(p.title)} · ${esc(p.organ || '')}</div>
    <div class="mt">
      <span>权势 <b>${p.power}</b></span>
      <span>声望 <b>${p.renown}</b></span>
      <span>人脉 <b>${p.network}</b></span>
    </div>
    ${
      p.faction
        ? `<div style="margin-top:8px"><span class="rel-badge">${esc(p.faction.name)}</span></div>`
        : ''
    }
  </div>`;
}

/* ────────── 视图：凡例 ────────── */

function viewHelp() {
  return `
    <h2 class="page-title">凡 例</h2>
    <p class="page-desc">本作背景、王朝、官署、官阶均为架空虚构，与现实任何机构无关。</p>
    <div class="grid c2">
      <div class="card">
        <h3>回 合</h3>
        <p class="hint">每 ${Math.round(S.const.TICK_MS / 60000)} 分钟推进一回合。回合结算发放俸禄、恢复政令与精力，并衰减暴露度。角色离线亦照常结算。</p>
        <h3 style="margin-top:14px">资 源</h3>
        <div class="kv"><span class="k">政令 mandate</span><span class="v">施行政务的额度，回合回满</span></div>
        <div class="kv"><span class="k">银两 silver</span><span class="v">通用资源，俸禄与调配所得</span></div>
        <div class="kv"><span class="k">权谋 guile</span><span class="v">暗线行动的燃料</span></div>
      </div>
      <div class="card">
        <h3>两 条 路</h3>
        <p class="hint"><b style="color:var(--jade)">正当权力</b>：政绩与圣眷稳步累积，晋升慢但稳。</p>
        <p class="hint"><b style="color:var(--seal)">地下权力</b>：见效快、手段直接，但每次运作都会留下痕迹，累加到 100 即遭弹劾，圣眷不足便镌级。</p>
        <h3 style="margin-top:14px">关 系</h3>
        <p class="hint">恩主、门生、盟友、政敌、死敌、姻亲、心腹。恩主倒台会牵连你，反之亦然。</p>
      </div>
      <div class="card">
        <h3>官 阶</h3>
        <p class="hint">十八级。基层不限员额，从七品以上逐缺竞争，缺满即须候补。久不视事者会被朝廷休致，腾出缺来。</p>
        <h3 style="margin-top:14px">铨 选</h3>
        <p class="hint">功绩分 = 政绩 + 声望×0.6 + 人脉×0.8 + 圣眷×1.2。达到下一阶门槛且在任满三回合，方可递呈。铨选有成算，非必中。</p>
      </div>
      <div class="card">
        <h3>党 派</h3>
        <p class="hint">清流重名节，实务重效能，守成求稳，激进求变。宗旨会放大或压制你的收益与风险。</p>
        <h3 style="margin-top:14px">致 仕</h3>
        <p class="hint">自请去职将清空一切功名、人脉与恩怨，唯生涯顶点留存于册。这是一条重开的路，不是退路。</p>
      </div>
    </div>`;
}

/* ────────── 渲染调度 ────────── */

const VIEWS = {
  court: viewCourt,
  acts: viewActs,
  career: viewCareer,
  relations: viewRelations,
  factions: viewFactions,
  inbox: viewInbox,
  gazette: viewGazette,
  roster: viewRoster,
  help: viewHelp,
};

function render() {
  if (!S.profile) return;
  renderTopbar();
  const fn = VIEWS[S.view] || viewCourt;
  $('#main').innerHTML = fn();
  bindView();
}

function goTo(view) {
  S.view = view;
  document
    .querySelectorAll('.nav')
    .forEach((x) => x.classList.toggle('active', x.dataset.view === view));
  render();
}

function bindView() {
  const main = $('#main');

  main.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => onAction(btn.dataset.act, btn));
  });
  main.querySelectorAll('[data-person]').forEach((node) => {
    node.addEventListener('click', () => openPerson(Number(node.dataset.person)));
  });
  main.querySelectorAll('[data-peer]').forEach((node) => {
    node.addEventListener('click', () => openThread(Number(node.dataset.peer)));
  });

  const dmForm = main.querySelector('#dm-form');
  if (dmForm) {
    dmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = main.querySelector('#dm-text');
      const text = input.value.trim();
      if (!text || !S.activePeer) return;
      try {
        await API.dm(S.activePeer, text);
        input.value = '';
        await openThread(S.activePeer);
      } catch (err) {
        toast(errText(err), 'err');
      }
    });
  }

  main.querySelectorAll('[data-join]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await API.joinFaction(Number(btn.dataset.join));
        toast('已入党中。');
        await refreshAll();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
  });

  const pe = main.querySelector('#btn-promote');
  if (pe) pe.addEventListener('click', onPromote);

  const oe = main.querySelector('#open-event');
  if (oe) oe.addEventListener('click', showEvent);

  const cf = main.querySelector('#btn-create-faction');
  if (cf)
    cf.addEventListener('click', async () => {
      const name = main.querySelector('#faction-name').value.trim();
      const doctrine = main.querySelector('#faction-doctrine').value;
      if (!name) return toast('请取党名。', 'warn');
      try {
        await API.createFaction(name, doctrine);
        toast(`「${name}」已立。`);
        await refreshAll();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });

  const dn = main.querySelector('#btn-donate');
  if (dn)
    dn.addEventListener('click', async () => {
      const amount = Number(prompt('输金多少两入党库？', '100'));
      if (!amount) return;
      try {
        await API.donateFaction(amount);
        toast(`已输金 ${amount} 两。`);
        await refreshAll();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });

  const lf = main.querySelector('#btn-leave-faction');
  if (lf)
    lf.addEventListener('click', async () => {
      if (!confirm('退党将损失人脉与声望，确定？')) return;
      try {
        await API.leaveFaction();
        toast('已退党。');
        await refreshAll();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });

  const rs = main.querySelector('#roster-search');
  if (rs)
    rs.addEventListener('input', async () => {
      try {
        const { list } = await API.players(rs.value.trim());
        const grid = main.querySelector('#people-grid');
        grid.innerHTML = list.map(personHTML).join('') || `<p class="hint">查无此人。</p>`;
        grid.querySelectorAll('[data-person]').forEach((n) =>
          n.addEventListener('click', () => openPerson(Number(n.dataset.person)))
        );
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
}

/* ────────── 交互 ────────── */

async function onAction(key, btn) {
  if (S.busy) return;
  const a = S.actions.find((x) => x.key === key);
  if (!a) return;

  const run = async (targetId) => {
    S.busy = true;
    btn.disabled = true;
    try {
      const res = await API.act(key, targetId);
      (res.logs || []).forEach((l) => toast(l, 'ok', 5200));
      if (res.impeachment) toast(res.impeachment.message, 'err', 8000);
      S.profile = res.profile;
      await refreshAll();
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      S.busy = false;
      btn.disabled = false;
    }
  };

  if (a.target === 'player') {
    pickTarget(`施行「${a.name}」——择一人`, (p) => run(p.id));
  } else {
    await run(null);
  }
}

async function onPromote() {
  if (!confirm('递呈铨选？铨选有成算，若落空将小损圣眷与声望。')) return;
  try {
    const res = await API.promote();
    toast(res.message, res.success ? 'ok' : 'warn', 8000);
    S.profile = res.profile;
    await refreshAll();
  } catch (e) {
    toast(errText(e), 'err');
  }
}

function showEvent() {
  const ev = S.events[0];
  if (!ev) return;
  const { wrap, close } = modal({
    title: ev.title,
    bodyHTML: `<p class="event-text">${esc(ev.text)}</p>
      <div class="event-options">
        ${ev.options
          .map(
            (o) => `<button class="eopt" data-opt="${esc(o.key)}">
              <div class="l">${esc(o.label)}</div>
              <div class="d">${esc(o.desc)}</div>
              ${
                Object.keys(o.cost || {}).length
                  ? `<div class="c">耗费：${Object.entries(o.cost)
                      .map(([k, v]) => `${k} ${v}`)
                      .join('、')}</div>`
                  : ''
              }
            </button>`
          )
          .join('')}
      </div>`,
  });
  wrap.querySelectorAll('[data-opt]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const res = await API.resolveEvent(ev.id, btn.dataset.opt);
        close();
        toast(res.line, 'ok', 7000);
        S.profile = res.profile;
        await refreshAll();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
  });
}

async function openThread(peerId) {
  S.activePeer = peerId;
  try {
    const { list } = await API.dmHistory(peerId);
    S.messages = list;
    const t = S.threads.find((x) => x.peerId === peerId);
    if (t) t.unread = 0;
    render();
  } catch (e) {
    toast(errText(e), 'err');
  }
}

async function openPerson(id) {
  try {
    const { player } = await API.player(id);
    const rels = (player.relations || [])
      .map((r) => `<span class="rel-badge ${esc(r.type)}">${esc(REL_NAME[r.type] || r.type)} ${r.strength}</span>`)
      .join(' ');
    const { wrap, close } = modal({
      title: player.name,
      bodyHTML: `
        ${player.npc ? '<div style="margin-bottom:10px"><span class="npc-badge">朝廷旧人</span> <span class="hint">此人自开朝便在列，根基深厚，动之须慎。</span></div>' : ''}
        <div class="kv"><span class="k">本官</span><span class="v">${esc(player.grade)}${esc(player.title)}</span></div>
        <div class="kv"><span class="k">职任</span><span class="v">${esc(player.organ || '待铨')}</span></div>
        <div class="kv"><span class="k">权势</span><span class="v">${player.power}</span></div>
        <div class="kv"><span class="k">声望</span><span class="v">${player.renown}</span></div>
        <div class="kv"><span class="k">人脉</span><span class="v">${player.network}</span></div>
        <div class="kv"><span class="k">在任</span><span class="v">${player.tenure} 回合</span></div>
        <div class="kv"><span class="k">党派</span><span class="v">${esc(player.faction?.name || '无党')}</span></div>
        <div style="margin-top:10px">${rels || '<span class="hint">与你素无往来。</span>'}</div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn sm" data-do="dm">递私函</button>
          <button class="btn sm" data-do="gift">赠礼</button>
          <button class="btn sm" data-do="letter">修书</button>
        </div>`,
      footerHTML: `<button class="btn ghost" data-close>罢</button>`,
    });
    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.querySelectorAll('[data-do]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const doKey = btn.dataset.do;
        close();
        if (doKey === 'dm') {
          goTo('inbox');
          await openThread(player.id);
          return;
        }
        await onAction(doKey, btn);
      });
    });
  } catch (e) {
    toast(errText(e), 'err');
  }
}

/* ────────── 右栏 ────────── */

function renderRoster() {
  $('#online-count').textContent = S.roster.length;
  $('#roster').innerHTML =
    S.roster
      .map(
        (r) => `<div class="roster-item" data-person="${r.id}">
          <span class="dot"></span>
          <span>${esc(r.name)}</span>
          <span class="t">${esc(r.title || '')}</span>
        </div>`
      )
      .join('') || '<div style="color:var(--ink-3);font-size:12.5px">四野无人。</div>';
  $('#roster')
    .querySelectorAll('[data-person]')
    .forEach((n) => n.addEventListener('click', () => openPerson(Number(n.dataset.person))));
}

function renderChat() {
  const box = $('#chat');
  const list = S.chat.filter((m) => (m.channel || 'global') === S.channel).slice(-60);

  if (S.channel === 'faction' && !S.profile?.faction) {
    box.innerHTML = `<div class="chat-line"><span class="sys">你尚未结党，党内密议与你无关。</span></div>`;
    return;
  }

  box.innerHTML =
    list
      .map((m) => {
        if (m.sys) return `<div class="chat-line"><span class="sys">${esc(m.text)}</span></div>`;
        return `<div class="chat-line"><b>${esc(m.name)}</b>：${esc(m.text)}</div>`;
      })
      .join('') || `<div class="chat-line"><span class="sys">暂无言语。</span></div>`;
  box.scrollTop = box.scrollHeight;
}

/* ────────── 数据刷新 ────────── */

async function refreshAll() {
  const [me, court, board, gz, players, factions, events, threads] = await Promise.all([
    API.me(),
    API.court(),
    API.leaderboard(),
    API.gazette(60),
    API.players(),
    API.factions(),
    API.events(),
    API.dmThreads(),
  ]);
  S.profile = me.profile;
  S.court = court;
  S.board = board.list;
  S.gazette = gz.list;
  S.players = players.list;
  S.factions = factions.list;
  S.doctrines = factions.doctrines;
  S.events = events.events;
  S.threads = threads.list;

  $('#tick-badge').textContent = `第 ${court.tick} 回合`;
  S.socket?.emit('faction:join-room');
  render();
  renderRoster();
}

async function refreshLight() {
  const [me, court, gz, events] = await Promise.all([
    API.me(),
    API.court(),
    API.gazette(60),
    API.events(),
  ]);
  S.profile = me.profile;
  S.court = court;
  S.gazette = gz.list;
  S.events = events.events;
  $('#tick-badge').textContent = `第 ${court.tick} 回合`;
  render();
}

/* ────────── 实时 ────────── */

function connectRealtime() {
  const socket = io({ auth: { token: API.token.token } });
  S.socket = socket;

  socket.on('connect_error', () => {
    S.chat.push({ sys: true, text: '与朝堂的联络中断了。' });
    renderChat();
  });

  socket.on('hello', (d) => {
    S.roster = d.roster || [];
    S.chat = (d.history || []).map((m) => ({
      name: m.name,
      text: m.text,
      channel: m.channel || 'global',
    }));
    if (S.profile?.faction) socket.emit('faction:join-room');
    renderRoster();
    renderChat();
  });

  socket.on('roster', (r) => {
    S.roster = r || [];
    renderRoster();
  });

  socket.on('chat', (m) => {
    S.chat.push({ name: m.name, text: m.text, channel: m.channel || 'global' });
    renderChat();
  });

  socket.on('gazette', (g) => {
    S.gazette.unshift({ id: Date.now(), kind: g.kind, text: g.text, created_at: g.at });
    if (S.view === 'gazette' || S.view === 'court') render();
  });

  socket.on('tick', async (d) => {
    $('#tick-badge').textContent = `第 ${d.tick} 回合`;
    S.chat.push({ sys: true, channel: 'global', text: `—— 第 ${d.tick} 回合 ——` });
    renderChat();
    try {
      await refreshLight();
    } catch {
      /* 忽略 */
    }
  });

  socket.on('dm', (m) => {
    const mine = m.from === S.profile.id;
    toast(`私函 · ${mine ? '致 ' + m.name : m.name}：${m.text}`, 'warn', 6000);
  });
}

/* ────────── 登录 ────────── */

function bindGate() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#form-${tab.dataset.tab}`).classList.add('active');
      $('#gate-msg').textContent = '';
    });
  });

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const res = await API.login(f.get('username'), f.get('password'));
      enter(res.token);
    } catch (err) {
      $('#gate-msg').textContent = errText(err);
    }
  });

  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const res = await API.register(f.get('username'), f.get('displayName'), f.get('password'));
      enter(res.token);
    } catch (err) {
      $('#gate-msg').textContent = errText(err);
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    if (!confirm('去位登出？（不会清除你的存档）')) return;
    try {
      await API.logout();
    } catch {
      /* 忽略 */
    }
    API.token.token = null;
    location.reload();
  });

  document.querySelectorAll('.chan-switch .ch').forEach((btn) => {
    btn.addEventListener('click', () => {
      S.channel = btn.dataset.ch;
      document
        .querySelectorAll('.chan-switch .ch')
        .forEach((b) => b.classList.toggle('active', b === btn));
      $('#chat-text').placeholder = S.channel === 'faction' ? '党内密议…' : '当众说一句…';
      if (S.channel === 'faction') S.socket?.emit('faction:join-room');
      renderChat();
    });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-text');
    const text = input.value.trim();
    if (!text || !S.socket) return;
    if (S.channel === 'faction' && !S.profile?.faction) {
      toast('你尚未结党，无从密议。', 'warn');
      return;
    }
    S.socket.emit('chat', { channel: S.channel, text });
    input.value = '';
  });
}

/* ────────── 启动 ────────── */

async function enter(token) {
  API.token.token = token;
  $('#gate').classList.add('hidden');
  $('#app').classList.remove('hidden');
  try {
    await refreshAll();
  } catch (e) {
    toast(errText(e), 'err');
  }
  connectRealtime();
  setInterval(() => {
    refreshLight().catch(() => {});
  }, 20000);
}

async function boot() {
  const [acts, ranks, meta] = await Promise.all([
    API.actions().catch(() => ({ actions: [], paths: {} })),
    API.ranks().catch(() => ({ ranks: [], organs: [] })),
    API.get('/api/meta').catch(() => ({ const: { TICK_MS: 180000 } })),
  ]);
  S.actions = acts.actions;
  S.paths = acts.paths;
  S.ranks = ranks.ranks;
  S.organs = ranks.organs;
  if (meta.const) S.const = meta.const;

  if (API.token.token) {
    try {
      await enter(API.token.token);
      return;
    } catch {
      API.token.token = null;
    }
  }
  $('#gate').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  bindGate();

  document.querySelectorAll('.nav').forEach((n) => {
    n.addEventListener('click', () => goTo(n.dataset.view));
  });

  boot().catch((e) => {
    console.error(e);
    $('#gate-msg').textContent = '与服务器失联，请稍后重试。';
    $('#gate').classList.remove('hidden');
  });
});
