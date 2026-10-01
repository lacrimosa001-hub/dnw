/* ============================================================
 *  合成大W · Suika Game
 *  纯原生 HTML + CSS + JavaScript，无任何依赖。
 *
 *  物理：PBD（位置约束求解）—— 3 个子步 × 6 次迭代，
 *        静止堆叠稳定，不抖动。
 *  玩法：相同等级接触即合成高一级；顶到警戒线超时判负。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------
   *  常量
   * ------------------------------------------------------- */

  const W = 420;             // 逻辑宽度
  const H = 700;             // 逻辑高度
  const WALL = 10;           // 左右墙厚
  const DROP_Y = 74;         // 待投放水果的高度
  const DANGER_Y = 142;      // 警戒线

  const GRAVITY   = 2600;    // px/s²
  const SUBSTEPS  = 3;       // 每帧物理子步
  const ITER      = 6;       // 每个子步的约束迭代次数
  const DROP_MS   = 360;     // 两次投放的最小间隔
  const OVER_LIMIT = 1.5;    // 越线持续多少秒判负
  const REST_SPEED = 140;    // 线上方且速度低于它才算“卡住”（被弹飞路过的不算）
  const REST_SPEED2 = REST_SPEED * REST_SPEED;

  const MAX_TIER  = 7;       // 最高级（暴怒）的索引
  const MAX_BONUS = 100;     // 两个最高级（暴怒）相撞的额外奖励分
  const MERGE_PAD = 0.8;     // 合成判定的接触容差（px）

  /* —— Q 弹手感 —— */
  const RESTITUTION      = 0.38;  // 球与球之间的弹性
  const WALL_RESTITUTION = 0.45;  // 撞墙 / 撞地面的弹性
  const REST_THRESHOLD   = 55;    // 撞击速度低于此值不反弹（保证堆叠稳、不抖）
  const FRICTION         = 0.955; // 接触时的切向摩擦（每个子步）
  const SQUASH_DECAY     = 9;     // 挤压回弹速度
  const SQUASH_MAX       = 0.30;  // 最大挤压变形

  /* 等级链：索引越大越大
     file : assets/fruits/ 下的贴图。运行时加载的是 .webp —— 同样 1024×1024、
            同样带透明通道，体积只有 PNG 的 1/8（8 张 4.0MB → 474KB）。
            PNG 还在目录里，但只作为 tools/build_parts.py 生成碰撞形状的输入，
            部署时被 tools/build_dist.py 排除掉。
     c1/c2: 贴图缺失/还没加载完时的程序化兜底配色
     pc1/pc2: 粒子/汁水的颜色 */
  const ASSET_FILL = 0.92;   // 贴图里主体占画布长边的比例，与生成脚本保持一致

  /* 半径用【递减的等比】而不是固定倍数：17 → 110，相邻比值从 ×1.47 收到 ×1.15。
     早先用固定的 ×1.30，小级别之间只差 5~7px（17/22/29/38），在手机上
     34px 和 44px 的圆根本分不出来；而大级别却差 20+px，很浪费。
     递减比例把「视觉可分辨的差距」优先分配给数量最多的小级别。 */
  const FRUITS = [
    { name: '哭泣', r: 17,  c1: '#d8d8dc', c2: '#8a8a94', line: 'rgba(40,40,48,.45)',
      file: 'assets/fruits/01-cry.webp',      pc1: '#c9cdd6', pc2: '#7f8590' },
    { name: '惊慌', r: 25,  c1: '#dcdce2', c2: '#8e8e98', line: 'rgba(40,40,48,.45)',
      file: 'assets/fruits/02-panic.webp',    pc1: '#cfd3dc', pc2: '#848a95' },
    { name: '无语', r: 36,  c1: '#e0e0e6', c2: '#92929c', line: 'rgba(40,40,48,.45)',
      file: 'assets/fruits/03-deadpan.webp',  pc1: '#d3d7e0', pc2: '#888e99' },
    { name: '满足', r: 49,  c1: '#e4e4ea', c2: '#96969f', line: 'rgba(40,40,48,.45)',
      file: 'assets/fruits/04-content.webp',  pc1: '#d7dbe4', pc2: '#8c929d' },
    { name: '得意', r: 63,  c1: '#c8464a', c2: '#8c1f24', line: 'rgba(60,10,14,.45)',
      file: 'assets/fruits/05-smug.webp',     pc1: '#e2707a', pc2: '#a8333d' },
    { name: '龇牙', r: 79,  c1: '#c24448', c2: '#88191e', line: 'rgba(60,10,14,.45)',
      file: 'assets/fruits/06-grin.webp',     pc1: '#e26c76', pc2: '#a52f39' },
    { name: '大笑', r: 96,  c1: '#bc4044', c2: '#7e1519', line: 'rgba(60,10,14,.45)',
      file: 'assets/fruits/07-laugh.webp',    pc1: '#de6872', pc2: '#a02b35' },
    { name: '暴怒', r: 110, c1: '#b83c40', c2: '#741115', line: 'rgba(60,10,14,.5)',
      file: 'assets/fruits/08-rage.webp',     pc1: '#ffcf6a', pc2: '#d99a24' }
  ];

  /* 合成出 tier 的得分（三角数） */
  const MERGE_SCORE = [0, 1, 3, 6, 10, 15, 21, 28];

  /* 新等级的掉落权重（越小越常见）。
     只掉前 4 级：早先还允许直接掉 r=49 那一档，盘面很快就被中等果子填满、
     随便碰碰就合，玩起来太轻松。砍掉最大的可掉落等级之后，
     想拿到大果子必须老老实实从小往上一层层合。
     想再难一点就把 3 也去掉，想变回轻松就加回 4。 */
  const SPAWN_TIERS = [0, 1, 2, 3];
  const SPAWN_WEIGHTS = [0.30, 0.28, 0.24, 0.18];

  const BEST_KEY = 'dnw.best.v1';
  const MUTE_KEY = 'dnw.mute.v1';

  /* ---------------------------------------------------------
   *  DOM
   * ------------------------------------------------------- */

  const canvas    = document.getElementById('game');
  const ctx       = canvas.getContext('2d');
  const stage     = document.getElementById('stage');
  const overlay   = document.getElementById('overlay');
  const scoreEl   = document.getElementById('score');
  const bestEl    = document.getElementById('best');
  const finalScoreEl = document.getElementById('finalScore');
  const finalBestEl  = document.getElementById('finalBest');
  const nextCanvas = document.getElementById('next');
  const nextCtx    = nextCanvas.getContext('2d');
  const chainCanvas = document.getElementById('chain');
  const chainCtx    = chainCanvas.getContext('2d');
  const soundBtn   = document.getElementById('soundBtn');
  const resetBtn   = document.getElementById('resetBtn');
  const restartBtn = document.getElementById('restartBtn');

  /* ---------------------------------------------------------
   *  工具
   * ------------------------------------------------------- */

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rand  = (a, b) => a + Math.random() * (b - a);

  /* 「下一个」是否允许和当前这颗相同。
     允许的话有约 22% 概率两边显示同一张图，看起来像“下一个显示的是当前这个”，
     所以默认避开；想恢复成完全随机就把它改成 false */
  const AVOID_REPEAT = true;

  function rollSpawnTier() {
    let r = Math.random(), acc = 0;
    for (let i = 0; i < SPAWN_TIERS.length; i++) {
      acc += SPAWN_WEIGHTS[i];
      if (r <= acc) return SPAWN_TIERS[i];
    }
    return SPAWN_TIERS[0];
  }

  function pickSpawnTier(avoid) {
    if (!AVOID_REPEAT || avoid === undefined) return rollSpawnTier();
    for (let i = 0; i < 6; i++) {
      const t = rollSpawnTier();
      if (t !== avoid) return t;
    }
    return rollSpawnTier();     // 兜底：万一连撞 6 次就认了
  }

  /* ---------------------------------------------------------
   *  音效
   *  · 投放 / 结束 / 爆分：WebAudio 振荡器实时合成，无外部资源
   *  · 合成：优先播 assets/merge.mp3，加载失败才退回合成音
   *
   *  为什么合成音用 <audio> 而不是 fetch + decodeAudioData：
   *  双击 index.html 时页面跑在 file:// 下，浏览器以 CORS 拦掉 fetch
   *  （origin 为 null），拿不到字节就没法喂给 WebAudio 解码。
   *  媒体元素不受这个限制 —— 和 <img> 能加载本地 PNG 是一个道理。
   *  已实测：file:// 下 <audio> 加载 + 播放 OK，fetch 报 CORS。
   * ------------------------------------------------------- */

  const MERGE_SOUND_URL = 'assets/merge.mp3';

  const Sound = {
    ctx: null,
    muted: localStorage.getItem(MUTE_KEY) === '1',
    mergeEl: null,     // 合成音效的 <audio>：整段播放，新合成打断旧的
    _unlocked: false,  // iOS 的媒体播放是否已解锁（见 unlock()）

    ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
      return this.ctx;
    },

    /* 发声入口。上下文没跑起来时不能在原地硬发 —— 见下面 _play 的说明。 */
    tone(freq, freq2, dur, vol, type) {
      if (this.muted) return;
      const c = this.ensure();
      if (!c) return;

      /* 移动端常见情形：页面加载时建的 AudioContext 是 suspended 的，
         第一次手势才 resume()，而它返回的是 Promise。
         如果这时直接排振荡器，等 resolve 时这一声早被丢了 ——
         表现就是「第一次点击（投放）没有声音」。所以等上下文真跑起来再发。 */
      if (c.state !== 'running') {
        let fired = false;
        const fire = () => {
          if (fired || this.muted) return;
          fired = true;
          this._play(c, freq, freq2, dur, vol, type);
        };
        const pr = c.resume();
        if (pr && pr.then) pr.then(fire, fire);
        /* resume() 万一一直不 resolve（个别浏览器），兜一手定时器 */
        setTimeout(fire, 150);
        return;
      }
      this._play(c, freq, freq2, dur, vol, type);
    },

    /* 真正排一个音。调用前必须保证 c.state === 'running'。 */
    _play(c, freq, freq2, dur, vol, type) {
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (freq2 && freq2 !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
      }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    /* 载入合成音效。失败不影响游戏 —— merge() 会自动退回合成音 */
    loadMergeSound(url) {
      const el = new Audio();
      el.preload = 'auto';
      el.addEventListener('error', () => {
        if (window.console) console.warn('[合成大W] 合成音效载入失败，已回退为合成音：' + url);
        this.mergeEl = null;
      });
      el.src = url;
      this.mergeEl = el;
    },

    /* iOS（以及部分安卓浏览器）只允许「在用户手势的处理函数里」启动媒体播放。
       而合成是在物理循环里发生的，不在手势里 —— 直接 play() 会被拒绝，
       表现就是：手机上玩着有音效的其它声音，唯独合成没声。

       解法是趁第一次触摸/按键时先把 <audio> 空放一下把它解锁。
       解锁瞬间把音量压到 0，否则用户会听到一声没来由的响。 */
    unlock() {
      /* WebAudio 的上下文也要在手势里 resume，否则第一次投放/合成的振荡器音是哑的 */
      const cx = this.ensure();
      if (cx && cx.state === 'suspended') cx.resume();

      if (this._unlocked || this.muted || !this.mergeEl) return;
      const el = this.mergeEl;
      if (el.readyState === 0) return;      // 还没加载好，下次手势再试

      const vol = el.volume;
      const done = () => {
        el.pause();
        try { el.currentTime = 0; } catch (e) { /* 忽略 */ }
        el.volume = vol;
        this._unlocked = true;
      };
      el.volume = 0;
      try {
        const p = el.play();
        if (p && p.then) p.then(done, () => { el.volume = vol; });
        else done();
      } catch (e) {
        el.volume = vol;
      }
    },

    /* 掐掉正在播的合成音效（静音、重开时用） */
    stopMerge() {
      if (!this.mergeEl) return;
      try {
        this.mergeEl.pause();
        this.mergeEl.currentTime = 0;
      } catch (e) { /* 忽略 */ }
    },

    /* 合成音：整段播放，新的一次合成直接掐掉上一份从头重放。
       连击时会一直在重头放 —— 这是选定的行为，不是 bug。 */
    merge(tier) {
      if (this.muted) return;

      if (this.mergeEl) {
        const el = this.mergeEl;
        try {
          if (el.readyState > 0) el.currentTime = 0;
          const p = el.play();
          /* 首次交互前浏览器会拒绝自动播放：退回合成音，保证每次都听得到 */
          if (p && p.catch) p.catch(() => this.synthMerge(tier));
          return;
        } catch (e) { /* 落到下面 */ }
      }
      this.synthMerge(tier);
    },

    /* 原来的合成音（振荡器），现在是兜底 */
    synthMerge(tier) {
      if (this.muted) return;
      const base = 240 * Math.pow(1.1225, tier * 2);
      this.tone(base, base * 1.7, 0.2, 0.16, 'sine');
      this.tone(base * 2, base * 3, 0.12, 0.06, 'triangle');
    },

    /* 投放（松手那一下）。
       原来只有 180→120Hz、音量 0.05 的一记闷响，手机上基本听不见，
       所以被当成「没有投放音效」。改成高频短音 + 低频垫底的两层，
       音量抬到听得见但不吵：一层出「嗒」的质感，一层给厚度。 */
    drop() {
      this.tone(560, 300, 0.055, 0.18, 'triangle');
      this.tone(180, 120, 0.09,  0.13, 'sine');
    },
    over()   { this.tone(420, 90, 0.7, 0.16, 'sawtooth'); },
    bonus()  { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, f, 0.22, 0.12, 'triangle'), i * 90)); }
  };

  /* 手机上的轻微震动反馈（跟着静音开关走；不支持的浏览器自动忽略） */
  function haptic(ms) {
    if (Sound.muted) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* 忽略 */ }
    }
  }

  /* ---------------------------------------------------------
   *  画布尺寸
   * ------------------------------------------------------- */

  const view = { scale: 1, dpr: 1 };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    view.dpr = dpr;
    view.scale = (rect.width * dpr) / W;
  }

  /* ---------------------------------------------------------
   *  游戏状态
   * ------------------------------------------------------- */

  const state = {
    balls: [],
    particles: [],
    floats: [],
    score: 0,
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    pending: 0,
    next: 0,
    ready: true,
    cooldown: 0,
    aimX: W / 2,
    over: false,
    flash: 0
  };

  /* ---------------------------------------------------------
   *  碰撞形状（按图片轮廓生成，不是圆形）
   *  assets/fruits/parts.js 由 tools/build_parts.py 从贴图的 alpha 轮廓算出：
   *  parts = [[ox, oy, s], ...] 单位是「以 r 为 1」，rb = 碰撞包围圆半径。
   *  没有数据时退化成单个半径 r 的圆，和老版本行为一致。
   * ------------------------------------------------------- */

  const SHAPES = (typeof window !== 'undefined' && window.SUIKA_PARTS) || [];
  const UNIT_SHAPE = { rb: 1, parts: [[0, 0, 1]] };

  function shapeOf(tier) {
    const s = SHAPES[tier];
    if (s && s.parts && s.parts.length) return s;
    return UNIT_SHAPE;
  }

  /* 把局部小圆换算到世界坐标（跟着刚体一起旋转平移） */
  function syncParts(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    const parts = b.parts, r = b.r;
    const wx = b.wx, wy = b.wy, ws = b.ws;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const ox = p[0] * r, oy = p[1] * r;
      wx[i] = b.x + ox * c - oy * s;
      wy[i] = b.y + ox * s + oy * c;
      ws[i] = p[2] * r;
    }
  }

  function makeBall(x, y, tier, vx, vy) {
    const r = FRUITS[tier].r;
    const m = r * r;
    const sh = shapeOf(tier);
    const n = sh.parts.length;
    const ball = {
      x, y, vx: vx || 0, vy: vy || 0,
      px: x, py: y,
      r, tier, angle: 0,
      mass: m, invMass: 1 / m,
      bornAt: performance.now(),
      overTime: 0,
      landed: false,
      dead: false,
      contacts: 0,
      pvx: 0, pvy: 0,          // 本子步求解前的速度（用于弹性冲量）
      sq: 0, sqA: 0,           // 挤压变形量 / 变形轴角度
      parts: sh.parts,
      rb: sh.rb * r,           // 包围圆半径（粗筛用）
      wx: new Float32Array(n), // 世界坐标下的子圆
      wy: new Float32Array(n),
      ws: new Float32Array(n)
    };
    syncParts(ball);
    return ball;
  }

  /* ---------------------------------------------------------
   *  物理
   * ------------------------------------------------------- */

  function stepPhysics(dt) {
    const balls = state.balls;
    const merges = [];
    const contacts = [];      // 本子步的接触列表，用于弹性冲量

    /* --- 积分 --- */
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      b.px = b.x;
      b.py = b.y;
      b.vy += GRAVITY * dt;
      b.pvx = b.vx;           // 求解前速度：弹性冲量用它来算，避免被约束“吃掉”
      b.pvy = b.vy;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.contacts = 0;
      syncParts(b);
    }

    /* --- 约束求解 --- */
    for (let it = 0; it < ITER; it++) {

      /* 墙 & 地面：每个子圆各自贴墙，推力累加到刚体中心上（一次到位） */
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (b.dead) continue;
        let pushL = 0, pushR = 0, pushFloor = 0, pushCeil = 0;
        const n = b.parts.length;
        for (let k = 0; k < n; k++) {
          const x = b.wx[k], y = b.wy[k], rr = b.ws[k];
          const l = WALL - (x - rr);
          if (l > pushL) pushL = l;
          const rgt = (x + rr) - (W - WALL);
          if (rgt > pushR) pushR = rgt;
          const dn = (y + rr) - (H - WALL);
          if (dn > pushFloor) pushFloor = dn;
          const up = -(y - rr);
          if (up > pushCeil) pushCeil = up;
        }
        if (pushL || pushR || pushFloor || pushCeil) {
          b.x += pushL - pushR;
          b.y += pushCeil - pushFloor;
          b.contacts++;
          if (it === 0) {
            if (pushL)     contacts.push({ ball: b, nx: 1,  ny: 0 });
            if (pushR)     contacts.push({ ball: b, nx: -1, ny: 0 });
            if (pushFloor) contacts.push({ ball: b, nx: 0,  ny: -1 });
            if (pushCeil)  contacts.push({ ball: b, nx: 0,  ny: 1 });
          }
          syncParts(b);
        }
      }

      /* 球球：子圆两两求交，取“最接近/最深”的那一对做修正 */
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.dead) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.dead || a.dead) continue;

          /* 包围圆粗筛 */
          const cdx = b.x - a.x, cdy = b.y - a.y;
          const rbSum = a.rb + b.rb;
          if (cdx * cdx + cdy * cdy >= rbSum * rbSum) continue;

          const pa = a.parts.length, pb = b.parts.length;
          const brb = b.rb, arb = a.rb;
          let minGap = 1e9, bnx = 0, bny = 0;

          for (let m = 0; m < pa; m++) {
            const ax = a.wx[m], ay = a.wy[m], ar = a.ws[m];
            /* 小圆离对方中心太远就整组跳过 */
            const ddx = b.x - ax, ddy = b.y - ay;
            const far = brb + ar;
            if (ddx * ddx + ddy * ddy >= far * far) continue;

            for (let k = 0; k < pb; k++) {
              const bx = b.wx[k], by = b.wy[k], br = b.ws[k];
              const dx = bx - ax, dy = by - ay;
              const sum = ar + br;
              const d2 = dx * dx + dy * dy;
              if (d2 >= sum * sum) continue;
              const d = Math.sqrt(d2);
              const gap = d - sum;
              if (gap < minGap) {
                minGap = gap;
                if (d < 1e-4) { bnx = 1; bny = 0; }
                else { bnx = dx / d; bny = dy / d; }
              }
            }
          }

          if (minGap > MERGE_PAD || minGap === 1e9) continue;

          if (a.tier === b.tier && it === 0) {
            a.dead = true;
            b.dead = true;
            merges.push([a, b]);
            continue;
          }

          if (minGap >= 0) continue;            // 只是挨着，不用推开
          if (it === 0) contacts.push({ a: a, b: b, nx: bnx, ny: bny });
          const corr = Math.min(-minGap - 0.05, 4) * 0.9;
          if (corr <= 0) continue;
          const invSum = a.invMass + b.invMass;
          const wa = a.invMass / invSum;
          const wb = b.invMass / invSum;

          a.x -= bnx * corr * wa;  a.y -= bny * corr * wa;
          b.x += bnx * corr * wb;  b.y += bny * corr * wb;

          a.contacts++;
          b.contacts++;
          syncParts(a);
          syncParts(b);
        }
      }
    }

    /* --- 收尾墙约束：球球分离可能把水果顶出墙外，最后再夹一次 --- */
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;
      let pushL = 0, pushR = 0, pushFloor = 0, pushCeil = 0;
      for (let k = 0; k < b.parts.length; k++) {
        const x = b.wx[k], y = b.wy[k], rr = b.ws[k];
        const l = WALL - (x - rr);         if (l > pushL) pushL = l;
        const rgt = (x + rr) - (W - WALL); if (rgt > pushR) pushR = rgt;
        const dn = (y + rr) - (H - WALL);  if (dn > pushFloor) pushFloor = dn;
        const up = -(y - rr);              if (up > pushCeil) pushCeil = up;
      }
      if (pushL || pushR || pushFloor || pushCeil) {
        b.x += pushL - pushR;
        b.y += pushCeil - pushFloor;
        b.contacts++;
        syncParts(b);
      }
    }

    /* --- 由位置差反推速度（PBD）+ 摩擦 + 滚动 --- */
    const invDt = 1 / dt;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.dead) continue;

      const dx = b.x - b.px;
      const dy = b.y - b.py;

      let vx = dx * invDt;
      let vy = dy * invDt;

      if (b.contacts > 0) vx *= FRICTION;   // 接触时的切向摩擦
      if (b.sq > 0) b.sq = Math.max(0, b.sq - b.sq * SQUASH_DECAY * dt);

      b.vx = vx;
      b.vy = vy;
      b.angle += dx / b.r * 0.85;           // 视觉滚动

      if (!b.landed) {
        if (b.contacts > 0 || performance.now() - b.bornAt > 900) b.landed = true;
      }
    }

    /* --- 弹性冲量 ---
       位置约束已经把法向速度吃掉了一部分，这里直接把法向相对速度“改写”成
       e × 碰撞前速度，这样回弹量只由 e 决定，不受子步/迭代次数影响。
       撞击速度低于阈值时完全不弹，保证堆叠静止时不抖。 */
    for (let k = 0; k < contacts.length; k++) {
      const ct = contacts[k];

      if (ct.ball) {
        /* 撞墙 / 撞地面 */
        const b = ct.ball;
        if (b.dead) continue;
        const vnPre = b.pvx * ct.nx + b.pvy * ct.ny;      // <0 表示还在往墙里钻
        if (vnPre < -REST_THRESHOLD) {
          const vnPost = b.vx * ct.nx + b.vy * ct.ny;
          const target = -WALL_RESTITUTION * vnPre;       // 期望的分离速度
          const j = target - vnPost;
          if (j > 0) {
            b.vx += j * ct.nx;
            b.vy += j * ct.ny;
            squash(b, ct.nx, ct.ny, -vnPre);
          }
        }
      } else {
        /* 球与球 */
        const a = ct.a, b = ct.b;
        if (a.dead || b.dead) continue;
        const nx = ct.nx, ny = ct.ny;                     // a → b
        const vnPre = (a.pvx - b.pvx) * nx + (a.pvy - b.pvy) * ny;   // >0 表示相互靠近
        if (vnPre > REST_THRESHOLD) {
          const vnPost = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          const target = -RESTITUTION * vnPre;
          const j = (vnPost - target) / (a.invMass + b.invMass);
          if (j > 0) {
            a.vx -= j * a.invMass * nx;  a.vy -= j * a.invMass * ny;
            b.vx += j * b.invMass * nx;  b.vy += j * b.invMass * ny;
            squash(a, -nx, -ny, vnPre);
            squash(b, nx, ny, vnPre);
          }
        }
      }
    }

    /* --- 处理合成 --- */
    if (merges.length) processMerges(merges);
  }

  /* ---------------------------------------------------------
   *  等级装饰
   *  8 张贴图轮廓完全一样，只靠大小和表情认等级太吃力，
   *  这里按 tier 递进叠加装饰，让玩家一眼能分清。
   *  调用点在 drawFruit 里、c.rotate(angle) 之后，
   *  所以装饰会跟着水果一起滚动旋转。
   * ------------------------------------------------------- */

  /* 外发光颜色：tier 3 起逐级变亮，最高级是金色霸气光晕。
     现在用作贴图投影的 shadowColor（见 applyTierGlow），所以是半透明实色，
     靠 shadowBlur 自己糊开 —— 不再是画一个圆，光晕会贴着角色轮廓走。 */
  const TIER_GLOW = [null, null, null,
    'rgba(255,238,180,.50)', 'rgba(255,222,140,.55)',
    'rgba(255,178,96,.60)',  'rgba(150,210,255,.62)',
    'rgba(255,206,88,.70)'];

  function starPath(c, x, y, r, spikes) {
    const n = spikes || 5;
    c.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const rad = (i % 2) ? r * 0.44 : r;
      const a = -Math.PI / 2 + i * Math.PI / n;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
  }

  function crystalPath(c, x, y, r) {
    /* 源石结晶：一枚瘦长的六边形菱形 */
    c.beginPath();
    c.moveTo(x, y - r);
    c.lineTo(x + r * 0.42, y - r * 0.2);
    c.lineTo(x + r * 0.26, y + r);
    c.lineTo(x - r * 0.26, y + r);
    c.lineTo(x - r * 0.42, y - r * 0.2);
    c.closePath();
  }

  /* 外发光：不画圆，改成给贴图本体加一圈投影。
     shadowBlur 是按贴图的 alpha 形状算的，光晕自然贴着角色真实轮廓走
     （发尖、角、尾巴都在），不会像画一个圆那样把不规则角色包成球。
     必须在 c.drawImage 之前设好，画完由外层的 c.restore() 收掉。 */
  function applyTierGlow(c, r, tier) {
    if (tier < 3 || !TIER_GLOW[tier]) return;
    c.shadowColor = TIER_GLOW[tier];
    c.shadowBlur = r * 0.55;
  }

  /* ── 轮廓采样 ──────────────────────────────────────────────
     装饰一律贴着角色轮廓走，不套圆。
     shapeOf(tier).parts 是 tools/build_parts.py 从贴图 alpha 描出来的
     一组内接小圆，本身就是角色的外形。按角度分桶，每桶取「外缘到中心最远」
     的那个 —— 得到的半径序列就是 W 的轮廓（有发尖的地方就凸出去）。 */
  function outlineDirs(tier, n) {
    const parts = shapeOf(tier).parts;
    const bins = new Array(n).fill(0);
    for (let i = 0; i < parts.length; i++) {
      const ox = parts[i][0], oy = parts[i][1], s = parts[i][2];
      const d = Math.sqrt(ox * ox + oy * oy) + s;      // 单位是 r
      const k = Math.floor(((Math.atan2(oy, ox) + Math.PI) / (Math.PI * 2)) * n) % n;
      if (d > bins[k]) bins[k] = d;
    }
    /* 空桶用邻居补上，免得轮廓上出现缺口 */
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < n; k++) {
        if (bins[k] === 0) {
          const nb = bins[(k + 1) % n] || bins[(k - 1 + n) % n];
          if (nb) bins[k] = nb;
        }
      }
    }
    for (let k = 0; k < n; k++) if (bins[k] === 0) bins[k] = 1;
    return bins;
  }

  /* 等级装饰：在贴图【之后】画。全部沿轮廓走 ——
     早先这些都是沿一个圆画的，结果不管角色多不规则，套上去都像个球。 */
  function drawTierDecor(c, r, tier, t) {
    if (tier <= 0) return;

    const N = 16;
    const d = outlineDirs(tier, N);
    const dirA = (k) => -Math.PI + (k + 0.5) * (Math.PI * 2 / N);

    /* tier 1 / 2：头顶星星（星星本来就飘在头上，不跟轮廓） */
    if (tier <= 2) {
      c.fillStyle = '#ffe27a';
      starPath(c, 0, -r * 1.02, r * 0.20, 5);
      c.fill();
      if (tier === 2) {
        starPath(c, -r * 0.78, -r * 0.72, r * 0.13, 5);
        c.fill();
      }
    }

    /* tier 3：三颗小星，钉在轮廓外侧的三个方向（不是一圈环） */
    if (tier === 3) {
      c.fillStyle = '#ffd76a';
      [[-0.62, -0.90], [0.20, -1.02], [0.92, -0.30]].forEach(([mx, my]) => {
        starPath(c, mx * r, my * r, r * 0.15, 5);
        c.fill();
      });
    }

    /* tier 4：两枚红色源石结晶，贴在轮廓最左 / 最右的那个点上 */
    if (tier >= 4) {
      const kL = 0, kR = N / 2;                       // 分桶从 -PI 开始，正好是左右
      const xL = -d[kL] * r * 0.98, xR = d[kR] * r * 0.98;
      const yL = Math.sin(dirA(kL)) * d[kL] * r;
      const yR = Math.sin(dirA(kR)) * d[kR] * r;
      c.save();
      c.fillStyle = 'rgba(226,74,74,.92)';
      c.strokeStyle = 'rgba(255,190,190,.85)';
      c.lineWidth = Math.max(0.8, r * 0.02);
      crystalPath(c, xL, yL * 0.4, r * 0.24); c.fill(); c.stroke();
      crystalPath(c, xR, yR * 0.4 - r * 0.06, r * 0.19); c.fill(); c.stroke();
      c.restore();
    }

    /* tier 5 起：火焰，从轮廓每个方向往外舔（有发尖/角的地方火苗就跟着凸） */
    if (tier >= 5) {
      c.save();
      c.fillStyle = 'rgba(255,140,50,.78)';
      for (let k = 0; k < N; k++) {
        const a = dirA(k);
        const base = d[k] * r;
        const up = Math.max(0, Math.cos(a + Math.PI / 2));   // 朝上更旺
        const h = r * (0.09 + 0.22 * up);
        const bx = Math.cos(a) * base, by = Math.sin(a) * base;
        const px = Math.cos(a + Math.PI / 2) * r * 0.07;
        const py = Math.sin(a + Math.PI / 2) * r * 0.07;
        const mx = Math.cos(a) * (base + h * 0.5), my = Math.sin(a) * (base + h * 0.5);
        c.beginPath();
        c.moveTo(bx - px, by - py);
        c.quadraticCurveTo(mx, my, Math.cos(a) * (base + h), Math.sin(a) * (base + h));
        c.quadraticCurveTo(mx, my, bx + px, by + py);
        c.closePath();
        c.fill();
      }
      c.restore();
    }

    /* tier 6 起：青色电弧，沿轮廓抖 */
    if (tier >= 6) {
      c.save();
      c.strokeStyle = 'rgba(120,220,255,.85)';
      c.lineWidth = Math.max(1.0, r * 0.035);
      c.lineCap = 'round';
      for (let k = 4; k < N; k += 6) {                 // 不均匀地挑几段，别绕成一圈
        c.beginPath();
        for (let i = 0; i <= 4; i++) {
          const kk = (k + i) % N;
          const a = dirA(kk);
          const jitter = Math.sin(t * 0.02 + i * 2.1 + k) * r * 0.10;
          const rad = d[kk] * r * 0.96 + jitter;
          const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
      }
      c.restore();
    }

    /* tier 7：金色霸气射线，从轮廓往外射（长短不一，跟着轮廓起伏） */
    if (tier >= 7) {
      c.save();
      c.globalAlpha = 0.45 + 0.3 * Math.abs(Math.sin(t * 0.003));
      c.strokeStyle = 'rgba(255,214,110,.95)';
      c.lineWidth = Math.max(1.4, r * 0.045);
      c.lineCap = 'round';
      const rot = t * 0.0006;
      for (let k = 0; k < N; k += 2) {                 // 隔一个方向一根
        const a = dirA(k) + rot;
        const r0 = d[k] * r * 1.02;
        const r1 = d[k] * r * (1.16 + 0.10 * Math.sin(t * 0.004 + k));
        c.beginPath();
        c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        c.stroke();
      }
      c.restore();
    }
  }

  /* 撞击挤压：沿撞击法线压扁、垂直方向拉伸，做出果冻感 */
  function squash(b, nx, ny, speed) {
    const k = Math.min(SQUASH_MAX, speed / 1500);
    if (k <= b.sq) return;
    b.sq = k;
    b.sqA = Math.atan2(ny, nx);
  }

  function processMerges(merges) {
    for (let k = 0; k < merges.length; k++) {
      const a = merges[k][0];
      const b = merges[k][1];
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const tier = a.tier;

      if (tier >= MAX_TIER) {
        /* 两个最高级（暴怒）→ 一起消失，拿奖励分 */
        addScore(MAX_BONUS, mx, my, '+' + MAX_BONUS);
        burst(mx, my, MAX_TIER, 34, 380);
        Sound.bonus();
        haptic(40);
        state.flash = 1;
      } else {
        const nt = tier + 1;
        const nb = makeBall(mx, my, nt, (a.vx + b.vx) * 0.5, (a.vy + b.vy) * 0.5 - 60);
        /* 贴着墙合成时，新水果更大，先夹回场地内，避免瞬间穿墙 */
        nb.x = clamp(nb.x, WALL + nb.r, W - WALL - nb.r);
        nb.y = Math.min(nb.y, H - WALL - nb.r);
        nb.px = nb.x;
        nb.py = nb.y;
        nb.landed = true;
        nb.popAt = performance.now();
        state.balls.push(nb);

        addScore(MERGE_SCORE[nt], mx, my, '+' + MERGE_SCORE[nt]);
        burst(mx, my, nt, 8 + nt * 2, 140 + nt * 22);
        Sound.merge(nt);
        haptic(6 + nt);
        if (nt === MAX_TIER) state.flash = 1;
      }
    }

    /* 移除被合成的球 */
    const alive = [];
    for (let i = 0; i < state.balls.length; i++) {
      if (!state.balls[i].dead) alive.push(state.balls[i]);
    }
    state.balls = alive;
  }

  /* ---------------------------------------------------------
   *  特效 & 计分
   * ------------------------------------------------------- */

  function burst(x, y, tier, n, speed) {
    const f = FRUITS[Math.min(tier, MAX_TIER)];
    const c1 = f.pc1 || f.c1;
    const c2 = f.pc2 || f.c2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.25, speed);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 70,
        r: rand(2, 5.5),
        life: 1,
        decay: rand(1.3, 2.4),
        color: Math.random() < 0.5 ? c1 : c2
      });
    }
    if (state.particles.length > 420) state.particles.splice(0, state.particles.length - 420);
  }

  function addScore(n, x, y, text) {
    state.score += n;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(BEST_KEY, String(state.best));
      bestEl.textContent = state.best;
    }
    scoreEl.textContent = state.score;
    bump(scoreEl);
    if (x !== undefined) {
      state.floats.push({ x, y, text: text || ('+' + n), life: 1 });
    }
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  /* ---------------------------------------------------------
   *  投放 & 控制
   * ------------------------------------------------------- */

  function aimLimit(tier) {
    const r = FRUITS[tier].r * shapeOf(tier).rb;   // 用碰撞外形而不是圆形
    return [WALL + r + 0.5, W - WALL - r - 0.5];
  }

  function moveAim(x) {
    const [lo, hi] = aimLimit(state.pending);
    state.aimX = clamp(x, lo, hi);
  }

  function tryDrop() {
    if (state.over || !state.ready) return;
    const tier = state.pending;
    const [lo, hi] = aimLimit(tier);
    const x = clamp(state.aimX, lo, hi);

    const ball = makeBall(x, DROP_Y, tier, 0, 130);
    state.balls.push(ball);

    state.ready = false;
    state.cooldown = DROP_MS / 1000;
    state.pending = state.next;
    state.next = pickSpawnTier(state.pending);   // 和当前这颗不一样
    Sound.drop();
    drawNext();
    if (state.balls.length > 90) state.balls = state.balls.filter(b => !b.dead);
  }

  /* ---------------------------------------------------------
   *  判负
   * ------------------------------------------------------- */

  function checkGameOver(dt) {
    let danger = false;
    for (let i = 0; i < state.balls.length; i++) {
      const b = state.balls[i];
      if (b.dead || !b.landed) continue;
      const top = b.y - b.r;

      if (top < DANGER_Y) {
        danger = true;                     // 只要线上方有东西，虚线就闪红
        /* 只有「卡在线上方且基本停住」才计时：
           被弹起来、正在飞过线的不算，免得误判 */
        if (b.vx * b.vx + b.vy * b.vy < REST_SPEED2) {
          b.overTime += dt;
          if (b.overTime > OVER_LIMIT) { gameOver(); return; }
        } else {
          b.overTime = Math.max(0, b.overTime - dt * 2);
        }
      } else {
        /* 回到线下方 → 按 2 倍速倒扣，所以长时间待在线上方才会攒起来 */
        b.overTime = Math.max(0, b.overTime - dt * 2);
        if (b.overTime > 0) danger = true;
      }
    }
    state.danger = danger;
  }

  function gameOver() {
    state.over = true;
    finalScoreEl.textContent = state.score;
    finalBestEl.textContent = state.best;
    overlay.classList.add('show');
    Sound.over();
  }

  function reset() {
    state.balls.length = 0;
    state.particles.length = 0;
    state.floats.length = 0;
    state.score = 0;
    state.over = false;
    state.ready = true;
    state.cooldown = 0;
    state.flash = 0;
    state.danger = false;
    state.aimX = W / 2;
    state.pending = pickSpawnTier();
    state.next = pickSpawnTier(state.pending);
    overlay.classList.remove('show');
    scoreEl.textContent = '0';
    bestEl.textContent = state.best;
    drawNext();
    Sound.ensure();
    Sound.stopMerge();       // 重开时把上一局残留的合成音掐掉
  }

  /* ---------------------------------------------------------
   *  绘制
   * ------------------------------------------------------- */

  function drawFruit(c, x, y, r, tier, angle, scale, squashShape) {
    const f = FRUITS[tier];
    const s = scale === undefined ? 1 : scale;

    c.save();
    c.translate(x, y);
    /* 撞击挤压：沿法线压扁、垂直拉伸（世界坐标，先于水果自身旋转） */
    if (squashShape && squashShape.k > 0.004) {
      c.rotate(squashShape.a);
      c.scale(1 - squashShape.k, 1 + squashShape.k * 0.85);
      c.rotate(-squashShape.a);
    }
    if (s !== 1) c.scale(s, s);
    c.rotate(angle || 0);

    /* —— 贴图模式：主体直接画贴图，画布边长按 ASSET_FILL 换算，保证视觉大小 = 物理直径 —— */
    if (f.img) {
      const box = (r * 2) / ASSET_FILL;
      const now = performance.now();
      /* 发光只加在贴图本体那一笔上（shadowBlur 按贴图 alpha 形状算，
         所以光晕贴着角色轮廓走）；画完立刻清掉，
         否则后面的装饰也全带上投影，糊成一团。 */
      applyTierGlow(c, r, tier);
      c.drawImage(f.img, -box / 2, -box / 2, box, box);
      c.shadowBlur = 0;
      c.shadowColor = 'transparent';
      drawTierDecor(c, r, tier, now);
      c.restore();
      return;
    }

    /* —— 兜底：贴图没加载出来时，画程序化的圆形水果 —— */
    applyTierGlow(c, r, tier);
    /* 主体 */
    const g = c.createRadialGradient(-r * 0.34, -r * 0.40, r * 0.12, 0, 0, r * 1.12);
    g.addColorStop(0, f.c1);
    g.addColorStop(1, f.c2);
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    /* 光晕只跟着主体那一下，描边 / 高光 / 表情不能再带投影 */
    c.shadowBlur = 0;
    c.shadowColor = 'transparent';

    /* 描边 */
    c.lineWidth = Math.max(1.4, r * 0.055);
    c.strokeStyle = f.line;
    c.beginPath();
    c.arc(0, 0, r - c.lineWidth * 0.5, 0, Math.PI * 2);
    c.stroke();

    /* 高光 */
    c.beginPath();
    c.ellipse(-r * 0.34, -r * 0.40, r * 0.30, r * 0.19, -0.7, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.fill();

    /* 表情 */
    if (r >= 20) {
      const eyeR = r * 0.135;
      const eyeX = r * 0.33;
      const eyeY = -r * 0.06;

      c.fillStyle = 'rgba(46,32,24,.88)';
      c.beginPath(); c.arc(-eyeX, eyeY, eyeR, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc( eyeX, eyeY, eyeR, 0, Math.PI * 2); c.fill();

      c.fillStyle = 'rgba(255,255,255,.9)';
      c.beginPath(); c.arc(-eyeX - eyeR * 0.3, eyeY - eyeR * 0.35, eyeR * 0.34, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc( eyeX - eyeR * 0.3, eyeY - eyeR * 0.35, eyeR * 0.34, 0, Math.PI * 2); c.fill();

      c.beginPath();
      c.arc(0, r * 0.08, r * 0.20, 0.18 * Math.PI, 0.82 * Math.PI);
      c.lineWidth = Math.max(1.2, r * 0.055);
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(46,32,24,.72)';
      c.stroke();

      c.fillStyle = 'rgba(255,120,120,.30)';
      c.beginPath(); c.ellipse(-r * 0.56, r * 0.16, r * 0.16, r * 0.11, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse( r * 0.56, r * 0.16, r * 0.16, r * 0.11, 0, 0, Math.PI * 2); c.fill();
    } else {
      c.fillStyle = 'rgba(46,32,24,.85)';
      c.beginPath(); c.arc(-r * 0.3, -r * 0.06, r * 0.13, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc( r * 0.3, -r * 0.06, r * 0.13, 0, Math.PI * 2); c.fill();
    }

    drawTierDecor(c, r, tier, performance.now());
    c.restore();
  }

  function drawBoard() {
    /* 背景：银灰冷调，衬 W 的银发与暗红 */
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#3a3d4a');
    bg.addColorStop(0.55, '#2f323d');
    bg.addColorStop(1, '#26282f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    /* 顶部投放区高光 */
    const top = ctx.createLinearGradient(0, 0, 0, 190);
    top.addColorStop(0, 'rgba(255,255,255,.10)');
    top.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, 190);

    /* 内壁 */
    ctx.save();
    ctx.strokeStyle = 'rgba(150,158,178,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WALL, 0);
    ctx.lineTo(WALL, H - WALL);
    ctx.lineTo(W - WALL, H - WALL);
    ctx.lineTo(W - WALL, 0);
    ctx.stroke();
    ctx.restore();

    /* 警戒线 */
    const danger = state.danger;
    ctx.save();
    ctx.setLineDash([9, 9]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = danger
      ? 'rgba(255,72,72,' + (0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 140))) + ')'
      : 'rgba(226,120,120,.42)';
    ctx.beginPath();
    ctx.moveTo(WALL, DANGER_Y);
    ctx.lineTo(W - WALL, DANGER_Y);
    ctx.stroke();
    ctx.restore();
  }

  function drawBalls() {
    const now = performance.now();
    const balls = state.balls;
    const sorted = balls.slice().sort((a, b) => a.r - b.r);

    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      if (b.dead) continue;

      /* 地面投影 */
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(b.x, H - WALL - 1, b.r * 0.86, Math.max(3, b.r * 0.17), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      let scale = 1;
      if (b.popAt) {
        const t = (now - b.popAt) / 220;
        if (t < 1) scale = 1 + 0.28 * (1 - t);
        else b.popAt = 0;
      }
      const shape = b.sq > 0.004 ? { a: b.sqA, k: b.sq } : null;
      drawFruit(ctx, b.x, b.y, b.r, b.tier, b.angle, scale, shape);
    }
  }

  function drawAim() {
    if (state.over) return;
    const tier = state.pending;
    const r = FRUITS[tier].r;
    const [lo, hi] = aimLimit(tier);
    const x = clamp(state.aimX, lo, hi);
    const bob = Math.sin(performance.now() / 320) * 2.5;
    const ready = state.ready;

    /* 只有能投的时候才画落点辅助线 */
    if (ready) {
      ctx.save();
      ctx.setLineDash([5, 8]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(170,182,208,.42)';
      ctx.beginPath();
      ctx.moveTo(x, DROP_Y + r + 4);
      ctx.lineTo(x, H - WALL);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = FRUITS[tier].c1;
      ctx.beginPath();
      ctx.arc(x, DROP_Y + bob, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* 冷却中也要画：淡一点表示“下一颗就是它、但还不能投”。
       不然这段时间棋盘上只剩右上角的“下一个”，很容易被当成当前这颗 */
    ctx.save();
    if (!ready) ctx.globalAlpha = 0.4;
    drawFruit(ctx, x, DROP_Y + bob, r, tier, 0, 1);
    ctx.restore();
  }

  function drawEffects(dt) {
    /* 粒子 */
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.vy += 1400 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.99;
      p.life -= p.decay * dt;
      if (p.life <= 0) { state.particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life) * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* 飘分 */
    ctx.textAlign = 'center';
    ctx.font = '700 20px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    for (let i = state.floats.length - 1; i >= 0; i--) {
      const f = state.floats[i];
      f.y -= 46 * dt;
      f.life -= dt * 1.05;
      if (f.life <= 0) { state.floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, f.life * 1.4);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,20,26,.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    /* 顶棚下一颗预览 */
    drawTopPreview();
  }

  function drawTopPreview() {
    /* 棋盘右上角永远显示「下一个」——当前那颗在准星位置上画着，别搞混 */
    const tier = state.next;
    const r = 15;
    const x = W - WALL - 30;
    const y = 32;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.font = '600 11px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(186,194,212,.85)';
    ctx.fillText('下一个', x - r - 10, y);
    ctx.restore();

    drawFruit(ctx, x, y, r, tier, 0, 1);
  }

  /* 面板中的“下一个” */
  function drawNext() {
    const w = nextCanvas.width;
    const h = nextCanvas.height;
    nextCtx.setTransform(1, 0, 0, 1, 0, 0);
    nextCtx.clearRect(0, 0, w, h);
    const tier = state.next;
    const r = FRUITS[tier].r;
    const k = (Math.min(w, h) * 0.42) / r;
    drawFruit(nextCtx, w / 2, h / 2, r * k, tier, 0, 1);
  }

  /* 面板中的“合成表” */
  function drawChain() {
    const cw = chainCanvas.width;
    const ch = chainCanvas.height;
    chainCtx.setTransform(1, 0, 0, 1, 0, 0);
    chainCtx.clearRect(0, 0, cw, ch);

    const n = FRUITS.length;
    const slot = cw / n;
    const cy = ch * 0.5;

    for (let i = 0; i < n; i++) {
      const x = slot * (i + 0.5);
      /* 压缩比例：0.30 -> 0.46 线性递增。
         不按真实半径比例画——真实比例下最小一级只有最大一级的 1/6，脸会看不清。 */
      const f = n > 1 ? i / (n - 1) : 0;
      const r = slot * (0.30 + 0.16 * f);
      drawFruit(chainCtx, x, cy, r, i, 0, 1);
      if (i < n - 1) {
        chainCtx.save();
        chainCtx.globalAlpha = 0.45;
        chainCtx.fillStyle = '#9aa0ae';
        chainCtx.font = '600 ' + Math.round(ch * 0.2) + 'px system-ui, sans-serif';
        chainCtx.textAlign = 'center';
        chainCtx.textBaseline = 'middle';
        chainCtx.fillText('›', x + slot * 0.5, cy);
        chainCtx.restore();
      }
    }
  }

  /* ---------------------------------------------------------
   *  主循环
   * ------------------------------------------------------- */

  let last = performance.now();
  let acc = 0;
  const FIXED = 1 / 60;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;      // 切后台回来不要瞬移
    acc += dt;

    let guard = 0;
    while (acc >= FIXED && guard < 5) {
      update(FIXED);
      acc -= FIXED;
      guard++;
    }
    if (guard >= 5) acc = 0;

    render(dt);
    requestAnimationFrame(frame);
  }

  function update(dt) {
    if (state.over) return;          // 结束后冻结棋盘（粒子特效仍在 render 里继续）

    if (!state.ready) {
      state.cooldown -= dt;
      if (state.cooldown <= 0) state.ready = true;
    }

    /* 物理：子步细分，保证小水果不被穿透 */
    const sub = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) stepPhysics(sub);

    checkGameOver(dt);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.2);
  }

  function render(dt) {
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawBoard();
    drawBalls();
    drawAim();
    drawEffects(dt);

    if (state.flash > 0) {
      ctx.save();
      ctx.globalAlpha = state.flash * 0.35;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------
   *  输入
   * ------------------------------------------------------- */

  function pointerToX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (W / rect.width);
  }

  /* 触屏是「拖动瞄准、松手投放」——手指不会挡住落点，也方便微调；
     鼠标保持「移动瞄准、按下即投」的桌面手感。 */
  let touchAiming = false;

  stage.addEventListener('pointermove', (e) => {
    if (state.over) return;
    if (e.pointerType === 'touch' && !touchAiming) return;
    moveAim(pointerToX(e.clientX));
  });

  /* 第一次用户交互时解锁移动端音频（见 Sound.unlock）。
     挂在 document 上而不是棋盘上 —— 用户可能先点的是「音效」或「重开」按钮；
     用 capture 阶段，保证在任何 return 之前先跑到。 */
  document.addEventListener('pointerdown', () => Sound.unlock(), true);
  document.addEventListener('keydown', () => Sound.unlock(), true);

  stage.addEventListener('pointerdown', (e) => {
    if (state.over) return;
    Sound.ensure();
    moveAim(pointerToX(e.clientX));
    if (e.pointerType === 'touch') {
      touchAiming = true;
      /* 手指滑出棋盘也能收到 pointerup */
      if (stage.setPointerCapture) {
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
    } else {
      tryDrop();
    }
  });

  stage.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!touchAiming) return;
    touchAiming = false;
    if (state.over) return;
    moveAim(pointerToX(e.clientX));
    tryDrop();
  });

  stage.addEventListener('pointercancel', () => { touchAiming = false; });

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  /* 在输入框里打字时不要抢按键 */
  function isTyping(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable === true;
  }

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;

    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      state.aimX = clamp(state.aimX - 14, WALL, W);
      e.preventDefault();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      state.aimX = clamp(state.aimX + 14, WALL, W);
      e.preventDefault();
    } else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowDown') {
      /* 空格/回车只在局内投放；结束后不再用它们重开（免得手快连着开新局） */
      if (!state.over) { tryDrop(); e.preventDefault(); }
    } else if (e.code === 'KeyR') {
      reset();
      e.preventDefault();
    }
  });

  /* 音效按钮里是 <span class="ico"> + <span class="lbl">，只改这两块文字 */
  function paintSoundBtn() {
    const ico = soundBtn.querySelector('.ico');
    const lbl = soundBtn.querySelector('.lbl');
    if (ico) ico.textContent = Sound.muted ? '🔇' : '🔊';
    if (lbl) lbl.textContent = Sound.muted ? '音效关' : '音效开';
    soundBtn.setAttribute('aria-pressed', String(!Sound.muted));
  }

  soundBtn.addEventListener('click', () => {
    Sound.muted = !Sound.muted;
    localStorage.setItem(MUTE_KEY, Sound.muted ? '1' : '0');
    paintSoundBtn();
    if (Sound.muted) {
      Sound.stopMerge();     // 静音要立刻掐掉正在播的合成音，不是等它放完
    } else {
      Sound.merge(1);        // 顺便给个反馈音
    }
  });

  resetBtn.addEventListener('click', reset);
  restartBtn.addEventListener('click', reset);

  /* ---------------------------------------------------------
   *  素材加载
   * ------------------------------------------------------- */

  /* 贴图没加载出来就自动回退到程序化水果，所以缺图也能玩。
     注意必须等 decode() 完成再拿去 drawImage —— 否则浏览器会画出“还没解码完”的半成品。 */
  function loadSprites() {
    let left = 0;
    for (let i = 0; i < FRUITS.length; i++) {
      const f = FRUITS[i];
      if (!f.file) continue;
      left++;
      const img = new Image();
      img.onload = () => {
        const ready = () => {
          f.img = img;
          left--;
          if (left === 0) refreshPreviews();
        };
        if (img.decode) img.decode().then(ready, ready);
        else ready();
      };
      img.onerror = () => {
        left--;
        if (window.console) console.warn('[合成大W] 素材载入失败，已回退为程序化水果：' + f.file);
      };
      img.src = f.file;
    }
    return left;
  }

  function refreshPreviews() {
    drawNext();
    drawChain();
  }

  /* ---------------------------------------------------------
   *  启动
   * ------------------------------------------------------- */

  function boot() {
    resizeCanvas();
    if (window.ResizeObserver) {
      new ResizeObserver(resizeCanvas).observe(stage);
    }
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));

    paintSoundBtn();

    drawChain();
    reset();
    loadSprites();          // 贴图异步到位，到了会自动重画预览
    Sound.loadMergeSound(MERGE_SOUND_URL);   // 合成音效；失败会自动退回合成音
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* 调试句柄（控制台可用）：__GAME__.state / .reset() / .drop() / .FRUITS / .render() */
  window.__GAME__ = { state, reset, tryDrop, stepPhysics, FRUITS, render, resizeCanvas, shapeOf, makeBall, Sound };
})();
