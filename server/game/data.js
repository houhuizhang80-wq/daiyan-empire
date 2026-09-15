/**
 * 《大衍帝国》静态世界观数据
 * 全部为架空设定，与现实任何机构、职官体系无关。
 */

/* ------------------------------------------------------------------ *
 * 一、品级（十八阶）
 * ------------------------------------------------------------------ */

export const GRADES = {
  '从九品': 0,
  '正九品': 1,
  '从八品': 2,
  '正八品': 3,
  '从七品': 4,
  '正七品': 5,
  '从六品': 6,
  '正六品': 7,
  '从五品': 8,
  '正五品': 9,
  '从四品': 10,
  '正四品': 11,
  '从三品': 12,
  '正三品': 13,
  '从二品': 14,
  '正二品': 15,
  '从一品': 16,
  '正一品': 17,
};

/* ------------------------------------------------------------------ *
 * 二、官署（衙门）
 * ------------------------------------------------------------------ */

export const ORGANS = {
  county: {
    key: 'county',
    name: '县衙',
    tier: 'local',
    scope: '地方',
    desc: '最基层的治理单元。钱谷刑名、催科劝农，皆出于此。',
  },
  commandery: {
    key: 'commandery',
    name: '郡府',
    tier: 'local',
    scope: '地方',
    desc: '统辖数县，上承州府、下理民事，是外官升转的要冲。',
  },
  prefecture: {
    key: 'prefecture',
    name: '州衙',
    tier: 'local',
    scope: '地方',
    desc: '一州之政，兼理军民钱谷，权重而事繁。',
  },
  personnel: {
    key: 'personnel',
    name: '铨曹',
    tier: 'central',
    scope: '中枢',
    desc: '掌天下官吏铨选考课。谁上谁下，一纸批红而已。',
  },
  revenue: {
    key: 'revenue',
    name: '度支曹',
    tier: 'central',
    scope: '中枢',
    desc: '掌天下钱谷、漕运、仓储。财权即命脉。',
  },
  rites: {
    key: 'rites',
    name: '仪制曹',
    tier: 'central',
    scope: '中枢',
    desc: '掌典礼、科举、藩属往来。清贵而无实权，却是进身之阶。',
  },
  war: {
    key: 'war',
    name: '武备曹',
    tier: 'central',
    scope: '中枢',
    desc: '掌军籍、武选、舆马。中枢唯一握兵符的衙门。',
  },
  justice: {
    key: 'justice',
    name: '刑名曹',
    tier: 'central',
    scope: '中枢',
    desc: '掌律令、审谳、勾决。生死予夺，尽在案牍。',
  },
  works: {
    key: 'works',
    name: '营造曹',
    tier: 'central',
    scope: '中枢',
    desc: '掌营造、河工、驿传。油水最厚，也最易沾泥。',
  },
  censorate: {
    key: 'censorate',
    name: '都察院',
    tier: 'central',
    scope: '中枢',
    desc: '风闻奏事，纠弹百僚。人人畏之，亦人人恨之。',
  },
  academy: {
    key: 'academy',
    name: '翰林院',
    tier: 'central',
    scope: '中枢',
    desc: '储相之地。清苦数年，一出便是要路。',
  },
  judicial: {
    key: 'judicial',
    name: '大理寺',
    tier: 'central',
    scope: '中枢',
    desc: '掌天下刑狱复核，与刑名曹互相驳正。',
  },
  cabinet: {
    key: 'cabinet',
    name: '内阁',
    tier: 'apex',
    scope: '中枢',
    desc: '票拟批红之所。天下事无大小，皆由此出。',
  },
};

/* ------------------------------------------------------------------ *
 * 三、官阶表
 *   slots: null = 不限员额（基层）；数字 = 该官职在单个衙门中的员额
 *   salary: 每回合（tick）俸禄（银两）
 *   mandate: 每回合恢复的政令点
 * ------------------------------------------------------------------ */

