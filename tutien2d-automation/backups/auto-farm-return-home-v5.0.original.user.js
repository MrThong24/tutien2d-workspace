
 // ==UserScript==
 // @name         TuTien2D - Auto Farm Return Home
 // @namespace    https://tutien2d.com/
 // @version      5.0
 // @description  Danh quai, quay ve diem farm, toa thien
 // @match        https://tutien2d.com/*
 // @run-at       document-start
 // @grant        none
 // @sandbox      raw
 // ==/UserScript==

(function () {
  "use strict";

  const CFG = {
    home: {
      x: 273.10881866212804,
      y: 253.43632238000578
    },

    enemyIds: ["dlt_1", "dlt_2"],


checkMs: 200,
cooldownMs: 700,
clearDelayMs: 500,
homeTolerance: 18,
routeRetryMs: 1200,
collisionRadius: 8,
collisionHeight: 8

  };

  let gameRef = window.PNTT || null;
  let phase = "INIT";
  let lastAction = 0;
  let clearSince = null;
  let lastRoute = 0;
  let lastMessage = "";

  // GIU THAM CHIEU GAME
  try {
    Object.defineProperty(window, "PNTT", {
      configurable: true,
      enumerable: true,
      get: () => gameRef,
      set: value => {
        gameRef = value;
      }
    });
  } catch (err) {
    console.warn("[Farm] Hook PNTT:", err);
  }

  Object.defineProperty(window, "gameDebug", {
    configurable: true,
    get: () => gameRef
  });

  function log(message) {
    if (lastMessage === message) return;
    lastMessage = message;
    console.log("[Auto Farm]", message);
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function press(key) {
    const upper = key.toUpperCase();
    const code = "Key" + upper;
    const keyCode = upper.charCodeAt(0);

    ["keydown", "keyup"].forEach(type => {
      document.dispatchEvent(
        new KeyboardEvent(type, {
          key: key.toLowerCase(),
          code,
          keyCode,
          which: keyCode,
          bubbles: true
        })
      );
    });

    lastAction = Date.now();
  }

  function pressed(id) {
    const btn = document.getElementById(id);
    if (!btn) return null;
    return btn.getAttribute("aria-pressed") === "true";
  }

  function getStatus() {
    const world = gameRef?.SceneWorld;
    const player = world?.player;
    const enemies = world?.enemies;

    if (!player || !Array.isArray(enemies)) {
      return { ready: false };
    }

    const targets = enemies.filter(e =>
      CFG.enemyIds.includes(e.id)
    );

    const alive = targets.filter(e =>
      e.dead === false && e.hp > 0
    );

    return {
      ready: true,
      world,
      player,
      targets,
      alive,
      distanceHome: distance(player, CFG.home),
      toa: pressed("btn-meditate-touch"),
      auto: pressed("btn-auto-touch")
    };
  }

  // TIM BAN DO CO HO TRO PATHFINDER
  function getNavigationMap(world) {
    const candidates = [
      world.tilemap,
      world.tileMap,
      world.map,
      world.map?.tilemap,
      world.map?.tileMap
    ];

    return candidates.find(m =>
      m &&
      typeof m.isBlockedTile === "function" &&
      typeof m.nearestWalkable === "function" &&
      typeof m.lineClear === "function"
    ) || null;
  }

  // TIM DUONG VE VI TRI FARM
  function returnHome(s) {
    const pf = gameRef?.Pathfinder;
    const player = s.player;
    const map = getNavigationMap(s.world);

    if (!pf?.route || !map ||
        typeof player.setPath !== "function") {
      log("Chưa xác định được bản đồ dẫn đường");
      return false;
    }

    try {
      const path = pf.route(
        map,
        player.x,
        player.y,
        CFG.home.x,
        CFG.home.y,
        CFG.collisionRadius,
        CFG.collisionHeight
      );

      if (!Array.isArray(path) || path.length === 0) {
        log("Không tìm được đường về điểm farm");
        return false;
      }

      player.setPath([]);
player.setPath(path);

      log("Đang quay về điểm farm");
      return true;
    } catch (err) {
      console.warn("[Farm] Lỗi tìm đường:", err);
      return false;
    }
  }

  function tick() {
    const s = getStatus();

    if (!s.ready) return;

    // Chi hoat dong khi da tim thay du 2 quai
    if (s.targets.length !== CFG.enemyIds.length) {
      phase = "WAIT_TARGETS";
      log("Đang chờ dữ liệu 2 quái");
      return;
    }

    if (s.toa === null || s.auto === null) return;

    const now = Date.now();

    if (now - lastAction < CFG.cooldownMs) return;

    // CO QUAI SONG
    if (s.alive.length > 0) {
      clearSince = null;
      phase = "COMBAT";

      if (s.toa) {
        press("q");
        log("Quái hồi sinh - Đứng dậy");
        return;
      }

      if (!s.auto) {
        s.player.setPath?.([]);
        press("t");
        log("Bật Auto đánh quái");
        return;
      }

      log("Đang đánh " + s.alive.length + " quái");
      return;
    }

    // KHONG CON QUAI SONG
    if (clearSince === null) clearSince = now;

    if (now - clearSince < CFG.clearDelayMs) return;

    // TAT AUTO
if (s.auto) {
  // Hủy đường đi đuổi quái cũ
  s.player.setPath?.([]);

  // Tắt Auto
  press("t");

  // Xóa đường đi một lần nữa sau khi tắt Auto
  s.player.setPath?.([]);

  phase = "RETURN";
  lastRoute = 0;

  log("Hết quái - Hủy đuổi quái, quay về ngay");
  return;
}

    // CHUA VE TOI NHA
    if (s.distanceHome > CFG.homeTolerance) {
      phase = "RETURN";

      if (s.toa) {
        press("q");
        log("Đứng dậy để quay về");
        return;
      }

      const hasPath =
        Array.isArray(s.player.path) &&
        s.player.path.length > 0;

      if (!hasPath &&
          now - lastRoute >= CFG.routeRetryMs) {
        lastRoute = now;
        returnHome(s);
      }

      return;
    }

    // DA VE NHA
    phase = "MEDITATE";

    if (Array.isArray(s.player.path) &&
        s.player.path.length > 0) {
      s.player.setPath([]);
    }

    if (!s.toa) {
      press("q");
      log("Đã về điểm farm - Tọa thiền");
      return;
    }

    log("Đang Tọa - Chờ quái hồi sinh");
  }

  // LENH KIEM TRA
  window.getFarmStatus = () => {
    const s = getStatus();

    if (!s.ready) return { ready: false };

    return {
      phase,
      alive: s.alive.length,
      total: s.targets.length,
      distanceHome: Math.round(s.distanceHome),
      position: {
        x: s.player.x,
        y: s.player.y
      },
      navigationReady: !!getNavigationMap(s.world),
      toa: s.toa,
      auto: s.auto
    };
  };

  window.farmTimer = setInterval(tick, CFG.checkMs);

  window.stopFarm = () => {
    clearInterval(window.farmTimer);
    phase = "STOPPED";
    log("Đã dừng script");
  };

  console.log("Auto Farm Return Home v5.0 đã khởi tạo");
})();

