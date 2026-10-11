/* ------------------------------------------------------------------
   COIN PUSHER — game
   A 2.5D coin pusher: coins are rigid discs on a top-down playfield
   that can stack a few layers deep. The pusher shelf slides back and
   forth; anything shoved over the front ledge is yours.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var A = window.ArcadeAudio;

  /* ------------------------------ tunables ------------------------------ */
  var CFG = {
    COIN_VALUE: 0.25,            // quarters
    STACK_PRICE: 10,             // dollars per stack
    STACK_COINS: 40,             // quarters per stack
    MACHINE_START_DOLLARS: 1000, // how loaded the machine is at the start (~100 stacks)

    W: 800,                      // playfield width (world units)
    D: 520,                      // playfield depth; y=0 is the back wall, y=D the front ledge
    R: 8,                        // coin radius
    THICK: 2.6,                  // coin thickness (z units)
    MAX_LAYERS: 5,               // how deep the pile can stack

    P_MIN: 3,                    // pusher front edge when fully retracted (must be < R so wall-blocked coins tip off)
    P_MAX: 104,                  // pusher front edge when fully extended
    PERIOD: 3.0,                 // seconds for one back-and-forth
    SHELF_H: 14,                 // pusher shelf height above the playfield
    WALL_H: 70,                  // back wall height
    CHUTE_Y: 40,                 // depth where a dropped coin lands
    GUTTER_FROM: 0.72,           // side gutters are open from this fraction of depth to the ledge
    TRAY_DROP: 30,               // how far the ledge drops into the payout tray

    FRICTION: 0.76,
    SUPPORT_R: 1.35,             // × R: max distance to a coin below that still supports you
    DROP_Z: 130,
    GRAV: 0.42,
    ITER: 3,
    RELAX: 0.34,                 // fraction of an overlap removed per solver pass
    SLOP: 0.5,                   // overlaps smaller than this are ignored: crude static friction, stops the pile creeping
    RAPID_MS: 230
  };

  var R = CFG.R, R2 = R * 2, W = CFG.W, D = CFG.D;
  var GUTTER_Y = D * CFG.GUTTER_FROM;
  var SUPPORT = CFG.SUPPORT_R * R, SUPPORT2 = SUPPORT * SUPPORT;

  /* ------------------------------ state ------------------------------ */
  var coins = [];        // coins resting on the playfield (any layer)
  var shelfCoins = [];   // coins riding on the pusher shelf
  var airCoins = [];     // coins the player just dropped, still falling
  var payouts = [];      // screen-space animations of coins falling into the tray
  var losts = [];        // screen-space animations of coins falling into the side gutters
  var sparks = [];       // confetti for big wins
  var floaters = [];     // "+1" floating labels
  var layers = [];       // per-layer coin lists, rebuilt every physics step
  var econ = { stack: 0, spent: 0, won: 0, lost: 0, best: 0, played: 0 };
  var pusher = { front: CFG.P_MAX, prevFront: CFG.P_MAX, dy: 0, dir: -1, t: CFG.PERIOD / 2 };
  var chuteX = W / 2;
  var settling = true, running = false, started = false;
  var combo = { count: 0, until: 0 };
  var nextId = 1;
  var frame = 0;

  for (var li = 0; li < CFG.MAX_LAYERS; li++) layers.push([]);

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ------------------------------ canvas & projection ------------------------------ */
  var canvas = document.getElementById('game');
  var g = canvas.getContext('2d');
  var CW = 960, CH = 570;
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = CW * DPR;
  canvas.height = CH * DPR;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Pseudo-perspective: things get a little bigger toward the front edge.
  var VIEW = { cx: CW / 2, top: 122, sBack: 0.86, sFront: 1.14, sy: 0.64, sz: 0.95 };
  function scaleAt(y) { return VIEW.sBack + (VIEW.sFront - VIEW.sBack) * (y / D); }
  function screenY(y) {
    var a = VIEW.sBack, b = VIEW.sFront - VIEW.sBack;
    return VIEW.top + VIEW.sy * (a * y + b * y * y / (2 * D));
  }
  function px(x, y) { return VIEW.cx + (x - W / 2) * scaleAt(y); }
  function py(y, z) { return screenY(y) - (z || 0) * VIEW.sz * scaleAt(y); }
  function worldX(sx, y) { return W / 2 + (sx - VIEW.cx) / scaleAt(y); }

  var LEDGE_SY = screenY(D);
  var TRAY_SY = LEDGE_SY + CFG.TRAY_DROP * VIEW.sz * VIEW.sFront;

  /* ------------------------------ sprites ------------------------------ */
  var SPR_SCALE = 4;
  function makeCoinSprite(tint, shade) {
    var w = R2 * SPR_SCALE;
    var faceH = R2 * VIEW.sy * SPR_SCALE;
    var side = CFG.THICK * VIEW.sz * SPR_SCALE;
    var c = document.createElement('canvas');
    c.width = Math.ceil(w) + 2;
    c.height = Math.ceil(faceH + side) + 2;
    var k = c.getContext('2d');
    var cx = c.width / 2, cy = faceH / 2 + 1;
    var rx = R * SPR_SCALE, ry = R * VIEW.sy * SPR_SCALE;

    // side (the thickness of the coin, seen from slightly above)
    k.fillStyle = tint.side;
    k.beginPath();
    k.ellipse(cx, cy + side, rx, ry, 0, 0, Math.PI * 2);
    k.fill();
    k.fillRect(cx - rx, cy, rx * 2, side);
    // reeded edge: tiny dark ticks along the lower rim
    k.strokeStyle = tint.reed;
    k.lineWidth = 1.2;
    for (var a = 0.1; a < Math.PI - 0.1; a += 0.17) {
      var ex = cx + Math.cos(a) * rx, ey = cy + side + Math.sin(a) * ry;
      k.beginPath();
      k.moveTo(ex, ey - side * 0.9);
      k.lineTo(ex, ey);
      k.stroke();
    }

    // face
    var grad = k.createRadialGradient(cx - rx * 0.35, cy - ry * 0.45, rx * 0.1, cx, cy, rx * 1.1);
    grad.addColorStop(0, tint.hi);
    grad.addColorStop(0.45, tint.mid);
    grad.addColorStop(1, tint.lo);
    k.fillStyle = grad;
    k.beginPath();
    k.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    k.fill();

    // rim
    k.strokeStyle = tint.rim;
    k.lineWidth = SPR_SCALE * 0.9;
    k.beginPath();
    k.ellipse(cx, cy, rx - SPR_SCALE * 0.6, ry - SPR_SCALE * 0.6 * VIEW.sy, 0, 0, Math.PI * 2);
    k.stroke();

    // inner relief ring + a little star, like a worn quarter
    k.strokeStyle = tint.relief;
    k.lineWidth = SPR_SCALE * 0.5;
    k.beginPath();
    k.ellipse(cx, cy, rx * 0.62, ry * 0.62, 0, 0, Math.PI * 2);
    k.stroke();
    k.fillStyle = tint.relief;
    k.beginPath();
    for (var i = 0; i < 10; i++) {
      var rr = (i % 2 === 0 ? 0.34 : 0.15);
      var ang = -Math.PI / 2 + i * Math.PI / 5;
      k.lineTo(cx + Math.cos(ang) * rx * rr, cy + Math.sin(ang) * ry * rr);
    }
    k.closePath();
    k.fill();

    // gloss
    var gloss = k.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.3, cy + ry);
    gloss.addColorStop(0, 'rgba(255,255,255,0.55)');
    gloss.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    k.fillStyle = gloss;
    k.beginPath();
    k.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2);
    k.fill();

    // coins buried deeper in the pile sit in shadow
    if (shade > 0) {
      k.globalCompositeOperation = 'source-atop';
      k.fillStyle = 'rgba(12,8,36,' + shade.toFixed(3) + ')';
      k.fillRect(0, 0, c.width, c.height);
      k.globalCompositeOperation = 'source-over';
    }

    return { img: c, w: c.width / SPR_SCALE, h: c.height / SPR_SCALE, ox: c.width / 2 / SPR_SCALE, oy: cy / SPR_SCALE };
  }

  var TINTS = [
    { hi: '#ffffff', mid: '#dfe2ea', lo: '#9a9fb0', side: '#6f7486', reed: '#4e5263', rim: 'rgba(90,95,112,0.55)', relief: 'rgba(110,116,135,0.5)' },
    { hi: '#fbfbfd', mid: '#cfd3dd', lo: '#878c9d', side: '#5f6476', reed: '#434756', rim: 'rgba(80,85,100,0.6)', relief: 'rgba(95,100,118,0.55)' },
    { hi: '#ffffff', mid: '#e9ebf1', lo: '#a8adbd', side: '#787d90', reed: '#555a6b', rim: 'rgba(100,105,122,0.5)', relief: 'rgba(120,126,145,0.45)' }
  ];
  // SPRITES[layer][tint]: lower layers are drawn darker so the pile has depth
  var SPRITES = [];
  for (var sl = 0; sl < CFG.MAX_LAYERS; sl++) {
    var shade = (CFG.MAX_LAYERS - 1 - sl) * 0.085;
    SPRITES.push(TINTS.map(function (t) { return makeCoinSprite(t, shade); }));
  }
  var TOP_LAYER = CFG.MAX_LAYERS - 1;

  function sprite(id, layer) { return SPRITES[layer][id % TINTS.length]; }

  function drawCoin(c, x, y, z, alpha, layer) {
    var s = scaleAt(y) * c.r / R;
    var spr = sprite(c.id, layer == null ? c.layer : layer);
    var sx = px(x, y), sy = py(y, z);
    if (alpha != null && alpha < 1) g.globalAlpha = alpha;
    g.drawImage(spr.img, sx - spr.ox * s, sy - spr.oy * s, spr.w * s, spr.h * s);
    if (alpha != null && alpha < 1) g.globalAlpha = 1;
  }

  function drawShadow(x, y, zSurface, height, s) {
    var k = clamp(1 - height / CFG.DROP_Z, 0.15, 1);
    g.fillStyle = 'rgba(0,0,0,' + (0.38 * k).toFixed(3) + ')';
    g.beginPath();
    g.ellipse(px(x, y), py(y, zSurface), R * s * (0.6 + 0.4 * k), R * s * VIEW.sy * (0.6 + 0.4 * k), 0, 0, Math.PI * 2);
    g.fill();
  }

  /* ------------------------------ coin factory ------------------------------ */
  // Every coin is a quarter, but each gets a hair of variation in size and in how far it
  // can hang over an edge before tipping. Identical discs lock into a rigid lattice and
  // the whole front row would drop at once; a little disorder makes the pile trickle.
  function makeCoin(x, y, layer, z, r, tip) {
    r = r || R * rnd(0.93, 1.07);
    return {
      id: nextId++, x: x, y: y, px: x, py: y, vx: 0, vy: 0, r: r,
      tip: tip == null ? r * rnd(0.05, 0.9) : tip,
      layer: layer, z: z == null ? layer * CFG.THICK : z, vz: 0, ov: 0, settled: true
    };
  }

  // Build a plausible starting pile: deep near the pusher, thinning toward the ledge.
  function generatePile(target) {
    coins = [];
    shelfCoins = [];
    airCoins = [];
    var y0 = CFG.P_MAX + R + 3;
    var yEnd = D - R * 0.3;      // the front row teeters near the ledge, like a machine that's been played
    var spots = [];
    var rowH = R2 * 0.88, row = 0;
    for (var y = y0; y <= yEnd; y += rowH, row++) {
      var off = (row % 2) * R + rnd(-2, 2);
      for (var x = R + 1 + off; x <= W - R - 1; x += R2 * 1.01) spots.push({ x: x, y: y, t: (y - y0) / (yEnd - y0), n: 0 });
    }
    var count = 0;
    for (var L = 0; L < CFG.MAX_LAYERS && count < target; L++) {
      for (var i = 0; i < spots.length && count < target; i++) {
        var sp = spots[i];
        if (sp.n !== L) continue;
        var p = L === 0 ? 0.985 : clamp(1.42 - 1.3 * sp.t - 0.16 * (L - 1), 0, 0.96);
        if (Math.random() >= p) continue;
        var jit = L === 0 ? 0.9 : 2.2;
        var yj = sp.t > 0.95 ? rnd(-R * 0.9, R * 0.4) : rnd(-jit, jit);
        var c = makeCoin(clamp(sp.x + rnd(-jit, jit), R, W - R), clamp(sp.y + yj, y0 - 2, D + R * 0.2), L);
        c.settled = true;
        coins.push(c);
        sp.n++;
        count++;
      }
    }
    return count;
  }

  function machineCoinCount() { return coins.length + shelfCoins.length + airCoins.length; }

  /* ------------------------------ spatial hash ------------------------------ */
  var CELL = R2;
  var GCOLS = Math.ceil(W / CELL) + 3, GROWS = Math.ceil((D + R2 * 2) / CELL) + 3;
  var grids = [];
  for (var gl = 0; gl < CFG.MAX_LAYERS; gl++) {
    var cells = new Array(GCOLS * GROWS);
    for (var ci = 0; ci < cells.length; ci++) cells[ci] = [];
    grids.push(cells);
  }
  function cellIndex(x, y) {
    var cx = clamp(Math.floor(x / CELL) + 1, 0, GCOLS - 1);
    var cy = clamp(Math.floor(y / CELL) + 1, 0, GROWS - 1);
    return cy * GCOLS + cx;
  }
  function clearGrid(L) {
    var cells = grids[L];
    for (var i = 0; i < cells.length; i++) cells[i].length = 0;
  }
  function insertGrid(L, c) { grids[L][cellIndex(c.x, c.y)].push(c); }

  // visit every live coin in the 3x3 cells around (x, y) on layer grid `cells`
  function eachNear(cells, x, y, fn) {
    var ci = cellIndex(x, y);
    var cx0 = ci % GCOLS, cy0 = (ci - cx0) / GCOLS;
    for (var oy = -1; oy <= 1; oy++) {
      var ry = cy0 + oy;
      if (ry < 0 || ry >= GROWS) continue;
      for (var ox = -1; ox <= 1; ox++) {
        var rx = cx0 + ox;
        if (rx < 0 || rx >= GCOLS) continue;
        var cell = cells[ry * GCOLS + rx];
        for (var k = 0; k < cell.length; k++) {
          var b = cell[k];
          if (b.dead) continue;
          if (fn(b) === true) return true;
        }
      }
    }
    return false;
  }

  /* ------------------------------ collisions ------------------------------ */
  var REST = 0.12;
  function resolve(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var d2 = dx * dx + dy * dy;
    var min = a.r + b.r;
    if (d2 >= min * min) return;
    if (d2 < 1e-6) { dx = rnd(-0.2, 0.2); dy = rnd(-0.2, 0.2); d2 = dx * dx + dy * dy; }
    var d = Math.sqrt(d2);
    var overlap = min - d;
    if (overlap < CFG.SLOP) return;
    var nx = dx / d, ny = dy / d;
    var h = overlap * CFG.RELAX;
    a.x -= nx * h; a.y -= ny * h;
    b.x += nx * h; b.y += ny * h;
    if (overlap > a.ov) a.ov = overlap;
    if (overlap > b.ov) b.ov = overlap;
    var vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn < 0) {
      var j = -vn * 0.5 * (1 + REST);
      a.vx -= j * nx; a.vy -= j * ny;
      b.vx += j * nx; b.vy += j * ny;
    }
  }

  function collideCell(a, cell) {
    for (var j = 0; j < cell.length; j++) resolve(a, cell[j]);
  }

  // Walk the grid back-to-front so a push from the pusher propagates forward
  // through the pile within a single pass.
  function collideLayer(L) {
    var cells = grids[L];
    for (var cy = 0; cy < GROWS; cy++) {
      var lastRow = cy === GROWS - 1;
      for (var cx = 0; cx < GCOLS; cx++) {
        var idx = cy * GCOLS + cx;
        var cell = cells[idx];
        if (!cell.length) continue;
        var hasRight = cx < GCOLS - 1, hasLeft = cx > 0;
        for (var i = 0; i < cell.length; i++) {
          var a = cell[i];
          for (var j = i + 1; j < cell.length; j++) resolve(a, cell[j]);
          if (hasRight) collideCell(a, cells[idx + 1]);
          if (!lastRow) {
            if (hasLeft) collideCell(a, cells[idx + GCOLS - 1]);
            collideCell(a, cells[idx + GCOLS]);
            if (hasRight) collideCell(a, cells[idx + GCOLS + 1]);
          }
        }
      }
    }
  }

  function hasSupport(c, below) {
    return eachNear(below, c.x, c.y, function (b) {
      var dx = b.x - c.x, dy = b.y - c.y;
      return dx * dx + dy * dy < SUPPORT2;
    });
  }

  function crowdedAbove(c, L) {
    if (L >= CFG.MAX_LAYERS) return true;
    return eachNear(grids[L], c.x, c.y, function (b) {
      var dx = b.x - c.x, dy = b.y - c.y;
      return dx * dx + dy * dy < R * R;
    });
  }

  // Which layer would a coin landing at (x, y) come to rest on?
  function landingLayer(x, y) {
    var top = -1;
    for (var L = CFG.MAX_LAYERS - 1; L > top; L--) {
      var hit = eachNear(grids[L], x, y, function (b) {
        var dx = b.x - x, dy = b.y - y;
        return dx * dx + dy * dy < SUPPORT2;
      });
      if (hit) { top = L; break; }
    }
    return Math.min(top + 1, CFG.MAX_LAYERS - 1);
  }

  /* ------------------------------ pusher ------------------------------ */
  function stepPusher() {
    pusher.t += 1 / 60;
    var ph = (pusher.t % CFG.PERIOD) / CFG.PERIOD;
    pusher.prevFront = pusher.front;
    pusher.front = CFG.P_MIN + (CFG.P_MAX - CFG.P_MIN) * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2));
    pusher.dy = pusher.front - pusher.prevFront;
    var dir = pusher.dy >= 0 ? 1 : -1;
    if (dir !== pusher.dir) {
      pusher.dir = dir;
      if (!settling && running) A.motorClunk(dir > 0);
    }
  }

  /* ------------------------------ coins in the air ------------------------------ */
  function stepAir() {
    for (var i = airCoins.length - 1; i >= 0; i--) {
      var c = airCoins[i];
      c.vz -= CFG.GRAV;
      c.z += c.vz;
      c.x += c.vx;
      c.y += c.vy;
      c.x = clamp(c.x, c.r, W - c.r);
      if (c.y < c.r) c.y = c.r;
      if (!c.passedShelf && c.z <= CFG.SHELF_H) {
        if (c.y < pusher.front - c.r * 0.25) {
          // plink: landed on the pusher shelf
          airCoins.splice(i, 1);
          c.z = CFG.SHELF_H;
          c.vz = -c.vz * 0.32;
          c.vx += rnd(-0.5, 0.5);
          c.vy += rnd(-0.4, 0.4);
          if (!settling) A.coinTink(0, 1);
          shelfCoins.push(c);
          continue;
        }
        c.passedShelf = true;
      }
      if (c.passedShelf) {
        var L = landingLayer(c.x, c.y);
        var floor = L * CFG.THICK;
        if (c.z <= floor) {
          airCoins.splice(i, 1);
          c.layer = L;
          c.z = floor;
          c.vz = -c.vz * 0.3;
          c.vx += rnd(-0.6, 0.6);
          c.vy += rnd(-0.3, 0.6);
          c.settled = false;
          if (!settling) A.coinClink(0, 1);
          coins.push(c);
        }
      }
    }
  }

  /* ------------------------------ coins on the shelf ------------------------------ */
  function stepShelf() {
    var front = pusher.front, pdy = pusher.dy;
    var i, j, c;
    for (i = 0; i < shelfCoins.length; i++) {
      c = shelfCoins[i];
      c.px = c.x; c.py = c.y; c.ov = 0;
      c.y += pdy;                 // rides with the shelf
      if (c.y < c.r) c.y = c.r;   // ...until the back wall holds it and the shelf slides out from under
      c.x += c.vx; c.y += c.vy;
      c.vx *= CFG.FRICTION; c.vy *= CFG.FRICTION;
      if (c.x < c.r) { c.x = c.r; c.vx = 0; } else if (c.x > W - c.r) { c.x = W - c.r; c.vx = 0; }
      if (c.z > CFG.SHELF_H || c.vz !== 0) {
        c.vz -= CFG.GRAV;
        c.z += c.vz;
        if (c.z <= CFG.SHELF_H) {
          c.z = CFG.SHELF_H;
          if (c.vz < -1.6) {
            c.vz = -c.vz * 0.32;
            if (!settling) A.coinTink(0, clamp(-c.vz * 0.3, 0.25, 1));
            c.vx += rnd(-0.5, 0.5);
            c.vy += rnd(-0.3, 0.5);
          } else c.vz = 0;
        }
      }
    }
    for (var it = 0; it < 2; it++) {
      for (i = 0; i < shelfCoins.length; i++) for (j = i + 1; j < shelfCoins.length; j++) resolve(shelfCoins[i], shelfCoins[j]);
      for (i = 0; i < shelfCoins.length; i++) {
        c = shelfCoins[i];
        if (c.y < c.r) c.y = c.r;
        if (c.x < c.r) c.x = c.r; else if (c.x > W - c.r) c.x = W - c.r;
      }
    }
    // anything hanging more than halfway over the shelf's front edge tips onto the pile
    for (i = shelfCoins.length - 1; i >= 0; i--) {
      c = shelfCoins[i];
      if (c.y > front + c.r * 0.15) {
        shelfCoins.splice(i, 1);
        c.y += c.r * 0.6;
        c.layer = landingLayer(c.x, c.y);
        c.vy = 0.8 + rnd(0, 0.6);
        c.vx = rnd(-0.5, 0.5);
        c.vz = -0.2;
        c.settled = false;
        coins.push(c);
      }
    }
  }

  /* ------------------------------ coins on the playfield ------------------------------ */
  function stepField() {
    var L, i, c, list;
    for (L = 0; L < CFG.MAX_LAYERS; L++) layers[L].length = 0;
    for (i = 0; i < coins.length; i++) { c = coins[i]; layers[c.layer].push(c); }

    var front = pusher.front, pdy = pusher.dy;
    var anyDead = false;

    for (L = 0; L < CFG.MAX_LAYERS; L++) {
      list = layers[L];
      var below = L > 0 ? grids[L - 1] : null;
      clearGrid(L);
      for (i = 0; i < list.length; i++) {
        c = list[i];
        c.px = c.x; c.py = c.y; c.ov = 0;
        if (below) rideAlong(c, below);
        if (c.y - c.r < front) {
          c.y = front + c.r;
          if (pdy > 0 && c.vy < pdy * 0.5) c.vy = pdy * 0.5;
        }
        c.x += c.vx; c.y += c.vy;
        c.vx *= CFG.FRICTION; c.vy *= CFG.FRICTION;
        if (c.vx > -0.01 && c.vx < 0.01) c.vx = 0;
        if (c.vy > -0.01 && c.vy < 0.01) c.vy = 0;
        if (c.y < GUTTER_Y) {
          if (c.x < c.r) { c.x = c.r; c.vx = 0; } else if (c.x > W - c.r) { c.x = W - c.r; c.vx = 0; }
        }
        var floor = L * CFG.THICK;
        if (c.z > floor || c.vz !== 0) {
          c.vz -= CFG.GRAV;
          c.z += c.vz;
          if (c.z <= floor) {
            c.z = floor;
            if (c.vz < -1.6) {
              c.vz = -c.vz * 0.3;
              if (!settling) A.coinClink(0, clamp(-c.vz * 0.3, 0.2, 1));
              c.vx += rnd(-0.4, 0.4);
              c.vy += rnd(-0.2, 0.5);
            } else c.vz = 0;
          }
        } else if (c.z < floor) {
          c.z = floor; // climbed a layer
        }
        insertGrid(L, c);
      }

      for (var it = 0; it < CFG.ITER; it++) {
        collideLayer(L);
        for (i = 0; i < list.length; i++) {
          c = list[i];
          if (c.y - c.r < front) c.y = front + c.r;
          if (c.y < GUTTER_Y) { if (c.x < c.r) c.x = c.r; else if (c.x > W - c.r) c.x = W - c.r; }
        }
      }

      for (i = 0; i < list.length; i++) {
        c = list[i];
        if (L > 0 && !hasSupport(c, below)) {
          // nothing underneath any more: drop a layer
          c.layer = L - 1;
          if (c.vz === 0) c.vz = -0.01;
          c.settled = false;
          continue;
        }
        if (c.ov > R * 0.65 && L < CFG.MAX_LAYERS - 1 && Math.random() < 0.5 && !crowdedAbove(c, L + 1)) {
          // jammed hard against a neighbour: ride up onto it
          c.layer = L + 1;
          c.z = c.layer * CFG.THICK;
          continue;
        }
        if (c.y > D + c.tip) { payout(c); anyDead = true; continue; }
        if (c.y > GUTTER_Y && (c.x < -c.tip || c.x > W + c.tip)) { lose(c); anyDead = true; }
      }
    }

    if (anyDead) {
      var keep = [];
      for (i = 0; i < coins.length; i++) if (!coins[i].dead) keep.push(coins[i]);
      coins = keep;
    }
  }

  // a coin resting on others moves with them (friction)
  function rideAlong(c, below) {
    var sx = 0, sy = 0, n = 0;
    eachNear(below, c.x, c.y, function (b) {
      var dx = b.x - c.x, dy = b.y - c.y;
      if (dx * dx + dy * dy < SUPPORT2) { sx += b.x - b.px; sy += b.y - b.py; n++; }
    });
    if (n > 0) { c.x += sx / n; c.y += sy / n; }
  }

  /* ------------------------------ winning & losing coins ------------------------------ */
  var lastSettleEvent = 0;   // last frame a coin left the machine during stocking

  function payout(c) {
    c.dead = true;
    if (settling) { lastSettleEvent = frame; return; }
    payouts.push({
      id: c.id, k: c.r / R, sx: px(c.x, c.y), sy: py(c.y, c.z), vx: rnd(-0.5, 0.5), vy: rnd(0.3, 1.4),
      floor: TRAY_SY + 8 + rnd(0, 26), bounces: 0, credited: false, alpha: 1, life: 0
    });
    A.coinPayout(0, 1);
    var t = performance.now();
    if (t < combo.until) combo.count++; else combo.count = 1;
    combo.until = t + 1100;
  }

  function lose(c) {
    c.dead = true;
    if (settling) { lastSettleEvent = frame; return; }
    econ.lost++;
    var side = c.x < W / 2 ? -1 : 1;
    losts.push({ id: c.id, sx: px(c.x, c.y), sy: py(c.y, c.z), vx: side * rnd(0.8, 1.6), vy: 0.4, alpha: 1, s: scaleAt(c.y) * c.r / R });
    A.coinLost(0);
    statsDirty = true;
  }

  function credit() {
    econ.stack++;
    econ.won++;
    stackDelta++;
    statsDirty = true;
  }

  var statsDirty = true, stackDelta = 0;

  function stepAnims() {
    var i, p;
    for (i = payouts.length - 1; i >= 0; i--) {
      p = payouts[i];
      p.life++;
      if (!p.credited || p.bounces < 3) {
        p.vy += 0.5;
        p.sy += p.vy;
        p.sx += p.vx;
        if (p.sy >= p.floor) {
          p.sy = p.floor;
          if (!p.credited) { p.credited = true; credit(); floaters.push({ sx: p.sx, sy: p.sy - 10, life: 0 }); }
          if (p.vy > 2 && p.bounces < 3) { p.vy = -p.vy * 0.32; p.bounces++; }
          else { p.vy = 0; p.bounces = 3; p.vx *= 0.5; }
        }
      } else {
        p.alpha -= 0.05;
        p.sy += 0.6;
        if (p.alpha <= 0) payouts.splice(i, 1);
      }
    }
    for (i = losts.length - 1; i >= 0; i--) {
      p = losts[i];
      p.vy += 0.35;
      p.sy += p.vy;
      p.sx += p.vx;
      p.alpha -= 0.035;
      if (p.alpha <= 0) losts.splice(i, 1);
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      p = floaters[i];
      p.life++;
      p.sy -= 0.9;
      if (p.life > 50) floaters.splice(i, 1);
    }
    for (i = sparks.length - 1; i >= 0; i--) {
      p = sparks[i];
      p.vy += 0.18;
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.98;
      p.life--;
      if (p.life <= 0) sparks.splice(i, 1);
    }
    if (combo.count > 0 && performance.now() > combo.until) {
      finishCombo(combo.count);
      combo.count = 0;
    }
  }

  function finishCombo(n) {
    if (n > econ.best) { econ.best = n; statsDirty = true; }
    if (n < 4) return;
    var label = n >= 20 ? 'JACKPOT! +' + n : n >= 10 ? 'HUGE! +' + n : n >= 6 ? 'SWEET! +' + n : 'NICE! +' + n;
    toast(label);
    A.fanfare(n >= 20 ? 3 : n >= 10 ? 2 : 1);
    var burst = Math.min(140, n * 6);
    for (var i = 0; i < burst; i++) {
      sparks.push({
        x: CW / 2 + rnd(-220, 220), y: LEDGE_SY + rnd(-10, 30),
        vx: rnd(-3, 3), vy: rnd(-7, -2), life: 50 + Math.random() * 40,
        color: ['#ffe14d', '#ff3ec9', '#38f3ff', '#5dff8a', '#ffffff'][i % 5]
      });
    }
  }

  function physicsStep(advancePusher) {
    if (advancePusher) stepPusher();
    else { pusher.prevFront = pusher.front; pusher.dy = 0; }
    stepAir();
    stepShelf();
    stepField();
    stepAnims();
    frame++;
  }

  /* ------------------------------ rendering ------------------------------ */
  var PIXEL_FONT = '"Press Start 2P", "Courier New", monospace';

  function quad(x1, y1, x2, y2, x3, y3, x4, y4) {
    g.beginPath();
    g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.lineTo(x4, y4);
    g.closePath();
  }

  function byY(a, b) { return a.y - b.y; }

  function render(now) {
    g.clearRect(0, 0, CW, CH);
    var bg = g.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, '#0e0a26');
    bg.addColorStop(1, '#050410');
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);

    drawSidePanels();
    drawBackWall(now);
    drawFloor();
    drawRails();
    drawShelf();
    drawFieldCoins();
    drawLedgeAndTray();
    drawPayouts();
    drawLosts();
    drawAirCoins();
    drawChute(now);
    drawSparks();
    drawFloaters();
  }

  function drawSidePanels() {
    // cabinet walls either side of the playfield
    g.fillStyle = '#17113a';
    quad(0, py(0, CFG.WALL_H) - 30, px(0, 0) - 4, py(0, CFG.WALL_H) - 30, px(0, D) - 4, CH, 0, CH);
    g.fill();
    quad(CW, py(0, CFG.WALL_H) - 30, px(W, 0) + 4, py(0, CFG.WALL_H) - 30, px(W, D) + 4, CH, CW, CH);
    g.fill();
  }

  function drawBackWall(now) {
    var x0 = px(0, 0), x1 = px(W, 0);
    var yTop = py(0, CFG.WALL_H), yBot = py(0, 0);
    var grad = g.createLinearGradient(0, yTop, 0, yBot);
    grad.addColorStop(0, '#3a1657');
    grad.addColorStop(0.55, '#24103f');
    grad.addColorStop(1, '#150a2a');
    g.fillStyle = grad;
    g.fillRect(x0, yTop, x1 - x0, yBot - yTop);

    // neon strip
    g.fillStyle = 'rgba(56,243,255,0.9)';
    g.shadowColor = '#38f3ff';
    g.shadowBlur = 12;
    g.fillRect(x0 + 10, yTop + 6, x1 - x0 - 20, 2);
    g.shadowBlur = 0;

    // marquee lights along the top edge, chasing
    var phase = Math.floor((now || 0) / 180) % 3;
    for (var i = 0, n = 0; i < x1 - x0 - 20; i += 16, n++) {
      g.fillStyle = (n % 3 === phase) ? '#ffe14d' : 'rgba(255,225,77,0.22)';
      g.beginPath();
      g.arc(x0 + 14 + i, yTop + 15, 2.2, 0, Math.PI * 2);
      g.fill();
    }

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (econ.stack <= 0 && started) {
      if (Math.floor((now || 0) / 500) % 2 === 0) {
        g.font = '12px ' + PIXEL_FONT;
        g.fillStyle = '#ff3ec9';
        g.shadowColor = '#ff3ec9';
        g.shadowBlur = 14;
        g.fillText('INSERT COIN', CW / 2, yTop + 31);
        g.shadowBlur = 0;
      }
    } else {
      g.font = '11px ' + PIXEL_FONT;
      g.fillStyle = '#ffe14d';
      g.shadowColor = '#ffe14d';
      g.shadowBlur = 10;
      g.fillText('★ LUCKY PUSHER ★', CW / 2, yTop + 31);
      g.shadowBlur = 0;
    }
    // a groove along the bottom of the wall where the chute lets coins out
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x0, yBot - 14, x1 - x0, 6);
  }

  function drawFloor() {
    var grad = g.createLinearGradient(0, py(0, 0), 0, py(D, 0));
    grad.addColorStop(0, '#1f6a3c');
    grad.addColorStop(1, '#154a2a');
    g.fillStyle = grad;
    quad(px(0, 0), py(0, 0), px(W, 0), py(0, 0), px(W, D), py(D, 0), px(0, D), py(D, 0));
    g.fill();
    // faint depth lines so the pile's motion reads
    g.strokeStyle = 'rgba(255,255,255,0.045)';
    g.lineWidth = 1;
    for (var y = 60; y < D; y += 60) {
      g.beginPath();
      g.moveTo(px(0, y), py(y, 0));
      g.lineTo(px(W, y), py(y, 0));
      g.stroke();
    }
    // the sweep zone in front of the pusher is a touch lighter
    g.fillStyle = 'rgba(255,255,255,0.05)';
    quad(px(0, 0), py(0, 0), px(W, 0), py(0, 0), px(W, CFG.P_MAX), py(CFG.P_MAX, 0), px(0, CFG.P_MAX), py(CFG.P_MAX, 0));
    g.fill();
  }

  function drawRails() {
    var railH = 5;
    // solid rails along the back half
    g.fillStyle = '#4b3a86';
    quad(px(0, 0) - 6, py(0, 0) - railH, px(0, 0), py(0, 0) - railH, px(0, GUTTER_Y), py(GUTTER_Y, 0) - railH, px(0, GUTTER_Y) - 6, py(GUTTER_Y, 0) - railH);
    g.fill();
    quad(px(W, 0), py(0, 0) - railH, px(W, 0) + 6, py(0, 0) - railH, px(W, GUTTER_Y) + 6, py(GUTTER_Y, 0) - railH, px(W, GUTTER_Y), py(GUTTER_Y, 0) - railH);
    g.fill();
    g.fillStyle = '#2a1f55';
    quad(px(0, 0) - 6, py(0, 0) - railH, px(0, 0), py(0, 0) - railH, px(0, GUTTER_Y), py(GUTTER_Y, 0), px(0, GUTTER_Y) - 6, py(GUTTER_Y, 0));
    g.fill();
    quad(px(W, 0), py(0, 0) - railH, px(W, 0) + 6, py(0, 0) - railH, px(W, GUTTER_Y) + 6, py(GUTTER_Y, 0), px(W, GUTTER_Y), py(GUTTER_Y, 0));
    g.fill();

    // open gutters along the front half: the house's cut
    g.fillStyle = '#07060f';
    quad(px(0, GUTTER_Y) - 16, py(GUTTER_Y, 0), px(0, GUTTER_Y), py(GUTTER_Y, 0), px(0, D), py(D, 0), px(0, D) - 16, py(D, 0));
    g.fill();
    quad(px(W, GUTTER_Y), py(GUTTER_Y, 0), px(W, GUTTER_Y) + 16, py(GUTTER_Y, 0), px(W, D) + 16, py(D, 0), px(W, D), py(D, 0));
    g.fill();
    g.strokeStyle = 'rgba(255,62,201,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px(0, GUTTER_Y) - 16, py(GUTTER_Y, 0)); g.lineTo(px(0, D) - 16, py(D, 0));
    g.moveTo(px(W, GUTTER_Y) + 16, py(GUTTER_Y, 0)); g.lineTo(px(W, D) + 16, py(D, 0));
    g.stroke();
    g.save();
    g.font = '6px ' + PIXEL_FONT;
    g.fillStyle = 'rgba(255,62,201,0.7)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var ym = (GUTTER_Y + D) / 2;
    g.translate(px(0, ym) - 8, py(ym, 0));
    g.rotate(-Math.PI / 2 + 0.08);
    g.fillText('HOUSE', 0, 0);
    g.restore();
    g.save();
    g.translate(px(W, ym) + 8, py(ym, 0));
    g.rotate(Math.PI / 2 - 0.08);
    g.font = '6px ' + PIXEL_FONT;
    g.fillStyle = 'rgba(255,62,201,0.7)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('HOUSE', 0, 0);
    g.restore();
  }

  function drawShelf() {
    var f = pusher.front, h = CFG.SHELF_H;
    // top face
    var top = g.createLinearGradient(0, py(0, h), 0, py(f, h));
    top.addColorStop(0, '#6a7190');
    top.addColorStop(0.6, '#4d546e');
    top.addColorStop(1, '#5d6482');
    g.fillStyle = top;
    quad(px(0, 0), py(0, h), px(W, 0), py(0, h), px(W, f), py(f, h), px(0, f), py(f, h));
    g.fill();
    // brushed lines
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (var x = 40; x < W; x += 40) {
      g.beginPath();
      g.moveTo(px(x, 0), py(0, h));
      g.lineTo(px(x, f), py(f, h));
      g.stroke();
    }
    // front face
    var face = g.createLinearGradient(0, py(f, h), 0, py(f, 0));
    face.addColorStop(0, '#3b4060');
    face.addColorStop(0.15, '#2c3049');
    face.addColorStop(1, '#171a2b');
    g.fillStyle = face;
    quad(px(0, f), py(f, h), px(W, f), py(f, h), px(W, f), py(f, 0), px(0, f), py(f, 0));
    g.fill();
    // lip
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.moveTo(px(0, f), py(f, h));
    g.lineTo(px(W, f), py(f, h));
    g.stroke();
    g.font = '7px ' + PIXEL_FONT;
    g.fillStyle = 'rgba(255,225,77,0.85)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('★ GOOD LUCK ★', px(W / 2, f), (py(f, h) + py(f, 0)) / 2 + 0.5);

    // coins riding on the shelf
    shelfCoins.sort(byY);
    for (var i = 0; i < shelfCoins.length; i++) {
      var c = shelfCoins[i];
      if (c.z > h + 0.5) drawShadow(c.x, c.y, h, c.z - h, scaleAt(c.y));
      drawCoin(c, c.x, c.y, c.z, 1, TOP_LAYER);
    }
  }

  function drawFieldCoins() {
    coins.sort(byY);
    var n = coins.length;
    for (var L = 0; L < CFG.MAX_LAYERS; L++) {
      for (var i = 0; i < n; i++) {
        var c = coins[i];
        if (c.layer !== L) continue;
        var floor = L * CFG.THICK;
        if (c.z > floor + 0.5) drawShadow(c.x, c.y, floor, c.z - floor, scaleAt(c.y));
        drawCoin(c, c.x, c.y, c.z);
      }
    }
  }

  function drawLedgeAndTray() {
    var x0 = px(0, D), x1 = px(W, D);
    var yTop = py(D, 0), yBot = py(D, -CFG.TRAY_DROP);
    var face = g.createLinearGradient(0, yTop, 0, yBot);
    face.addColorStop(0, '#525a78');
    face.addColorStop(0.1, '#3a4058');
    face.addColorStop(1, '#1b1e30');
    g.fillStyle = face;
    g.fillRect(x0 - 16, yTop, x1 - x0 + 32, yBot - yTop);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x0, yTop - 1, x1 - x0, 1.5);

    // the payout tray
    var trayTop = TRAY_SY, trayH = 54;
    var tray = g.createLinearGradient(0, trayTop, 0, trayTop + trayH);
    tray.addColorStop(0, '#0d0b1f');
    tray.addColorStop(1, '#1b1738');
    g.fillStyle = tray;
    g.beginPath();
    g.moveTo(x0 - 18, trayTop);
    g.lineTo(x1 + 18, trayTop);
    g.lineTo(x1 + 30, trayTop + trayH);
    g.lineTo(x0 - 30, trayTop + trayH);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(56,243,255,0.35)';
    g.lineWidth = 1.5;
    g.stroke();
    g.font = '8px ' + PIXEL_FONT;
    g.fillStyle = 'rgba(56,243,255,0.35)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('▼ PAYOUT ▼', CW / 2, trayTop + trayH - 12);
  }

  function drawPayouts() {
    for (var i = 0; i < payouts.length; i++) {
      var p = payouts[i];
      var spr = sprite(p.id, TOP_LAYER);
      var s = VIEW.sFront * p.k;
      g.globalAlpha = Math.max(0, p.alpha);
      g.drawImage(spr.img, p.sx - spr.ox * s, p.sy - spr.oy * s, spr.w * s, spr.h * s);
    }
    g.globalAlpha = 1;
  }

  function drawLosts() {
    for (var i = 0; i < losts.length; i++) {
      var p = losts[i];
      var spr = sprite(p.id, TOP_LAYER);
      g.globalAlpha = Math.max(0, p.alpha);
      g.drawImage(spr.img, p.sx - spr.ox * p.s, p.sy - spr.oy * p.s, spr.w * p.s, spr.h * p.s);
    }
    g.globalAlpha = 1;
  }

  function drawAirCoins() {
    for (var i = 0; i < airCoins.length; i++) {
      var c = airCoins[i];
      var surface = (!c.passedShelf && c.y < pusher.front - R * 0.25) ? CFG.SHELF_H : landingLayer(c.x, c.y) * CFG.THICK;
      drawShadow(c.x, c.y, surface, c.z - surface, scaleAt(c.y));
      drawCoin(c, c.x, c.y, c.z, 1, TOP_LAYER);
    }
  }

  function drawChute(now) {
    var sx = px(chuteX, 0);
    var yBot = py(0, 0);
    var slotY = yBot - 13;
    var armed = econ.stack > 0;
    // aim line down to where the coin will land
    g.setLineDash([3, 5]);
    g.strokeStyle = 'rgba(255,225,77,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(sx, slotY + 4);
    g.lineTo(px(chuteX, CFG.CHUTE_Y), py(CFG.CHUTE_Y, CFG.SHELF_H));
    g.stroke();
    g.setLineDash([]);
    // the slot, glowing when there's a quarter ready to go
    var pulse = armed ? 0.75 + 0.25 * Math.sin((now || 0) / 150) : 0.3;
    g.fillStyle = '#05040c';
    g.fillRect(sx - 10, slotY, 20, 4);
    g.strokeStyle = 'rgba(255,225,77,' + pulse.toFixed(2) + ')';
    g.lineWidth = 1.5;
    if (armed) { g.shadowColor = '#ffe14d'; g.shadowBlur = 8; }
    g.strokeRect(sx - 10, slotY, 20, 4);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,225,77,' + pulse.toFixed(2) + ')';
    g.beginPath();
    g.moveTo(sx - 5, slotY + 7);
    g.lineTo(sx + 5, slotY + 7);
    g.lineTo(sx, slotY + 12);
    g.closePath();
    g.fill();
  }

  function drawSparks() {
    for (var i = 0; i < sparks.length; i++) {
      var p = sparks[i];
      g.globalAlpha = clamp(p.life / 30, 0, 1);
      g.fillStyle = p.color;
      g.fillRect(p.x, p.y, 3, 3);
    }
    g.globalAlpha = 1;
  }

  function drawFloaters() {
    if (!floaters.length) return;
    g.font = '9px ' + PIXEL_FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (var i = 0; i < floaters.length; i++) {
      var p = floaters[i];
      g.globalAlpha = clamp(1 - p.life / 50, 0, 1);
      g.fillStyle = '#ffe14d';
      g.fillText('+1', p.sx, p.sy);
    }
    g.globalAlpha = 1;
  }

  /* ------------------------------ DOM: stack, stats, toast ------------------------------ */
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    overlay: $('overlay'), overlayTitle: document.querySelector('#overlay .title'), overlayHint: $('overlayHint'),
    progress: $('progressBar'), startBtn: $('startBtn'), toast: $('toast'),
    stackCount: $('stackCount'), stackViz: $('stackViz'), stackEmpty: $('stackEmpty'),
    buyBtn: $('buyBtn'), resetBtn: $('resetBtn'),
    spent: $('spent'), won: $('won'), net: $('net'), machine: $('machine'), lost: $('lost'), best: $('best'),
    musicToggle: $('musicToggle'), sfxToggle: $('sfxToggle'), volume: $('volume')
  };

  var stackEls = [];
  var PER_COL = 26, COL_W = 50, MAX_VIS = PER_COL * 5;

  function syncStack() {
    var target = Math.min(econ.stack, MAX_VIS);
    var added = 0;
    while (stackEls.length < target) {
      var i = stackEls.length;
      var d = document.createElement('div');
      d.className = 'coin';
      d.style.left = (12 + Math.floor(i / PER_COL) * COL_W) + 'px';
      d.style.bottom = (16 + (i % PER_COL) * 4) + 'px';
      d.style.animationDelay = Math.min(added * 18, 700) + 'ms';
      el.stackViz.appendChild(d);
      stackEls.push(d);
      added++;
    }
    while (stackEls.length > target) {
      var gone = stackEls.pop();
      gone.classList.add('out');
      setTimeout(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }.bind(null, gone), 220);
    }
    el.stackEmpty.classList.toggle('hidden', econ.stack > 0);
    el.stackCount.textContent = econ.stack;
    el.stackCount.classList.remove('bump');
    void el.stackCount.offsetWidth;
    el.stackCount.classList.add('bump');
  }

  function money(v) {
    var sign = v < 0 ? '-' : '';
    return sign + '$' + Math.abs(v).toFixed(2);
  }

  function updateStats() {
    el.spent.textContent = money(econ.spent);
    el.won.textContent = econ.won;
    var net = econ.stack * CFG.COIN_VALUE - econ.spent;
    el.net.textContent = (net > 0 ? '+' : '') + money(net);
    el.net.className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
    el.machine.textContent = '$' + (machineCoinCount() * CFG.COIN_VALUE).toFixed(0);
    el.lost.textContent = econ.lost;
    el.best.textContent = econ.best;
  }

  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.remove('show');
    void el.toast.offsetWidth;
    el.toast.classList.add('show');
  }

  function nudgeBuy() {
    el.buyBtn.classList.remove('nudge');
    void el.buyBtn.offsetWidth;
    el.buyBtn.classList.add('nudge');
  }

  /* ------------------------------ economy ------------------------------ */
  function buyStack() {
    if (!started) return;
    econ.spent += CFG.STACK_PRICE;
    econ.stack += CFG.STACK_COINS;
    A.chaching();
    syncStack();
    statsDirty = true;
    saveSoon();
  }

  function dropCoin() {
    if (!running) return false;
    if (econ.stack <= 0) { A.buzz(); nudgeBuy(); return false; }
    econ.stack--;
    econ.played++;
    var c = makeCoin(clamp(chuteX + rnd(-1.5, 1.5), R, W - R), CFG.CHUTE_Y + rnd(-2, 2), 0, CFG.DROP_Z);
    c.vz = -1.2;
    c.vx = rnd(-0.3, 0.3);
    c.vy = rnd(0.1, 0.6);
    c.passedShelf = false;
    c.settled = false;
    airCoins.push(c);
    A.click();
    syncStack();
    statsDirty = true;
    saveSoon();
    return true;
  }

  /* ------------------------------ persistence ------------------------------ */
  var SAVE_KEY = 'coinpusher.v1', SETTINGS_KEY = 'coinpusher.settings';
  var saveTimer = null;

  function save() {
    if (settling) return;
    try {
      var pack = function (c) { return [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10, c.layer, Math.round(c.r * 100) / 100, Math.round(c.tip * 100) / 100]; };
      var data = {
        econ: econ,
        stackInFlight: airCoins.length,
        t: pusher.t,
        coins: coins.map(pack),
        shelf: shelfCoins.map(function (c) { return [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10, 0, Math.round(c.r * 100) / 100, Math.round(c.tip * 100) / 100]; })
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable: play without saving */ }
  }

  function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; save(); }, 900);
  }

  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.coins || !data.coins.length) return false;
      var k;
      for (k in econ) if (typeof data.econ[k] === 'number') econ[k] = data.econ[k];
      econ.stack += data.stackInFlight || 0;
      coins = data.coins.map(function (a) { return makeCoin(a[0], a[1], clamp(a[2] | 0, 0, CFG.MAX_LAYERS - 1), null, a[3], a[4]); });
      shelfCoins = (data.shelf || []).map(function (a) { return makeCoin(a[0], a[1], 0, CFG.SHELF_H, a[3], a[4]); });
      airCoins = [];
      if (typeof data.t === 'number') pusher.t = data.t;
      pusher.prevFront = pusher.front = CFG.P_MIN + (CFG.P_MAX - CFG.P_MIN) * (0.5 - 0.5 * Math.cos((pusher.t % CFG.PERIOD) / CFG.PERIOD * Math.PI * 2));
      pusher.dy = 0;
      return true;
    } catch (e) { return false; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (s) {
        if (typeof s.music === 'boolean') A.settings.music = s.music;
        if (typeof s.sfx === 'boolean') A.settings.sfx = s.sfx;
        if (typeof s.volume === 'number') A.settings.volume = clamp(s.volume, 0, 1);
      }
    } catch (e) { /* ignore */ }
    el.musicToggle.checked = A.settings.music;
    el.sfxToggle.checked = A.settings.sfx;
    el.volume.value = Math.round(A.settings.volume * 100);
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(A.settings)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------ input ------------------------------ */
  var rapidTimer = null;
  var keys = { left: false, right: false };

  function canvasX(clientX) {
    var rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) * (CW / rect.width);
  }
  function aimAt(clientX) {
    chuteX = clamp(worldX(canvasX(clientX), CFG.CHUTE_Y), R + 1, W - R - 1);
  }
  function startRapid() {
    stopRapid();
    rapidTimer = setInterval(function () { if (!dropCoin()) stopRapid(); }, CFG.RAPID_MS);
  }
  function stopRapid() {
    if (rapidTimer) clearInterval(rapidTimer);
    rapidTimer = null;
  }

  canvas.addEventListener('mousemove', function (e) { aimAt(e.clientX); });
  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    aimAt(e.clientX);
    dropCoin();
    startRapid();
  });
  window.addEventListener('mouseup', stopRapid);
  canvas.addEventListener('mouseleave', stopRapid);
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    aimAt(e.touches[0].clientX);
    dropCoin();
    startRapid();
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) { e.preventDefault(); aimAt(e.touches[0].clientX); }, { passive: false });
  canvas.addEventListener('touchend', stopRapid);
  canvas.addEventListener('touchcancel', stopRapid);

  window.addEventListener('keydown', function (e) {
    if (e.target && /^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName) && e.code !== 'Space') return;
    if (e.code === 'ArrowLeft') { keys.left = true; e.preventDefault(); }
    else if (e.code === 'ArrowRight') { keys.right = true; e.preventDefault(); }
    else if (e.code === 'Space') {
      e.preventDefault();
      if (!started) { if (!el.startBtn.hidden) startGame(); return; }
      if (!e.repeat) { dropCoin(); startRapid(); }
    } else if (e.code === 'KeyB' && started) buyStack();
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowLeft') keys.left = false;
    else if (e.code === 'ArrowRight') keys.right = false;
    else if (e.code === 'Space') stopRapid();
  });
  window.addEventListener('blur', function () { stopRapid(); keys.left = keys.right = false; });

  function handleKeys() {
    if (keys.left) chuteX = clamp(chuteX - 4.5, R + 1, W - R - 1);
    if (keys.right) chuteX = clamp(chuteX + 4.5, R + 1, W - R - 1);
  }

  el.buyBtn.addEventListener('click', buyStack);
  el.resetBtn.addEventListener('click', function () {
    if (!window.confirm('Reset the machine and your stack? This starts over from a fresh load of coins.')) return;
    A.click();
    clearSave();
    econ = { stack: 0, spent: 0, won: 0, lost: 0, best: 0, played: 0 };
    payouts = []; losts = []; sparks = []; floaters = [];
    combo.count = 0;
    pusher.t = CFG.PERIOD / 2;
    pusher.prevFront = pusher.front = CFG.P_MAX;
    pusher.dy = 0;
    stock(false);
  });
  el.musicToggle.addEventListener('change', function () { A.setMusic(el.musicToggle.checked); saveSettings(); });
  el.sfxToggle.addEventListener('change', function () { A.setSfx(el.sfxToggle.checked); saveSettings(); });
  el.volume.addEventListener('input', function () { A.setVolume(el.volume.value / 100); saveSettings(); });
  el.startBtn.addEventListener('click', startGame);

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  /* ------------------------------ boot ------------------------------ */
  function startGame() {
    if (started) return;
    started = true;
    A.unlock();
    A.setVolume(A.settings.volume);
    A.motorStart();
    if (A.settings.music) A.startMusic();
    A.fanfare(1);
    el.overlay.classList.add('hidden');
    running = true;
    syncStack();
    updateStats();
    if (econ.stack <= 0) setTimeout(nudgeBuy, 600);
  }

  // Fill (or restore) the machine, then let the pile settle before the pusher moves.
  function stock(tryRestore) {
    settling = true;
    running = false;
    el.overlay.classList.remove('hidden');
    el.startBtn.hidden = true;
    el.progress.style.width = '0%';
    el.overlayTitle.textContent = 'STOCKING THE MACHINE…';

    var restored = tryRestore && load();
    if (!restored) {
      coins = []; shelfCoins = []; airCoins = [];
      generatePile(Math.round(CFG.MACHINE_START_DOLLARS / CFG.COIN_VALUE));
    }
    // A fresh pile first settles with the pusher still, then gets "played" for a while
    // (with the coins it pays out thrown away) so it starts in a lived-in, trickling state.
    var settleFrames = restored ? 40 : 90;
    var playFrames = restored ? 0 : 840;
    var total = settleFrames + playFrames, done = 0;
    lastSettleEvent = frame;
    // keep going past the plan until the pile has been quiet for a while (bounded)
    var quiet = function () { return frame - lastSettleEvent > 150 || done > total + 700; };
    function chunk() {
      var n = 0;
      while (n < 24 && (done < total || !quiet())) {
        var playing = done >= settleFrames;
        // feed coins in for most of the pre-play, then let the last cycle clear the sweep zone
        if (playing && (done - settleFrames) % 5 === 0 && done < total - 300) {
          var fx = rnd(R + 4, W - R - 4), fy = rnd(16, 70);
          var fc = makeCoin(fx, fy, 0, 0);
          fc.layer = landingLayer(fx, fy);
          fc.z = fc.layer * CFG.THICK;
          coins.push(fc);
        }
        physicsStep(playing);
        done++; n++;
      }
      el.progress.style.width = Math.min(100, Math.round(100 * done / total)) + '%';
      if (done < total || !quiet()) { if (done % 96 < 24) render(performance.now()); requestAnimationFrame(chunk); return; }
      settling = false;
      for (var i = 0; i < coins.length; i++) coins[i].settled = true;
      render(performance.now());
      syncStack();
      updateStats();
      if (started) {
        el.overlay.classList.add('hidden');
        running = true;
      } else {
        el.overlayTitle.textContent = 'READY';
        el.overlayHint.textContent = 'Sound on. Headphones recommended. The machine is loaded with ' + money(machineCoinCount() * CFG.COIN_VALUE).replace('.00', '') + ' in quarters; buy a $10 stack to play.';
        el.startBtn.hidden = false;
        el.startBtn.focus();
      }
      save();
    }
    requestAnimationFrame(chunk);
  }

  var last = performance.now(), acc = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (settling) return;
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    var steps = 0;
    while (acc >= 1 / 60 && steps < 4) {
      if (running) { handleKeys(); physicsStep(true); }
      acc -= 1 / 60;
      steps++;
    }
    render(now);
    if (statsDirty) { updateStats(); statsDirty = false; }
  }

  loadSettings();
  stock(true);
  requestAnimationFrame(loop);

  // a few hooks for poking at the machine from the console
  window.CoinPusher = {
    cfg: CFG, econ: function () { return econ; }, coins: function () { return coins; },
    drop: dropCoin, buy: buyStack, aim: function (x) { chuteX = clamp(x, R + 1, W - R - 1); },
    count: machineCoinCount, step: physicsStep, pusher: pusher, settling: function () { return settling; },
    start: startGame, render: render, restock: function () { stock(false); }, _state: function () { return { shelf: shelfCoins, air: airCoins, payouts: payouts, losts: losts, layers: layers }; }
  };
})();