export const RANKS = [
  {
    id: 0,
    grade: '从九品',
    title: '书办',
    organ: 'county',
    slots: null,
    salary: 6,
    mandate: 10,
    cap: 40,
    note: '抄写文书，跑腿传话。入仕的第一步，也是最泥泞的一步。',
  },
  {
    id: 1,
    grade: '正九品',
    title: '主簿',
    organ: 'county',
    slots: null,
    salary: 10,
    mandate: 12,
    cap: 90,
    note: '掌一县簿籍钱粮，开始摸得到实在的东西。',
  },
  {
    id: 2,
    grade: '从八品',
    title: '县丞',
    organ: 'county',
    slots: null,
    salary: 16,
    mandate: 14,
    cap: 170,
    note: '县令之副，分理粮马、水利、刑名。',
  },
  {
    id: 3,
    grade: '正八品',
    title: '典史',
    organ: 'county',
    slots: null,
    salary: 24,
    mandate: 16,
    cap: 280,
    note: '掌缉捕、狱囚。手里第一次有了能压人的东西。',
  },
  {
    id: 4,
    grade: '从七品',
    title: '县令',
    organ: 'county',
    slots: 3,
    salary: 40,
    mandate: 20,
    cap: 460,
    note: '一县之主，百里之侯。从此有了署衙、有了属吏、有了名分。',
  },
  {
    id: 5,
    grade: '正七品',
    title: '州判',
    organ: 'prefecture',
    slots: 2,
    salary: 62,
    mandate: 24,
    cap: 700,
    note: '分理州务，开始接触跨县的调度与人事。',
  },
  {
    id: 6,
    grade: '从六品',
    title: '州同知',
    organ: 'prefecture',
    slots: 2,
    salary: 95,
    mandate: 28,
    cap: 1000,
    note: '州之副贰，兼理屯田、水利、盐铁。',
  },
  {
    id: 7,
    grade: '正六品',
    title: '郡丞',
    organ: 'commandery',
    slots: 2,
    salary: 140,
    mandate: 34,
    cap: 1400,
    note: '郡守之副，代拆代行。一郡的关节皆由此过。',
  },
  {
    id: 8,
    grade: '从五品',
    title: '郡守',
    organ: 'commandery',
    slots: 1,
    salary: 210,
    mandate: 42,
    cap: 2000,
    note: '一郡之长。外官中的实权顶点，再往上便是中枢。',
  },
  {
    id: 9,
    grade: '正五品',
    title: '郎中',
    organ: '*',
    slots: 2,
    salary: 300,
    mandate: 50,
    cap: 2800,
    note: '入中枢，掌一曹之某一司。第一次看得见天下全局。',
  },
  {
    id: 10,
    grade: '从四品',
    title: '员外郎',
    organ: '*',
    slots: 2,
    salary: 430,
    mandate: 60,
    cap: 3900,
    note: '郎中之副，却常是真正办事的人。',
  },
  {
    id: 11,
    grade: '正四品',
    title: '侍郎',
    organ: '*',
    slots: 1,
    salary: 620,
    mandate: 72,
    cap: 5400,
    note: '一曹之副堂官。堂上议事，已有你一席。',
  },
  {
    id: 12,
    grade: '从三品',
    title: '大理寺卿',
    organ: 'judicial',
    slots: 1,
    salary: 880,
    mandate: 86,
    cap: 7400,
    note: '天下刑狱的最后一关。驳得倒谁，驳不倒谁，都是学问。',
  },
  {
    id: 13,
    grade: '正三品',
    title: '左都御史',
    organ: 'censorate',
    slots: 1,
    salary: 1200,
    mandate: 100,
    cap: 10000,
    note: '掌纠弹之柄。你一开口，满朝都要看你的脸色。',
  },
  {
    id: 14,
    grade: '从二品',
    title: '尚书',
    organ: '*',
    slots: 1,
    salary: 1700,
    mandate: 118,
    cap: 14000,
    note: '一曹堂官。执掌一部之政，进退皆系于一身。',
  },
  {
    id: 15,
    grade: '正二品',
    title: '群辅',
    organ: 'cabinet',
    slots: 4,
    salary: 2400,
    mandate: 138,
    cap: 20000,
    note: '入阁参预机务。从这一步起，你写的字就是国策。',
  },
  {
    id: 16,
    grade: '从一品',
    title: '次辅',
    organ: 'cabinet',
    slots: 1,
    salary: 3400,
    mandate: 162,
    cap: 29000,
    note: '一人之下。离那把椅子，只差一次倒台。',
  },
  {
    id: 17,
    grade: '正一品',
    title: '首辅',
    organ: 'cabinet',
    slots: 1,
    salary: 5000,
    mandate: 190,
    cap: 42000,
    note: '票拟之首，代天子理万机。天下无人不可用，亦无人不可弃。',
  },
];

