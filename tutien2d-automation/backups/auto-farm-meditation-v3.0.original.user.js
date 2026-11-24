
 // ==UserScript==
 // @name         TuTien2D - Auto Farm & Meditation
 // @namespace    https://tutien2d.com/
 // @version      3.0
 // @description  Tu dong danh quai va toa thien
 // @match        https://tutien2d.com/*
 // @run-at       document-start
 // @grant        none
 // @sandbox      raw
 // ==/UserScript==

(function () {
  "use strict";

  // ===== CAU HINH =====
  const CHECK_INTERVAL = 1000;
  const ACTION_COOLDOWN = 1500;

  let gameRef = null;
    Object.defineProperty(window, "gameDebug", {
  configurable: true,
  get() {
    return gameRef;
  }
});
  let lastAction = 0;
  let lastStatus = "";

  // ===== GIU THAM CHIEU GAME =====
  try {
    const oldDescriptor =
      Object.getOwnPropertyDescriptor(window, "PNTT");

    gameRef = window.PNTT || null;

    if (!oldDescriptor || oldDescriptor.configurable) {
      Object.defineProperty(window, "PNTT", {
        configurable: true,
        enumerable: true,

        get() {
          return gameRef;
        },

        set(value) {
          gameRef = value;
        }
      });
    }
  } catch (err) {
    console.warn("[AutoFarm] Hook loi:", err);
  }

  // ===== LAY TRANG THAI QUAI =====
  function getEnemyStatus() {
    const world = gameRef?.SceneWorld;
    const enemies = world?.enemies;

    if (!Array.isArray(enemies)) {
      return { ready: false };
    }

    const alive = enemies.filter(e =>
      e && e.dead === false && e.hp > 0
    );

    return {
      ready: true,
      total: enemies.length,
      alive: alive.length,
      dead: enemies.length - alive.length
    };
  }

  // ===== GUI PHIM =====
  function pressKey(key) {
    const code = "Key" + key.toUpperCase();
    const keyCode = key.toUpperCase().charCodeAt(0);

    for (const type of ["keydown", "keyup"]) {
      document.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code,
          keyCode,
          which: keyCode,
          bubbles: true
        })
      );
    }
  }

  // ===== DIEU KHIEN AUTO =====
  function autoFarm() {
    const status = getEnemyStatus();

    if (!status.ready || status.total === 0) return;

    const toa = document.getElementById("btn-meditate-touch");
    const auto = document.getElementById("btn-auto-touch");

    if (!toa || !auto) return;

    const isToa =
      toa.getAttribute("aria-pressed") === "true";

    const isAuto =
      auto.getAttribute("aria-pressed") === "true";

    const now = Date.now();

    if (now - lastAction < ACTION_COOLDOWN) return;

    if (status.alive === 0) {
      // HET QUAI -> TOA
      if (!isToa) {
        pressKey("q");
        lastAction = now;
        console.log("🧘 Hết quái -> Tọa thiền");
      }
    } else {
      // CO QUAI -> DUNG DAY
      if (isToa) {
        pressKey("q");
        lastAction = now;
        return;
      }

      // BAT AUTO NEU DANG TAT
      if (!isAuto) {
        pressKey("t");
        lastAction = now;
      }
    }

    const signature =
      `${status.alive}/${status.total}`;

    if (signature !== lastStatus) {
      lastStatus = signature;
    }
  }

  // ===== KHOI DONG =====
  window.getEnemyStatus = getEnemyStatus;

  window.autoFarmTimer = setInterval(
    autoFarm,
    CHECK_INTERVAL
  );

  console.log("✅ TuTien2D Auto Farm v3.0 đã bật");

})();