export const RANK_BY_ID = new Map(RANKS.map((r) => [r.id, r]));
export const MAX_RANK = RANKS.length - 1;

/** 需要占缺的官阶（有限员额） */
export const CONTESTED_FROM = 4;

/* ------------------------------------------------------------------ *
 * 四、派系倾向
 * ------------------------------------------------------------------ */

export const DOCTRINES = {
  qingliu: {
    key: 'qingliu',
    name: '清流',
    desc: '重名节、尚清议。声望加成高，暗线代价大。',
    meritMul: 1.0,
    renownMul: 1.35,
    guileMul: 0.6,
    exposureMul: 1.6,
  },
  shiwu: {
    key: 'shiwu',
    name: '实务',
    desc: '重钱谷、尚效能。政绩与银两见长，声望平平。',
    meritMul: 1.35,
    renownMul: 0.85,
    guileMul: 1.0,
    exposureMul: 1.0,
  },
  shoucheng: {
    key: 'shoucheng',
    name: '守成',
    desc: '因循持重。风险最低，晋升也最慢。',
    meritMul: 0.85,
    renownMul: 1.0,
    guileMul: 0.9,
    exposureMul: 0.7,
  },
  jijin: {
    key: 'jijin',
    name: '激进',
    desc: '锐意更张。收益极高，翻车也极快。',
    meritMul: 1.6,
    renownMul: 1.1,
    guileMul: 1.25,
    exposureMul: 1.35,
  },
};

/* ------------------------------------------------------------------ *
 * 五、关系类型
 * ------------------------------------------------------------------ */

export const RELATION_TYPES = {
  patron: { key: 'patron', name: '恩主', desc: '提携你的人。他的倒台会牵连你。' },
  protege: { key: 'protege', name: '门生', desc: '你提携的人。你的倒台会牵连他。' },
  ally: { key: 'ally', name: '盟友', desc: '共进退，同荣辱。' },
  rival: { key: 'rival', name: '政敌', desc: '同路相争，早晚要分个高下。' },
  nemesis: { key: 'nemesis', name: '死敌', desc: '不共戴天。对方必欲除你而后快。' },
  kin: { key: 'kin', name: '姻亲', desc: '以婚姻结成的利益共同体。' },
  confidant: { key: 'confidant', name: '心腹', desc: '可以托付隐秘之事的人。' },
};

/* ------------------------------------------------------------------ *
 * 六、邸报事件模板（随机事件）
 * ------------------------------------------------------------------ */

export const EVENT_TEMPLATES = [
  {
    key: 'flood',
    weight: 10,
    minRank: 0,
    maxRank: 17,
    title: '河决',
    text: '辖境河水暴涨，堤岸告急。',
    options: [
      {
        key: 'open_granary',
        label: '开仓赈济',
        cost: { silver: 120 },
        effect: { merit: 26, renown: 18, favor: 6 },
        desc: '耗银百二十两，得民心。',
      },
      {
        key: 'report',
        label: '飞章上报',
        cost: {},
        effect: { merit: 6, favor: -4 },
        desc: '稳妥，但无功。',
      },
      {
        key: 'conceal',
        label: '隐匿不报',
        cost: {},
        effect: { silver: 90, merit: -14, exposure: 12 },
        desc: '保住考成，但留下把柄。',
      },
    ],
  },
  {
    key: ' impeachment',
    weight: 8,
    minRank: 4,
    maxRank: 17,
    title: '风闻',
    text: '都察院有人递了折子，指名道姓，说你用人失察。',
    options: [
      {
        key: 'defend',
        label: '上疏自辩',
        cost: { mandate: 2 },
        effect: { renown: 12, favor: -6 },
        desc: '硬顶回去，清议称许。',
      },
      {
        key: 'bribe',
        label: '私下疏通',
        cost: { silver: 260 },
        effect: { exposure: 14, favor: 4 },
        desc: '银子能压事，也能留痕。',
      },
      {
        key: 'sacrifice',
        label: '弃车保帅',
        cost: {},
        effect: { renown: -16, network: -12, favor: 8 },
        desc: '推一个下属出去顶罪。',
      },
    ],
  },
  {
    key: 'vacancy',
    weight: 12,
    minRank: 3,
    maxRank: 17,
    title: '缺出',
    text: '上头有位子空出来了，几个够格的人都在盯着。',
    options: [
      {
        key: 'self_recommend',
        label: '毛遂自荐',
        cost: { mandate: 3 },
        effect: { favor: 10, renown: 5 },
        desc: '直接要，成不成看圣眷。',
      },
      {
        key: 'ask_patron',
        label: '求恩主举荐',
        cost: { silver: 180 },
        effect: { favor: 16, network: -6 },
        desc: '人情是要还的。',
      },
      {
        key: 'wait',
        label: '静观其变',
        cost: {},
        effect: { guile: 6 },
        desc: '看清楚谁在动，再决定。',
      },
    ],
  },
  {
    key: 'treasure',
    weight: 9,
    minRank: 0,
    maxRank: 17,
    title: '厚礼',
    text: '某位属官深夜求见，奉上一只木匣，说是"家乡土仪"。',
    options: [
      {
        key: 'accept',
        label: '收下',
        cost: {},
        effect: { silver: 400, exposure: 20, network: 8 },
        desc: '银两可观，痕迹也留下了。',
      },
      {
        key: 'refuse',
        label: '原物退回',
        cost: {},
        effect: { renown: 20, favor: 6, network: -6 },
        desc: '清名可嘉，但得罪了人。',
      },
      {
        key: 'leverage',
        label: '收下并记档',
        cost: {},
        effect: { silver: 300, guile: 14, exposure: 10 },
        desc: '东西收了，把柄也捏住了。',
      },
    ],
  },
  {
    key: 'famine',
    weight: 8,
    minRank: 4,
    maxRank: 17,
    title: '岁歉',
    text: '秋收大减，米价一日三涨，城外已有流民聚集。',
    options: [
      {
        key: 'relief',
        label: '请拨赈银',
        cost: { mandate: 4 },
        effect: { merit: 32, renown: 22, silver: -100 },
        desc: '政绩声望双收，自己贴钱。',
      },
      {
        key: 'hoard',
        label: '囤积待价',
        cost: { silver: 150 },
        effect: { silver: 620, merit: -26, renown: -20, exposure: 16 },
        desc: '一本万利，也一步深渊。',
      },
      {
        key: 'suppress',
        label: '弹压流民',
        cost: { mandate: 2 },
        effect: { merit: 8, renown: -18, favor: 10 },
        desc: '上峰满意，清议骂你。',
      },
    ],
  },
  {
    key: 'literati',
    weight: 9,
    minRank: 2,
    maxRank: 17,
    title: '文会',
    text: '本地士绅设宴雅集，邀你主盟。',
    options: [
      {
        key: 'attend',
        label: '欣然赴会',
        cost: { silver: 60 },
        effect: { network: 18, renown: 12 },
        desc: '人脉与清名，一次办齐。',
      },
      {
        key: 'send_deputy',
        label: '遣人代往',
        cost: {},
        effect: { network: 6 },
        desc: '不失礼，也不出彩。',
      },
      {
        key: 'decline',
        label: '谢绝',
        cost: {},
        effect: { merit: 8, network: -8 },
        desc: '勤于案牍，疏于人情。',
      },
    ],
  },
  {
    key: 'patron_fall',
    weight: 7,
    minRank: 5,
    maxRank: 17,
    title: '座师出事',
    text: '当年提携你的那位老大人，被人参了。',
    options: [
      {
        key: 'stand',
        label: '挺身相救',
        cost: { mandate: 3, silver: 200 },
        effect: { network: 26, favor: -12, renown: 18 },
        desc: '义气换人脉，代价是上峰的不快。',
      },
      {
        key: 'silence',
        label: '闭门不言',
        cost: {},
        effect: { network: -16, favor: 6, exposure: -6 },
        desc: '保全自己，寒了人心。',
      },
      {
        key: 'join',
        label: '顺势参一本',
        cost: { mandate: 2 },
        effect: { favor: 18, network: -30, renown: -24, guile: 12 },
        desc: '踩着恩主往上走。走得快，也走得绝。',
      },
    ],
  },
  {
    key: 'secret_letter',
    weight: 7,
    minRank: 6,
    maxRank: 17,
    title: '密札',
    text: '一封没有署名的信送到案头，只写了四个字：「月满则亏」。',
    options: [
      {
        key: 'burn',
        label: '焚之',
        cost: {},
        effect: { exposure: -18, guile: 6 },
        desc: '不管是谁，先把痕迹清干净。',
      },
      {
        key: 'investigate',
        label: '暗中查访',
        cost: { silver: 120 },
        effect: { guile: 20, network: 8, exposure: 6 },
        desc: '你想知道是谁在看你。',
      },
      {
        key: 'reply',
        label: '回帖试探',
        cost: { mandate: 1 },
        effect: { guile: 12, exposure: 14, network: 14 },
        desc: '入局容易，出局难。',
      },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * 七、世界常量
 * ------------------------------------------------------------------ */

export const CONST = {
  TICK_MS: 3 * 60 * 1000, // 一回合 = 3 分钟
  START_SILVER: 320,
  START_RANK: 0,
  MAX_EXPOSURE: 100,
  /**
   * 弹劾警戒线。暴露度越过此线之后，被台谏盯上的风险随暴露度线性上升，
   * 直到拉满时达到 IMPEACH_RATE。
   *
   * 刻意用软阈值而非「满 100 即发」：硬阈值会让「差一点」与「刚好越线」
   * 判若云泥，玩家无从判断该收手到什么程度，实测在 90 与 93 之间弹劾率
   * 会从 60% 直落 20%，完全无法调校。
   *
   * 取值 78 / 0.22 由跑批扫参定出（scripts/sim.js，30 人 × 400 回合）：
   *   warn=62 rate=0.45 → 权臣 9.8/11，100% 被弹劾 —— 暗线被打死，上不去
   *   warn=70 rate=0.35 → 权臣 10.4/15，100% —— 仍是必死
   *   warn=75 rate=0.30 → 权臣 10.9/15， 90% —— 接近可用
   *   warn=78 rate=0.22 → 权臣 10.9/15， 50% —— 略高于循吏，代价明确
   */
  IMPEACH_WARN: 78,
  /** 暴露度拉满时每回合被弹劾的概率 */
  IMPEACH_RATE: 0.22,
  /** 每回合暴露度自然衰减 */
  EXPOSURE_DECAY: 7,
  /**
   * 暴露度对圣眷的持续侵蚀系数。
   * 暴露度 60、官阶系数 2 时，每回合流失约 12 点圣眷 —— 约占同阶圣眷收入的四分之一。
   * 这是暗线「悬着」的日常代价，不靠弹劾也能让高位者感到压力。
   */
  EXPOSURE_EROSION: 0.18,
  /** 每回合恢复精力 */
  HEALTH_REGEN: 12,
  /** 晋升后的冷却回合数 */
  PROMOTION_COOLDOWN_TICKS: 2,

  /* ── 心腹体系 ──
   * 心腹最实际的用处是「代行」：你手上干净，脏活有人干。
   * 暗线行动产生的痕迹，由心腹按交情深浅分摊一部分。
   */
  /** 单次行动中，心腹能替你分担的痕迹比例上限。不到一半 —— 心腹不是替罪羊 */
  CONFIDANT_SHARE: 0.45,
  /** 交情低于此值，他不肯替你担事（托付了也只会被推回来） */
  CONFIDANT_TRUST: 30,
  /** 交情不足却硬要托付时，他反口告发的概率 */
  CONFIDANT_BETRAY: 0.25,
  /** 心腹落马时，托付他的东家受牵连的程度 */
  CONFIDANT_IMPLICATION: 0.6,

  /* ── 姻亲与家族 ── */
  /** 落马时姻亲受牵连的程度（连坐） */
  KIN_IMPLICATION: 0.5,
  /** 联姻一次可提升的家族势力上限（用于展示与判定） */
  KIN_POWER_CAP: 999999,
};

/* ------------------------------------------------------------------ *
 * 八、初始属性与资源
 * ------------------------------------------------------------------ */

export const DEFAULT_STATS = {
  merit: 0,
  renown: 0,
  guile: 0,
  network: 0,
  favor: 0,
  exposure: 0,
  health: 100,
};

export const DEFAULT_RESOURCES = {
  silver: CONST.START_SILVER,
  mandate: 10,
  influence: 0,
  leverage: 0,
};

/* ------------------------------------------------------------------ *
 * 九、官阶派生工具（纯函数，供引擎与朝臣建制共用）
 * ------------------------------------------------------------------ */

/** 中枢六曹 —— 官阶 organ 为 '*' 时轮转的衙门 */
export const CENTRAL_ORGAN_KEYS = ['personnel', 'revenue', 'rites', 'war', 'justice', 'works'];

/** 某官阶的总员额；null 表示不限员额 */
export function totalSlots(rankId) {
  const rank = RANK_BY_ID.get(rankId);
  if (!rank || rank.slots === null) return null;
  return rank.organ === '*' ? rank.slots * CENTRAL_ORGAN_KEYS.length : rank.slots;
}

/** 某官阶可授予的衙门列表 */
export function organKeysForRank(rankId) {
  const rank = RANK_BY_ID.get(rankId);
  if (!rank) return [];
  return rank.organ === '*' ? CENTRAL_ORGAN_KEYS : [rank.organ];
}

/**
 * 员额动态下限：按「真人玩家数」放量，防止少数几个缺额把整个晋升通道堵死。
 * 键为官阶 id，值为「每名玩家应配给的缺额数」。
 * 中枢高位（12 及以上）刻意不放量 —— 顶层必须稀缺，那是博弈的靶心。
 */
export const SLOT_SCALE = {
  4: 0.3, // 县令
  5: 0.25, // 州判
  6: 0.2, // 州同知
  7: 0.18, // 郡丞
  8: 0.12, // 郡守
  9: 0.4, // 郎中
  10: 0.4, // 员外郎
  11: 0.2, // 侍郎
};

/* ------------------------------------------------------------------ *
 * 十、官阶收益系数（数值平衡的核心杠杆）
 * ------------------------------------------------------------------ */

/**
 * 一阶之差，能动用的人力物力相差极大。
 *
 * 铨选门槛（cap）逐级 ×1.4，若行动收益恒定，则升一级所需回合数也逐级 ×1.4 ——
 * 实测 600 回合只能爬到第 11 级，顶层永远不可达（第 12 级需约 800 回合）。
 * 因此收益必须随官阶同步放大，使「升一级所需的经营回合数」大致持平、
 * 仅缓慢递增，顶层才是可抵达的。
 *
 * 以从九品书办为 1.0，逐级 ×1.02：正一品首辅约为书办的 1.4 倍。
 *
 * 扫参记录（30 人 × 400 回合，scripts/sim.js --yield=）：
 *   1.06 → 均阶 11.9，全员越过正四品，官阶体系失去意义
 *   1.05 → 均阶 11.3，仍偏快
 *   1.02 → 均阶 10.3，落在 3–11 的目标区间内（权臣 10.9 / 干吏 10.6 / 循吏 10.2）
 *
 * 系数不宜再大 —— 实测 1.18 时 600 回合内全员拜相；而瓶颈其实在缺额容量
 * （SLOT_SCALE），不在收益，故只需温和的补偿。
 */
export const YIELD_BASE = 1.02;

export const RANK_YIELD = new Map(
  RANKS.map((r) => [r.id, Number(Math.pow(YIELD_BASE, r.id).toFixed(3))])
);

/** 某官阶的收益倍率 */
export function rankYield(rankId) {
  return RANK_YIELD.get(rankId) ?? 1;
}

/**
 * 银两口径系数。
 *
 * 俸禄随官阶增长近千倍（6 → 5000），而各项打点的开价是固定数 ——
 * 若不换算，同一份礼在末吏是半月俸禄，在首辅则不值一提，银两也就失去约束力。
 * 以县令（从七品）为基准 1.0，使「一次打点值几回合俸禄」在各阶大致相同。
 */
export function silverScale(rankId) {
  const rank = RANK_BY_ID.get(rankId);
  if (!rank) return 1;
  return rank.salary / 40;
}
