// ==UserScript==
// @name         TuTien2D - Bảng test độc lập
// @namespace    local.tutien2d.smoke-test
// @version      0.2.1
// @description  Tự làm các bước được hỗ trợ qua HUD, tiểu đồ và hội thoại game
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const version = '0.2.1';
  const mainQuestGoal = 14;
  const finite = value => Number.isFinite(value) ? value : null;
  const text = value => typeof value === 'string' ? value : null;
  const flag = value => typeof value === 'boolean' ? value : null;
  const jobs = [
    { name: 'Linh Chi Dưới Chân Núi', objective: /hái nấm linh chi núi/i,
      target: 'Nấm Linh Chi Núi', offer: /linh chi|tai nấm/i, map: 'Chân Núi Tản Viên' },
    { name: 'Trúc Tâm Dẫn Dược', objective: /chặt trúc già.*trúc tâm/i,
      target: 'Trúc Già Đánh Dấu', offer: /trúc già|trúc tâm/i, map: 'Rừng Trúc' },
    { name: 'Câu Cá Làm Dược Liệu', title: 'Cá Làm Dược Liệu', objective: /câu cá ở bờ ao/i,
      offer: /cá|linh ngư/i, mode: 'fish' },
    { name: 'Đưa Người Về Làng', objective: /dẫn cháu|đưa người tới gặp thầy/i,
      offer: /cháu|thầy ông nội/i, mode: 'escort' },
    { name: 'Thu Gom Dược Mộc', objective: /chặt cổ thụ.*cành khô/i,
      offer: /cành khô|cổ thụ/i, mode: 'wood' }
  ];

  function probe(read) {
    try { return read(); }
    catch (error) { return { error: String(error?.message || error) }; }
  }

  // Keep the startup namespace after the game removes its global name.
  let retained = null;
  function remember(value) {
    if (value && typeof value === 'object') retained = value;
    return value;
  }
  const namespaceHook = probe(() => {
    let current = remember(window.PNTT);
    const descriptor = Object.getOwnPropertyDescriptor(window, 'PNTT');
    if (descriptor && !(descriptor.configurable && (descriptor.writable || (descriptor.get && descriptor.set)))) {
      return 'unavailable';
    }
    Object.defineProperty(window, 'PNTT', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => remember(descriptor?.get ? descriptor.get.call(window) : current),
      set(value) {
        if (descriptor?.set) descriptor.set.call(window, value);
        else current = value;
        remember(descriptor?.get ? descriptor.get.call(window) : current);
      }
    });
    return 'installed';
  });

  function readQuests(game) {
    const quest = game.Quest;
    if (typeof quest?.seedTaskList !== 'function') return null;
    const tasks = quest.seedTaskList().map(({ def, runsLeft, exhausted, locked }) => ({
      id: text(def.id), name: text(def.shortName || def.name), left: finite(runsLeft),
      locked: Boolean(locked), exhausted: Boolean(exhausted)
    }));
    const active = quest.seedTaskInfo?.();
    return {
      unlocked: flag(quest.canOpenSeedMenu?.()), round: finite(quest.seedQuest?.round),
      points: finite(game.Progress?.duocCong), tasks,
      active: active ? { id: text(active.id), name: text(active.shortName || active.name),
        progress: finite(quest.seedQuestProgress?.()), need: finite(active.need) } : null
    };
  }

  function readGarden(game) {
    const farm = game.Farm;
    if (typeof farm?.plot !== 'function') return null;
    const count = Math.min(20, Math.max(0, Math.floor(finite(farm.PLOT_COUNT) ?? 10)));
    return { plots: Array.from({ length: count }, (_, index) => {
      const id = `plot_${index + 1}`;
      const plot = farm.plot(id);
      const seed = text(plot?.seed);
      return { id, seed, ready: seed ? flag(farm.ready?.(id)) : null,
        wet: seed ? flag(plot.wet) : null };
    }) };
  }

  function readRuntime() {
    const candidates = { PNTT: remember(window.PNTT), retained, gameDebug: window.gameDebug };
    const sources = Object.entries(candidates).map(([name, game]) => ({
      name, present: Boolean(game), player: Boolean(game?.SceneWorld?.player),
      map: Boolean(game?.SceneWorld?.map?.data?.id)
    }));
    const source = sources.find(entry => entry.player && entry.map)?.name ?? null;
    return { game: source ? candidates[source] : null, source, sources };
  }

  function readState(game) {
    const world = game.SceneWorld;
    const player = world.player;
    const map = world.map.data;
    return {
      map: text(map.id), mapName: text(map.name), x: finite(player.x), y: finite(player.y),
      hp: finite(player.hp), hpMax: finite(player.hpMax), stage: finite(game.Quest?.stage),
      flying: flag(player.flying), meditating: player.state === 'sit',
      meditationBonus: flag(player.meditateBonusExp), autoCombat: flag(world.autoOn),
      quest: probe(() => readQuests(game)), garden: probe(() => readGarden(game))
    };
  }

  function visible(node) {
    if (!node || !node.getClientRects().length) return false;
    const style = getComputedStyle(node);
    return style.visibility === 'visible' && Number(style.opacity) > 0;
  }

  function readDialog() {
    const dialog = document.getElementById('dialog');
    if (!visible(dialog) || dialog.classList.contains('hidden')) return null;
    const title = dialog.querySelector('#dialog-title')?.textContent.trim() || '';
    const detail = dialog.querySelector('#dialog-text')?.textContent.trim().slice(0, 800) || '';
    const choices = Array.from(dialog.querySelectorAll('#dialog-choices button, #dialog-action'))
      .filter(visible).slice(0, 20).map(node => ({
        label: (node.querySelector(':scope > span')?.textContent || node.textContent).trim().slice(0, 160),
        note: node.querySelector('.c-note')?.textContent.trim().slice(0, 200) || '',
        disabled: node.disabled,
        node
      }));
    return { title, detail, choices };
  }

  function objectives() {
    return [...document.querySelectorAll('#quest-objectives li')].map(node => ({
      label: node.getAttribute('aria-label') || node.textContent.trim(), node
    }));
  }

  function readHud() {
    const element = id => document.getElementById(id);
    const hud = element('hud');
    const map = element('hud-map');
    if (!hud || !map || hud.hidden || hud.classList.contains('hidden') ||
        !(visible(map) || visible(element('hud-left')) || visible(element('hud-pos'))) ||
        visible(element('auth-gate')) || visible(element('loading'))) return null;

    const mapName = map.textContent.trim();
    const position = element('hud-pos')?.textContent.match(/\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/);
    if (!mapName || !position) return null;
    const health = element('value-hp')?.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    const tracker = element('quest-tracker');
    const stageLabel = tracker && !tracker.classList.contains('hidden') ?
      element('quest-stage-full')?.textContent || element('quest-stage')?.textContent : '';
    const stage = stageLabel?.match(/giai đoạn\s*(\d+)/i);
    const activeJob = /^việc dược công/i.test(stageLabel || '') && jobs.find(job =>
      stageLabel.trim().toLocaleLowerCase('vi').endsWith((job.title || job.name).toLocaleLowerCase('vi')));
    const rows = objectives();
    const progress = activeJob && rows.find(row => activeJob.objective.test(row.label))?.label.match(/(\d+)\s*\/\s*(\d+)/);
    const questWork = progress ? { name: activeJob.name, current: Number(progress[1]), need: Number(progress[2]) } :
      activeJob?.mode === 'escort' ? { name: activeJob.name, current: null, need: null } : null;
    const active = id => element(id)?.classList.contains('active') ?? null;
    const dialog = readDialog();
    const related = dialog && /dược công|đại phu|luống|vườn cá nhân|đan lô/i.test(
      `${dialog.title} ${dialog.choices.map(choice => choice.label).join(' ')}`);
    const details = related ? { title: dialog.title, detail: dialog.detail,
      choices: dialog.choices.map(({ label, note, disabled }) => ({ label, note, disabled })) } : null;
    const inGarden = /^vườn cá nhân$/i.test(mapName);
    return {
      map: inGarden ? 'vuon_ca_nhan' : mapName, mapName, x: Number(position[1]), y: Number(position[2]),
      hp: health ? Number(health[1]) : null, hpMax: health ? Number(health[2]) : null,
      stage: stage ? Number(stage[1]) : null, flying: active('btn-fly'),
      meditating: active('btn-meditate-touch'), meditationBonus: null,
      autoCombat: active('btn-auto-touch') ?? active('btn-auto'), quest: null, garden: null,
      questTitle: stageLabel?.trim() || null,
      questWork,
      linhChi: questWork?.name === jobs[0].name ? { current: questWork.current, need: questWork.need } : null,
      interact: element('btn-attack')?.getAttribute('aria-label')?.trim() || null,
      enemy: visible(element('hud-target')) ? element('target-name')?.textContent.trim() : null,
      fishing: ['btn-fishing-stop', 'btn-fishing-stop-touch'].some(id => element(id)?.getAttribute('aria-pressed') === 'true'),
      experienceFull: element('row-xp')?.classList.contains('full') ?? null,
      caption: visible(element('ritual-caption')) ? element('ritual-caption').textContent.trim().slice(0, 250) : '',
      dialogTitle: details?.title ?? null, dialog: details
    };
  }

  // Coordinates are tile centers read from the current public map definitions.
  const routeMaps = [
    { name: 'Chân Núi Tản Viên', width: 40, height: 30, next: [[7, 29], [8, 29]] },
    { name: 'Rừng Trúc', width: 40, height: 30, next: [[12, 29], [13, 29]], back: [[7, 0], [8, 0]] },
    { name: 'Thảo Dược Cốc', width: 40, height: 30, next: [[11, 7], [11, 6]], back: [[12, 0], [13, 0]] },
    { name: 'Vườn Cá Nhân', width: 18, height: 13, back: [[8, 12], [9, 12]] }
  ];
  const physician = [14, 8];
  const physicianApproach = [[14, 9], [13, 8]];
  const gardenMap = routeMaps[3];
  const gardenPlots = [4, 6].flatMap(y => [3, 4, 5, 6, 7].map(x => [x, y]));
  const gardenHunt = [[9, 2], [10, 5]];
  const fallenBranches = [[33, 24], [32, 24], [33, 23]];
  const introStages = new Map([
    [0, { target: /^(bia đá cổ tự|thầy ông nội)$/i, choices: /^nhận việc$/i }],
    [1, { target: /^(bia đá cổ tự|thầy ông nội)$/i, choices: /^(nhận việc|nhận việc mở đầu)$/i }],
    [2, { target: /^(tẩy uế thảo|khóm tẩy uế thảo)$/i }],
    [3, { target: /^đan lô cũ$/i, recipe: 'Tẩy Tuỷ Thang' }],
    [4, { target: /^(đài đá bên suối|đan lô cũ)$/i, choices: /^(uống thang & đả tọa|phạt mao lần nữa)$/i, recipe: 'Tẩy Tuỷ Thang' }],
    [5, { target: /^huấn sư huynh$/i, choices: /^nhận việc$/i }],
    [6, { target: /^(manh mối|huấn sư huynh)$/i, choices: /^báo công$/i }],
    [7, { target: /^đại phu$/i, choices: /^nhận hạt giống$/i }],
    [9, { target: /^đan lô (cũ|linh điền)$/i, recipe: 'Linh Dược' }],
    [10, { target: /^đài đá (bên suối|trong linh điền)$/i, choices: /^(uống dược & vận công|phá quan ngay|bắt đầu phá quan)$/i }],
    [11, { target: /^dược linh thú$/i }],
    [12, { target: /^đan lô (cũ|linh điền)$/i, recipe: 'Tụ Khí Đan' }],
    [13, { target: /^(đại phu|đài đá trong linh điền)$/i, choices: /^(báo công & bái tạ|phá quan ngay|bắt đầu phá quan)$/i }]
  ]);

  function targetName(hud) {
    return hud.interact?.match(/^tương tác với\s+(.+)$/i)?.[1] || '';
  }

  function tapMinimap(map, [x, y]) {
    const canvas = document.getElementById('minimap');
    if (!visible(canvas)) throw Error('Hãy bật tiểu đồ của game để thử di chuyển.');
    const zoomOut = canvas.parentElement.querySelector('.td-zout');
    if (zoomOut && !zoomOut.disabled) throw Error('Thu nhỏ tiểu đồ bằng nút − đến khi nút mờ, rồi chạy lại.');

    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(canvas.width / map.width, canvas.height / map.height);
    if (!scale || scale * Math.min(rect.width / canvas.width, rect.height / canvas.height) < 1.5) {
      throw Error('Tiểu đồ quá nhỏ để chọn chính xác ô đích.');
    }
    const offsetX = (canvas.width - map.width * scale) / 2;
    const offsetY = (canvas.height - map.height * scale) / 2;
    const options = { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1,
      clientX: rect.left + ((x + 0.5) * scale + offsetX) * rect.width / canvas.width,
      clientY: rect.top + ((y + 0.5) * scale + offsetY) * rect.height / canvas.height };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...options, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', options));
  }

  function press(key, code, hold = false) {
    const send = type => window.dispatchEvent(new KeyboardEvent(type, { key, code, cancelable: true }));
    send('keydown');
    if (hold) window.setTimeout(() => send('keyup'), 65);
    else send('keyup');
  }

  function mount() {
    const host = document.createElement('div');
    host.id = 'tutien2d-smoke-test';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { position: fixed; inset: 12px auto auto 12px; z-index: 2147483647; color-scheme: dark; pointer-events: auto; }
        section { box-sizing: border-box; width: 310px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px);
          overflow: auto; color: #f0faf2; background: #172820; border: 1px solid #688c76; border-radius: 10px;
          padding: 10px 12px; font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 4px 18px #0007; }
        summary { cursor: pointer; font-weight: 700; }
        p { margin: 6px 0; overflow-wrap: anywhere; }
        ul { margin: 4px 0; padding-inline-start: 20px; }
        button { margin: 4px 5px 0 0; padding: 5px 9px; border: 1px solid #88a794; border-radius: 5px;
          background: #315542; color: inherit; cursor: pointer; font: inherit; }
        button:disabled { opacity: .55; cursor: default; }
        .modes { display: grid; gap: 5px; margin-block: 8px; }
        .modes button { margin: 0; text-align: left; }
        textarea { box-sizing: border-box; width: 100%; height: 120px; font: 12px monospace; }
        #result { color: #c7ebcd; }
      </style>
      <section aria-label="Kiểm thử TuTien2D">
        <details open>
          <summary>TuTien2D · Bảng test ${version}</summary>
          <p id="status" role="status"></p>
          <p id="player"></p>
          <p id="garden"></p>
          <details open>
            <summary>Chế độ tự động</summary>
            <div class="modes">
              <button id="total-test" type="button">Auto tổng</button>
              <button id="intro-test" type="button">Auto nhiệm vụ chính đến Giai đoạn 14</button>
              <button id="duoc-cong-test" type="button">Auto Dược Công</button>
              <button id="farm-test" type="button">Vào vườn</button>
            </div>
            <button id="stop-test" type="button" disabled>Dừng</button>
            <p id="test-status" aria-live="polite"></p>
          </details>
          <details>
            <summary>Chẩn đoán</summary>
            <details><summary id="quests">Dược Công</summary><ul id="tasks"></ul></details>
            <button id="auto-test" type="button">Thử một lượt Linh Chi</button>
            <button id="flight-test" type="button">Bay / hạ cánh</button>
            <button id="physician-test" type="button">Tới Đại Phu</button>
            <button id="quest-test" type="button">Đọc Sổ Dược Công</button>
            <button id="garden-test" type="button">Chỉ tới cổng vườn</button>
            <label for="recipe">Đan luyện trong vườn</label>
            <select id="recipe">
              <option value="">Bỏ qua luyện đan</option>
              <option>Linh Dược</option><option>Tụ Khí Đan</option>
              <option>Luyện Khí Đan</option><option>Phá Cảnh Đan</option>
            </select>
            <button id="record" type="button">Bắt đầu ghi test</button>
            <button id="export" type="button">Tải log JSON</button>
            <p id="result" aria-live="polite">Bấm ghi test rồi thử di chuyển vài bước trong game.</p>
            <details id="log" hidden>
              <summary>Xem hoặc sao chép log JSON</summary>
              <textarea id="log-text" aria-label="Nội dung log JSON" readonly spellcheck="false"></textarea>
            </details>
          </details>
        </details>
      </section>`;
    document.documentElement.append(host);

    const $ = id => root.getElementById(id);
    const mountedAt = Date.now();
    let current = null;
    let session = null;
    let previous = null;
    let movementStart = null;
    let job = null;
    let taskSignature = '';
    let connection;
    let connectionSignature = '';
    let test = null;
    const testRecords = [];
    const testButtons = ['total-test', 'intro-test', 'duoc-cong-test', 'farm-test', 'auto-test', 'flight-test', 'physician-test', 'quest-test', 'garden-test'];

    function reportTest(kind, status, message, data = null) {
      testRecords.push({ at: new Date().toISOString(), kind, status, message, data });
      if (testRecords.length > 80) testRecords.shift();
      $('test-status').textContent = message;
    }

    function finishTest(status, message, data = null) {
      if (!test) return;
      if (test.ownCombat && readHud()?.autoCombat && !document.hidden) press('t', 'KeyT');
      reportTest(test.kind, status, message, data);
      test = null;
      for (const id of testButtons) $(id).disabled = false;
      $('stop-test').disabled = true;
    }

    function cancelTest(message, manualMovement = false) {
      if ((test?.leg?.attempts || test?.walkingToHerb || test?.localMove || test?.ownFishing || test?.phase === 'native-running') &&
          !manualMovement && !document.hidden && !readDialog()) {
        // Direction input takes control back from the game's click-to-walk path.
        press('ArrowDown', 'ArrowDown', true);
      }
      finishTest('stopped', message);
    }

    function startTest(kind, plan = kind) {
      if (test) return;
      const hud = readHud();
      if (!hud) return reportTest(kind, 'blocked', 'Vào nhân vật và chờ HUD sẵn sàng để chạy thử.');
      if (hud.hp === 0) return reportTest(kind, 'blocked', 'Nhân vật đang gục.');
      test = { kind, plan, began: Date.now(), leg: null, actedAt: 0, menuSteps: 0,
        recipe: $('recipe').value, completed: 0 };
      for (const id of testButtons) $(id).disabled = true;
      $('stop-test').disabled = false;
      try {
        if (['auto', 'intro', 'farm'].includes(kind)) {
          setAutoPhase('prepare', plan === 'auto' ? 'Đang chuẩn bị làm một lượt Linh Chi.' : 'Đang đọc mục tiêu từ HUD.');
        } else if (kind === 'flight') {
          if (hud.flying === null || readDialog()) return finishTest('blocked', 'Đóng hội thoại và chờ trạng thái phi hành hiện trên HUD.');
          test.flying = !hud.flying;
          press('f', 'KeyF');
          reportTest(kind, 'sent', test.flying ? 'Đã gửi phím F, đang chờ xác nhận cất cánh.' : 'Đã gửi phím F, đang chờ xác nhận hạ cánh.');
        } else if (kind === 'quest') {
          reportTest(kind, 'waiting', 'Đang kiểm tra hội thoại Đại Phu.');
        } else {
          if (hud.autoCombat || hud.meditating || hud.flying || readDialog()) {
            return finishTest('blocked', 'Hãy tắt Auto đánh, đứng dậy, hạ cánh và đóng hội thoại trước khi thử đường.');
          }
          test.destination = kind === 'garden' ? 3 : 2;
          reportTest(kind, 'waiting', `Đang kiểm tra đường tới ${kind === 'garden' ? 'Vườn Cá Nhân' : 'Đại Phu'}.`);
        }
        tickTest();
      } catch (error) {
        finishTest('blocked', error.message);
      }
    }

    function tickQuest(hud, now) {
      const dialog = readDialog();
      if (!dialog || !/^(đại phu|sổ dược công)$/i.test(dialog.title)) {
        if (now - test.began >= 2500) finishTest('blocked', 'Hãy đứng cạnh Đại Phu, mở hội thoại rồi bấm Đọc Sổ Dược Công.');
        return;
      }
      const taskList = dialog.choices.some(choice => /linh chi|câu cá|trúc tâm|dược mộc|đưa.*về|chiến bảng|đại hội|vận tiêu/i.test(choice.label));
      if (taskList) return finishTest('passed', 'Đã đọc danh sách việc Dược Công trên giao diện.', hud.dialog);
      const menu = dialog.choices.find(choice => /^(nhận việc dược công|sổ dược công(?:\s*·.*)?)$/i.test(choice.label));
      if (menu?.disabled) return finishTest('blocked', menu.note || 'Game đang khóa danh sách việc Dược Công.', hud.dialog);
      if (!menu || now - (test.actedAt || test.began) < 650) return;
      if (test.lastMenu === menu.node || test.menuSteps >= 2) return;
      test.actedAt = now;
      test.lastMenu = menu.node;
      test.menuSteps++;
      menu.node.click();
      reportTest('quest', 'sent', `Đã bấm ${menu.label}.`, hud.dialog);
    }

    function tickRoute(hud, now, arrive) {
      const index = routeMaps.findIndex(map => hud.mapName === map.name);
      if (index < 0) return finishTest('blocked', `Chưa có tuyến thử từ ${hud.mapName}.`, hud);
      const map = routeMaps[index];
      if (test.leg && index !== test.leg.index && index !== test.leg.next) {
        return finishTest('blocked', `Game chuyển sang ${map.name} ngoài tuyến thử.`, hud);
      }
      if (index === test.destination) {
        if (index === 3) return arrive('HUD xác nhận đã vào Vườn Cá Nhân.', hud);
        if (Math.hypot(hud.x - physician[0], hud.y - physician[1]) <= 1) {
          return arrive('Đã tới cạnh vị trí Đại Phu.', hud);
        }
      }
      if (hud.autoCombat || hud.meditating || hud.flying || (hud.hpMax > 0 && hud.hp < hud.hpMax * 0.35) || readDialog()) {
        return cancelTest('Đã dừng thử đường vì nhân vật đang bận hoặc Khí Huyết thấp.');
      }

      const next = index === test.destination ? index : index + Math.sign(test.destination - index);
      const tiles = next === index ? physicianApproach : next > index ? map.next : map.back;
      if (!test.leg || test.leg.index !== index) {
        test.leg = { index, next, attempts: 0, progressedAt: now, x: hud.x, y: hud.y };
      }
      const leg = test.leg;
      if (leg.x !== hud.x || leg.y !== hud.y) {
        leg.x = hud.x;
        leg.y = hud.y;
        leg.progressedAt = now;
      }
      if (leg.attempts && now - leg.progressedAt < 6000) return;
      if (leg.attempts >= tiles.length) return cancelTest(`Không thấy tiến độ trên HUD ở ${map.name}.`);

      const tile = tiles[leg.attempts];
      tapMinimap(map, tile);
      leg.attempts++;
      leg.progressedAt = now;
      reportTest(test.kind, 'sent', `${map.name} · chọn ô (${tile[0]}, ${tile[1]}) trên tiểu đồ.`, hud);
    }

    function setAutoPhase(phase, message, destination = null) {
      Object.assign(test, { phase, destination, phaseAt: Date.now(), actedAt: 0, leg: null,
        lastMenu: null, walkingToHerb: false, localMove: null });
      reportTest(test.kind, 'progress', message);
    }

    function selectAutoChoice(choice, now) {
      if (!choice || choice.disabled || test.lastMenu === choice.node || now - (test.actedAt || test.phaseAt) < 700) return false;
      test.actedAt = now;
      test.lastMenu = choice.node;
      choice.node.click();
      reportTest(test.kind, 'sent', `Đã bấm ${choice.label}.`);
      return true;
    }

    function readPoints(dialog) {
      const notes = dialog.choices.find(choice => /^mở quầy đổi hạt$/i.test(choice.label))?.note || '';
      const value = notes.match(/(?:Đang có|Đủ công đổi hạt\s*·)\s*(\d+)\s+Dược Công/i);
      return value ? Number(value[1]) : null;
    }

    function openPhysician(hud, now) {
      if (!/^tương tác với đại phu$/i.test(hud.interact || '')) return;
      if (now - test.actedAt < 1700) return;
      test.actedAt = now;
      press('e', 'KeyE');
    }

    function finishDuocCong(dialog) {
      const pending = dialog.choices.filter(choice => !choice.disabled && /đại hội|chiến bảng|vận tiêu/i.test(choice.label))
        .map(choice => choice.label);
      const message = pending.length ? `Còn việc chưa tự làm: ${pending.join(', ')}.` : 'Đã hết lượt Dược Công có thể nhận.';
      const status = pending.length ? 'partial' : 'passed';
      const result = { completed: test.completed, nativeFinished: Boolean(test.nativeFinished), pending };
      if (test.plan === 'duoc-cong') return finishTest(status, message, result);
      reportTest(test.kind, status, message, result);
      setAutoPhase('close-ledger', 'Đang chuẩn bị vào Vườn Cá Nhân.');
    }

    function tickAutoPhysician(hud, now) {
      const dialog = readDialog();
      const turningIn = test.phase === 'turn-in';
      if (now - test.phaseAt > 22000) return finishTest('unconfirmed', 'Chưa xác nhận được bước ở Đại Phu.', hud);
      if (!turningIn && hud.questWork) {
        if (test.job && test.job.name !== hud.questWork.name) return finishTest('blocked', 'HUD đang hiện một việc khác.', hud);
        test.job = jobs.find(job => job.name === hud.questWork.name);
        return setAutoPhase('gather', `HUD xác nhận đang giữ việc ${test.job.name}.`);
      }
      if (!dialog) return openPhysician(hud, now);
      if (test.phase === 'native-confirm') {
        if (selectAutoChoice(dialog.choices.find(choice => /^bắt đầu tự làm$/i.test(choice.label)), now)) {
          setAutoPhase('native-running', 'Đã gửi lệnh chạy Auto Dược Công của game.');
        }
        return;
      }
      if (!/^(đại phu|sổ dược công)$/i.test(dialog.title)) {
        return finishTest('blocked', 'Game đang mở hội thoại khác. Luồng Linh Chi đã dừng.', hud);
      }

      const find = pattern => dialog.choices.find(choice => pattern.test(choice.label));
      const points = readPoints(dialog);
      if (turningIn && test.turnInSent && !hud.questWork && find(/^nhận việc dược công$/i)) {
        const delta = Number.isFinite(test.pointsBefore) && Number.isFinite(points) ? points - test.pointsBefore : null;
        if (delta !== null && delta <= 0) return;
        reportTest(test.kind, 'passed', delta === null ? `Đã giao ${test.job.name}; game đã trở về Sổ Dược Công.` :
          `Đã giao ${test.job.name} · +${delta} Dược Công.`, { pointsBefore: test.pointsBefore, pointsAfter: points });
        test.completed++;
        if (test.plan !== 'auto') {
          test.job = null;
          test.turnInSent = test.acceptSent = false;
          test.pointsBefore = points ?? undefined;
          test.herbs = -1;
          test.nextWalkAt = 0;
          test.shore = test.fishStartAt = test.fishStopAt = 0;
          test.fishProgress = test.fishProgressAt = null;
          test.woodProgress = test.choppedAt = null;
          setAutoPhase('accept', 'Đang tìm lượt Dược Công tiếp theo.');
        } else setAutoPhase('close-ledger', 'Đang chuẩn bị vào Vườn Cá Nhân.');
        return;
      }
      if (turningIn) {
        if (!test.turnInSent && hud.questWork?.name === test.job.name && hud.questWork.current >= hud.questWork.need) {
          test.turnInSent = selectAutoChoice(find(test.job.mode === 'fish' ? /^giao ba cá$/i : /^giao nguyên liệu$/i), now);
        }
      } else {
        if (points !== null && test.pointsBefore === undefined) test.pointsBefore = points;
        const native = find(/^tự đi làm việc dược công$/i);
        if (test.plan !== 'auto' && !test.nativeFinished && selectAutoChoice(native, now)) {
          setAutoPhase('native-confirm', 'Đang xác nhận Auto Dược Công sẵn có trong game.');
          return;
        }
        const supported = test.plan === 'auto' ? jobs.slice(0, 1) : jobs;
        const displayed = supported.map(job => ({ job, choice: dialog.choices.find(row => row.label === job.name) }));
        const selected = displayed.find(row => row.choice && !row.choice.disabled);
        if (selected && selectAutoChoice(selected.choice, now)) { test.job = selected.job; return; }
        if (test.job && !test.acceptSent && test.job.offer.test(dialog.detail)) {
          if (selectAutoChoice(find(/^nhận việc này$/i), now)) { test.acceptSent = true; return; }
        }
        if (test.acceptSent) return;
        const list = find(/^nhận việc dược công$/i);
        if (selectAutoChoice(list, now)) return;
        const hasTasks = dialog.choices.some(choice => /linh chi|câu cá|trúc tâm|dược mộc|đưa.*về|chiến bảng|đại hội|vận tiêu/i.test(choice.label) &&
          !/^tự đi làm việc dược công$/i.test(choice.label));
        const exhausted = list?.disabled || (hasTasks && !selected);
        if (exhausted) {
          if (test.plan !== 'auto') return finishDuocCong(dialog);
          return finishTest('blocked', 'Linh Chi hiện hết lượt hoặc bị khóa.', hud);
        }
      }
      selectAutoChoice(find(/^sổ dược công(?:\s*·.*)?$/i), now);
    }

    function tickAutoGather(hud, now) {
      const progress = hud.questWork?.name === test.job?.name ? hud.questWork : null;
      if (!progress) {
        if (now - test.phaseAt > 8000) cancelTest('HUD chưa xác nhận nhiệm vụ đang hoạt động.');
        return;
      }
      if (test.job.mode === 'escort') return tickEscort(hud, now);
      if (test.job.mode === 'fish') return tickFishing(hud, progress, now);
      if (progress.current >= progress.need) {
        setAutoPhase('return', `Đủ nguyên liệu ${progress.current}/${progress.need}. Đang về Đại Phu.`, 2);
        return;
      }
      if (test.job.mode === 'wood') return tickWood(hud, progress, now);
      if (test.herbs !== progress.current) {
        test.herbs = progress.current;
        test.harvestAttempts = 0;
        test.walkStarted = 0;
        test.walkingToHerb = false;
        reportTest(test.kind, 'progress', `${test.job.name} · ${progress.current}/${progress.need}.`, hud);
      }
      if (readDialog()) return cancelTest('Game mở hội thoại trong lúc thu thập.');
      if (hud.map === test.job.map && targetName(hud) === test.job.target) {
        if (now - test.actedAt < 3000) return;
        if (test.harvestAttempts >= 4) return cancelTest('Game chưa ghi nhận thu thập sau các lần thử.');
        test.harvestAttempts++;
        test.actedAt = now;
        press('e', 'KeyE');
        return;
      }
      if (test.walkStarted && now - test.walkStarted >= 90000) return cancelTest(`Chưa tới được ${test.job.target}.`);
      if (test.nextWalkAt && now < test.nextWalkAt) return;
      const objective = objectives().find(row => test.job.objective.test(row.label));
      if (objective) {
        test.walkingToHerb = true;
        test.walkStarted ||= now;
        test.nextWalkAt = now + 18000;
        objective.node.click();
        reportTest(test.kind, 'sent', `Đã chọn mục tiêu ${test.job.target} để game tự đi đường.`);
      }
    }

    function tickEscort(hud, now) {
      const dialog = readDialog();
      if (dialog) {
        if (!/^thầy ông nội$/i.test(dialog.title)) return cancelTest('Game mở hội thoại khác trong lúc hộ tống.');
        if (selectAutoChoice(dialog.choices.find(choice => /^bẩm thầy ông nội$/i.test(choice.label)), now)) {
          test.turnInSent = true;
          setAutoPhase('escort-confirm', 'Đã bẩm Thầy Ông Nội, chờ HUD xác nhận hộ tống.');
        }
        return;
      }
      if (hud.map === routeMaps[0].name && /^thầy ông nội$/i.test(targetName(hud))) {
        if (now - test.actedAt >= 2200) { test.actedAt = now; press('e', 'KeyE'); }
        return;
      }
      if (test.nextWalkAt && now < test.nextWalkAt) return;
      const objective = objectives().find(row => test.job.objective.test(row.label));
      if (objective) {
        test.nextWalkAt = now + 22000;
        test.walkingToHerb = true;
        objective.node.click();
        reportTest(test.kind, 'sent', 'Đang dùng đường hộ tống của game tới Thầy Ông Nội.');
      }
    }

    function tickFishing(hud, progress, now) {
      if (test.fishProgress !== progress.current) {
        test.fishProgress = progress.current;
        test.fishProgressAt = now;
      }
      if (now - test.fishProgressAt > 180000) return cancelTest('Không thấy tăng số cá trong ba phút.');
      if (progress.current >= progress.need) {
        if (hud.fishing) {
          if (!test.fishStopAt) { test.fishStopAt = now; press('ArrowDown', 'ArrowDown', true); }
          else if (now - test.fishStopAt > 3500) cancelTest('Chưa xác nhận game đã dừng câu.');
          return;
        }
        test.ownFishing = false;
        return setAutoPhase('return', 'Đã đủ cá, đang về Đại Phu.', 2);
      }
      if (hud.map !== routeMaps[2].name) return setAutoPhase('go-fishing', 'Đang tới bờ hồ ở Thảo Dược Cốc.', 2);
      if (hud.fishing) return;
      const dialog = readDialog();
      if (dialog) {
        const auto = dialog.choices.find(choice => /^tự động câu$/i.test(choice.label));
        if (!auto) return cancelTest('Game mở hội thoại khác trong lúc tìm bờ câu cá.');
        if (selectAutoChoice(auto, now)) { test.ownFishing = true; test.fishStartAt = now; }
        return;
      }
      if (test.fishStartAt && now - test.fishStartAt < 2500) return;
      const shores = [[18, 15], [32, 12]];
      const index = test.shore ?? 0;
      if (!shores[index]) return cancelTest('Chưa thấy điểm có thể câu ở hai bờ nước.');
      const arrived = walkToTarget(hud, routeMaps[2], shores[index], /^(hồ bích thu[ỷy]|suối dẫn thu[ỷy])$/i, now);
      if (arrived === null) { test.shore = index + 1; test.localMove = null; }
      if (arrived && now - test.actedAt >= 2400) { test.actedAt = now; press('e', 'KeyE'); }
    }

    function tickWood(hud, progress, now) {
      if (hud.map !== routeMaps[2].name) return setAutoPhase('go-wood', 'Đang tới Cổ Thụ Linh Mộc tại Thảo Dược Cốc.', 2);
      if (readDialog()) return cancelTest('Game mở hội thoại trong lúc thu gom Dược Mộc.');
      if (test.woodProgress !== progress.current) {
        test.woodProgress = progress.current;
        test.woodAttempts = 0;
        test.choppedAt = null;
        test.localMove = null;
        reportTest(test.kind, 'progress', `Dược Mộc · ${progress.current}/${progress.need}.`, hud);
      }
      if (!test.choppedAt) {
        if (test.woodAttempts >= 3) return cancelTest('Không thấy HUD tăng số Cành Khô sau ba lần quét quanh gốc cây.');
        const arrived = walkToTarget(hud, routeMaps[2], [33, 25], /^cổ thụ linh mộc$/i, now);
        if (arrived === null) return cancelTest('Chưa tới được Cổ Thụ Linh Mộc.');
        if (arrived) {
          press('e', 'KeyE');
          test.choppedAt = now;
          test.branchTile = 0;
          test.woodAttempts++;
          reportTest(test.kind, 'sent', 'Đã tương tác với cổ thụ, đang chờ cành rơi.');
        }
        return;
      }
      if (now - test.choppedAt < 3200) return;
      const tile = fallenBranches[test.branchTile];
      if (!tile) { test.choppedAt = null; return; }
      const arrived = walkLocal(hud, routeMaps[2], tile, hud.x === tile[0] && hud.y === tile[1], now);
      if (arrived !== false) { test.branchTile++; test.localMove = null; }
    }

    function brewRecipe(dialog, recipe, now) {
      if (!recipe || now - (test.actedAt || test.phaseAt) < 700) return false;
      const detail = document.querySelector('#dialog .forge-detail h3');
      if (detail?.textContent.trim() === recipe) {
        const button = [...document.querySelectorAll('#dialog .forge-detail button')]
          .find(node => visible(node) && !node.disabled && node.textContent.trim() === 'Luyện');
        if (selectAutoChoice(button && { node: button, label: `Luyện ${recipe}` }, now)) {
          test.brewSent = true;
          return true;
        }
      }
      const slot = [...document.querySelectorAll('#dialog .forge-slot')].find(node =>
        visible(node) && !node.disabled && node.getAttribute('aria-label')?.startsWith(`${recipe},`));
      if (selectAutoChoice(slot && { node: slot, label: recipe }, now)) return true;
      const other = document.querySelector('#dialog [data-muc="dan-khac"]');
      if (recipe === 'Tẩy Tuỷ Thang' && visible(other) && other.getAttribute('aria-selected') !== 'true') {
        return selectAutoChoice({ node: other, label: 'Đan khác' }, now);
      }
      return selectAutoChoice(dialog.choices.find(choice => choice.label === recipe), now);
    }

    function equipTrucKiem(now) {
      if (now - test.actedAt < 900) return;
      const bag = document.getElementById('bag');
      if (!visible(bag)) { test.actedAt = now; press('b', 'KeyB'); return; }
      const detail = bag.querySelector('#bag-detail h3');
      const equip = [...bag.querySelectorAll('#bag-detail .bag-detail-actions button')].find(node =>
        visible(node) && !node.disabled && node.textContent.trim() === 'Trang Bị');
      if (detail?.textContent.trim() === 'Trúc Kiếm' && equip) {
        selectAutoChoice({ node: equip, label: 'Trang Bị Trúc Kiếm' }, now);
        return;
      }
      const item = bag.querySelector('#bag-list [data-item="truc_kiem"]');
      if (visible(item) && detail?.textContent.trim() !== 'Trúc Kiếm') {
        selectAutoChoice({ node: item, label: 'Trúc Kiếm' }, now);
      } else if (!visible(item)) {
        const filter = bag.querySelector('[data-filter="trang-bi"]');
        if (visible(filter)) selectAutoChoice({ node: filter, label: 'Trang Bị' }, now);
      }
    }

    function driveIntroCombat(hud, rows, now) {
      const equipment = rows.find(row => /cầm trúc kiếm/i.test(row.label));
      if (equipment && !/^xong:/i.test(equipment.label)) { equipTrucKiem(now); return true; }
      if (visible(document.getElementById('bag'))) {
        if (now - test.actedAt >= 900) { test.actedAt = now; press('b', 'KeyB'); }
        return true;
      }
      const hunt = rows.find(row => /diệt.*(bọ ngựa|sơn chuột)|linh thú.*linh thúy|linh thúy.*dược linh thú/i.test(row.label));
      const hunting = hunt && !/^xong:/i.test(hunt.label) && hud.map === (hud.stage === 11 ? 'vuon_ca_nhan' : 'Rừng Trúc');
      if (hunting && !readDialog()) {
        if (!hud.autoCombat && now - test.actedAt >= 2000) {
          test.ownCombat = true;
          test.actedAt = now;
          press('t', 'KeyT');
        }
        return true;
      }
      if (test.ownCombat) {
        if (hud.autoCombat) press('t', 'KeyT');
        test.ownCombat = false;
        return true;
      }
      return false;
    }

    function tickIntro(hud, now) {
      const handoff = test.plan === 'total';
      if (test.ownCombat && test.introStage !== hud.stage) {
        if (hud.autoCombat) press('t', 'KeyT');
        test.ownCombat = false;
        return;
      }
      if (hud.stage >= mainQuestGoal) {
        if (handoff) return setAutoPhase('go-physician', 'Đã tới mốc Giai đoạn 14. Đang chuyển sang Dược Công.', 2);
        return finishTest('passed', `HUD xác nhận đã tới Giai đoạn ${hud.stage}.`, hud);
      }
      if (hud.stage === 8) {
        test.introGarden = true;
        test.recipe = '';
        return setAutoPhase('go-garden', 'Giai đoạn 8: đang vào vườn trồng Linh Diệp và Huyết Thảo.', 3);
      }
      const guide = introStages.get(hud.stage);
      if (!guide) return finishTest('blocked', hud.stage === null ? 'HUD chưa hiện giai đoạn nhiệm vụ chính.' :
        `Chưa có thao tác tự động cho Giai đoạn ${hud.stage}.`, hud);

      if (test.introStage !== hud.stage) {
        test.introStage = hud.stage;
        test.introAt = now;
        test.introAttempts = 0;
        test.brewSent = false;
        test.actedAt = 0;
        test.navAt = 0;
        test.lastMenu = null;
        reportTest(test.kind, 'progress', `Đang làm nhiệm vụ chính Giai đoạn ${hud.stage}.`, hud);
      }
      if (hud.stage === 13 && hud.meditating && !readDialog()) {
        if (!hud.experienceFull) { test.introAt = now; return; }
        if (now - test.actedAt >= 2500) { test.actedAt = now; test.introAttempts = 0; press('q', 'KeyQ'); }
        return;
      }
      if (now - test.introAt > 120000) return cancelTest(`Game chưa chuyển qua Giai đoạn ${hud.stage}.`);
      const rows = objectives();
      if ([5, 6, 11].includes(hud.stage) && driveIntroCombat(hud, rows, now)) return;
      if (test.brewSent) return;
      const dialog = readDialog();
      if (dialog) {
        const choice = dialog.choices.find(row => guide.choices?.test(row.label));
        if (choice && (guide.target.test(dialog.title) || guide.target.test(targetName(hud)))) selectAutoChoice(choice, now);
        else if (guide.recipe && /đan lô/i.test(dialog.title || targetName(hud))) brewRecipe(dialog, guide.recipe, now);
        return;
      }
      if (guide.target.test(targetName(hud))) {
        if (now - test.actedAt < 3000 || test.introAttempts >= 6) return;
        test.introAttempts++;
        test.actedAt = now;
        press('e', 'KeyE');
        return;
      }
      if (now - test.navAt < 20000) return;
      const objective = rows.find(row => !/^xong:/i.test(row.label)) || rows[0];
      if (objective) {
        test.walkingToHerb = true;
        test.navAt = now;
        objective.node.click();
      }
    }

    function walkLocal(hud, map, tile, arrived, now) {
      if (arrived) {
        test.localMove = null;
        return true;
      }
      if (!test.localMove) {
        tapMinimap(map, tile);
        test.localMove = { x: hud.x, y: hud.y, last: now, start: now };
        return false;
      }
      const move = test.localMove;
      if (hud.x !== move.x || hud.y !== move.y) Object.assign(move, { x: hud.x, y: hud.y, last: now });
      if (now - move.last > 4500 || now - move.start > 20000) return null;
      return false;
    }

    function walkToTarget(hud, map, tile, target, now) {
      return walkLocal(hud, map, tile, target.test(targetName(hud)), now);
    }

    function nextPlot() {
      test.plot++;
      test.localMove = null;
      test.lastMenu = null;
      test.plotAt = 0;
      test.actedAt = 0;
    }

    function startGardenHunt() {
      test.huntIndex = 0;
      setAutoPhase('farm-scan', 'Đã đi qua các luống. Đang tìm Dược Linh Thú trong vườn.');
    }

    function tickGardenHunt(hud, now) {
      const enemyVisible = /^dược linh thú$/i.test(hud.enemy || '');
      if (test.phase === 'farm-combat') {
        if (enemyVisible) test.lastEnemySeen = now;
        const timeLimit = now - test.phaseAt >= 60000;
        if (timeLimit || now - test.lastEnemySeen >= 2500) {
          if (hud.autoCombat) press('t', 'KeyT');
          setAutoPhase('farm-combat-stop', 'Đang xác nhận đã tắt Auto đánh để tiếp tục.');
        } else if (!hud.autoCombat && now - test.phaseAt >= 3500) {
          setAutoPhase('farm-combat-stop', 'HUD chưa xác nhận Auto đánh. Đang tiếp tục kiểm tra vườn.');
        }
        return;
      }
      if (test.phase === 'farm-combat-stop') {
        if (hud.autoCombat) {
          if (now - test.phaseAt > 3500) return cancelTest('Chưa xác nhận đã tắt Auto đánh.');
          return;
        }
        test.ownCombat = false;
        test.huntIndex++;
        return setAutoPhase('farm-scan', 'Đang kiểm tra điểm có Dược Linh Thú tiếp theo.');
      }
      if (enemyVisible && hud.autoCombat === false) {
        test.ownCombat = true;
        test.lastEnemySeen = now;
        press('t', 'KeyT');
        return setAutoPhase('farm-combat', 'Đang bật Auto đánh Dược Linh Thú.');
      }
      const tile = gardenHunt[test.huntIndex];
      if (!tile || hud.autoCombat === null) return setAutoPhase('farm-meditate', 'Đang trở về đài đá để tọa thiền.');
      const arrived = walkLocal(hud, gardenMap, tile, Math.hypot(hud.x - tile[0], hud.y - tile[1]) <= 1, now);
      if (arrived !== false) {
        test.huntIndex++;
        test.localMove = null;
      }
    }

    function tickFarm(hud, now) {
      if (hud.map !== 'vuon_ca_nhan') return cancelTest('HUD báo đã rời Vườn Cá Nhân.');
      if (test.introGarden && hud.stage >= 9) {
        test.introGarden = false;
        if (hud.meditating) press('q', 'KeyQ');
        return setAutoPhase('intro', 'HUD xác nhận đã xong Giai đoạn 8.');
      }
      const dialog = readDialog();
      if (test.phase === 'farm-start') {
        if (dialog) return finishTest('blocked', 'Đóng hội thoại trong vườn trước khi chạy Auto chăm vườn.', hud);
        return setAutoPhase('farm-water', 'Đang đến ao lấy nước chăm luống.');
      }
      if (['farm-scan', 'farm-combat', 'farm-combat-stop'].includes(test.phase)) return tickGardenHunt(hud, now);
      if (hud.autoCombat) {
        if (now - test.phaseAt > 5000) return cancelTest('Auto đánh vẫn đang bật; đã dừng chăm vườn.');
        return;
      }
      if (test.phase === 'farm-water') {
        if (dialog) {
          const water = dialog.choices.find(choice => /^múc nước$/i.test(choice.label));
          if (water && selectAutoChoice(water, now)) return;
          if ((!water || water.disabled) && now - test.actedAt > 900) document.getElementById('dialog')?.click();
        } else if (!test.actedAt) {
          const arrived = walkToTarget(hud, gardenMap, [11, 4], /^ao bích thu[ỷy]$/i, now);
          if (arrived === false) return;
          if (arrived) { test.actedAt = now; press('e', 'KeyE'); return; }
        } else if (now - test.actedAt < 3000) return;
        if (dialog && now - test.phaseAt < 24000) return;
        test.plot = -1;
        nextPlot();
        setAutoPhase('farm-plots', 'Đang đi qua từng luống thuốc.');
        return;
      }
      if (test.phase === 'farm-plots') {
        const tile = gardenPlots[test.plot];
        if (!tile) {
          if (test.introGarden) return setAutoPhase('farm-wait', 'Đang chờ cây lớn để kiểm tra lại các luống.');
          if (test.recipe) return setAutoPhase('farm-brew', `Đang tới đan lô để luyện ${test.recipe}.`);
          return startGardenHunt();
        }
        const name = `Luống Thuốc ${test.plot + 1}`;
        if (dialog) {
          if (dialog.title !== name) return cancelTest('Game mở hội thoại khác khi chăm luống.');
          let seeds = /^gieo hạt (linh diệp|huyết thảo|bích vân diệp|long huyết thảo|linh ngọc diệp|xích dương thảo)(\s+×\d+)?$/i;
          if (test.introGarden) seeds = test.plot < 5 ? /^gieo hạt linh diệp/i : /^gieo hạt huyết thảo/i;
          const seed = dialog.choices.find(choice => !choice.disabled && seeds.test(choice.label));
          if (seed && selectAutoChoice(seed, now)) { nextPlot(); return; }
          if (now - test.actedAt < 800 || seed) return;
          document.getElementById('dialog-close')?.click();
          nextPlot();
          return;
        }
        if (test.plotAt) {
          if (now - test.plotAt >= 1800) nextPlot();
          return;
        }
        const arrived = walkToTarget(hud, gardenMap, tile, new RegExp(`^${name}$`, 'i'), now);
        if (arrived === null) { reportTest(test.kind, 'unconfirmed', `Chưa tới được ${name}.`); nextPlot(); }
        if (arrived) {
          test.plotAt = test.actedAt = now;
          press('e', 'KeyE');
          reportTest(test.kind, 'sent', `Đã tương tác ${name}; game tự tưới hoặc thu hoạch nếu đủ điều kiện.`);
        }
        return;
      }
      if (test.phase === 'farm-wait') {
        if (now - test.phaseAt >= 30000) {
          test.plot = -1;
          nextPlot();
          setAutoPhase('farm-plots', 'Đang kiểm tra các luống đã chín.');
        }
        return;
      }
      if (test.phase === 'farm-brew') {
        if (test.brewSent) {
          if (now - test.actedAt < 16000) return;
          if (dialog) document.getElementById('dialog-close')?.click();
          reportTest(test.kind, 'unconfirmed', `Đã gửi yêu cầu luyện ${test.recipe}.`);
          return startGardenHunt();
        }
        if (now - test.phaseAt > 24000) {
          document.getElementById('dialog-close')?.click();
          reportTest(test.kind, 'unconfirmed', `Chưa xác nhận luyện được ${test.recipe}.`);
          return startGardenHunt();
        }
        if (dialog) { brewRecipe(dialog, test.recipe, now); return; }
        const arrived = walkToTarget(hud, gardenMap, [10, 10], /^đan lô linh điền$/i, now);
        if (arrived && now - test.actedAt >= 2500) { test.actedAt = now; press('e', 'KeyE'); }
        return;
      }
      if (hud.meditating) return finishTest('passed', 'HUD xác nhận nhân vật đã tọa thiền trong vườn.', hud);
      if (now - test.phaseAt > 22000) return finishTest('unconfirmed', 'Chưa xác nhận tọa thiền tại đài đá.', hud);
      if (dialog) {
        selectAutoChoice(dialog.choices.find(choice => /^tọa thiền$/i.test(choice.label)), now);
        return;
      }
      const arrived = walkToTarget(hud, gardenMap, [8, 7], /^đài đá trong linh điền$/i, now);
      if (arrived && now - test.actedAt >= 3000) { test.actedAt = now; press('e', 'KeyE'); }
    }

    function tickAuto(hud, now) {
      if (hud.hpMax > 0 && hud.hp < hud.hpMax * 0.35) return cancelTest('Đã dừng Auto vì Khí Huyết thấp.');
      if (test.phase === 'prepare') {
        if (hud.flying || hud.meditating || hud.autoCombat) {
          if (now - test.phaseAt > 6000) return finishTest('blocked', 'Game chưa trả về trạng thái sẵn sàng.', hud);
          if (!test.actedAt) {
            if (hud.flying) press('f', 'KeyF');
            if (hud.meditating) press('q', 'KeyQ');
            if (hud.autoCombat) press('t', 'KeyT');
            test.actedAt = now;
          }
          return;
        }
        if (test.kind === 'farm') return setAutoPhase('go-garden', 'Đang đi qua cổng Vườn Cá Nhân.', 3);
        if (test.kind === 'intro') return setAutoPhase('intro', 'Đang xác định nhiệm vụ chính.');
        if (hud.questWork && (test.plan !== 'auto' || hud.questWork.name === jobs[0].name)) {
          test.job = jobs.find(job => job.name === hud.questWork.name);
          return setAutoPhase('gather', `Đang tiếp tục việc ${test.job.name}.`);
        }
        if (/việc dược công/i.test(hud.questTitle || '')) {
          return finishTest('blocked', 'Nhân vật đang giữ một việc Dược Công khác.', hud);
        }
        if (test.plan === 'total' && hud.stage !== null && hud.stage < mainQuestGoal) {
          return setAutoPhase('intro', 'Đang làm nhiệm vụ chính tới Giai đoạn 14.');
        }
        if (hud.stage !== null && hud.stage < 8) {
          return finishTest('blocked', 'Sổ Dược Công mở ở Giai đoạn 8.', hud);
        }
        return setAutoPhase('go-physician', 'Đang tới Đại Phu để nhận việc Dược Công.', 2);
      }
      if (test.phase === 'intro') return tickIntro(hud, now);
      if (test.phase.startsWith('farm-')) return tickFarm(hud, now);
      if (['accept', 'turn-in', 'native-confirm'].includes(test.phase)) return tickAutoPhysician(hud, now);
      if (test.phase === 'native-running') {
        if (/xong việc dược công hôm nay/i.test(hud.caption)) {
          test.nativeFinished = true;
          return setAutoPhase('go-physician', 'Game báo xong Auto Dược Công. Đang kiểm tra lượt còn lại trong Sổ.', 2);
        }
        if (/^tự làm việc dược công/i.test(hud.caption)) test.nativeConfirmed = true;
        if (/dừng tự làm việc|đã dừng tự làm việc|chưa đủ cảnh giới/i.test(hud.caption)) {
          return finishTest('stopped', hud.caption, hud);
        }
        if (!test.nativeConfirmed && now - test.phaseAt > 5000) {
          return cancelTest('HUD chưa xác nhận Auto Dược Công của game đã chạy.');
        }
        return;
      }
      if (test.phase === 'gather') return tickAutoGather(hud, now);
      if (test.phase === 'escort-confirm') {
        if (!hud.questWork) return setAutoPhase('return', 'HUD đã bỏ việc hộ tống, đang về kiểm tra Sổ Dược Công.', 2);
        if (now - test.phaseAt > 8000) return cancelTest('HUD chưa xác nhận giao việc hộ tống.');
        return;
      }
      if (test.phase === 'close-ledger') {
        const dialog = readDialog();
        if (!dialog) return setAutoPhase('go-garden', 'Đang đi qua cổng Vườn Cá Nhân.', 3);
        if (now - test.phaseAt > 3500) return finishTest('blocked', 'Game chưa đóng được Sổ Dược Công.', hud);
        const close = document.getElementById('dialog-close');
        if (!test.actedAt && now - test.phaseAt >= 700 && visible(close)) {
          test.actedAt = now;
          close.click();
        }
        return;
      }
      tickRoute(hud, now, (message, state) => {
        if (test.phase === 'go-fishing') return setAutoPhase('gather', 'Đã tới Thảo Dược Cốc để câu cá.');
        if (test.phase === 'go-wood') return setAutoPhase('gather', 'Đã tới Thảo Dược Cốc để thu gom Dược Mộc.');
        if (test.phase === 'go-garden') {
          if (test.plan === 'auto') return finishTest('passed', 'Đã giao một lượt Linh Chi và vào Vườn Cá Nhân.', state);
          return setAutoPhase('farm-start', 'HUD xác nhận đã vào Vườn Cá Nhân.');
        }
        if (test.phase === 'return') return setAutoPhase('turn-in', 'Đã về Đại Phu, đang giao việc.');
        setAutoPhase('accept', 'Đã tới Đại Phu, đang mở Sổ Dược Công.');
      });
    }

    function tickTest() {
      if (!test) return;
      const now = Date.now();
      const hud = readHud();
      const limits = { flight: 3000, quest: 7000, auto: test.plan === 'auto' ? 420000 : 3600000, intro: 1800000, farm: 420000 };
      if (now - test.began > (limits[test.kind] ?? 100000)) {
        if (['auto', 'intro', 'farm'].includes(test.kind) || test.leg) return cancelTest('Đã dừng vì thao tác chưa xong trong thời gian cho phép.');
        return finishTest('unconfirmed', test.kind === 'flight' ? 'HUD chưa xác nhận đổi trạng thái phi hành.' :
          'Chưa đọc được danh sách việc từ hội thoại Đại Phu.', hud?.dialog ?? null);
      }
      if (!hud) return;
      if (test.kind === 'flight') {
        if (hud.flying === test.flying) finishTest('passed', hud.flying ? 'HUD xác nhận đã cất cánh.' : 'HUD xác nhận đã hạ cánh.', hud);
      } else if (test.kind === 'quest') tickQuest(hud, now);
      else if (['auto', 'intro', 'farm'].includes(test.kind)) tickAuto(hud, now);
      else tickRoute(hud, now, (message, state) => finishTest('passed', message, state));
    }

    function addResult(kind, message, data) {
      if (session.events.length >= 100) return;
      session.events.push({ at: new Date().toISOString(), kind, message, data });
      $('result').textContent = `${session.events.length} xác nhận · ${message}`;
    }

    function compare(before, after) {
      const start = movementStart;
      const minimumDistance = connection.source === 'hud' ? 1 : 2;
      if (!session.events.some(event => event.kind === 'movement') &&
          (after.map !== start.map || (after.x !== null && start.x !== null && after.y !== null && start.y !== null &&
            Math.hypot(after.x - start.x, after.y - start.y) >= minimumDistance))) {
        addResult('movement', `Đã di chuyển · ${after.mapName || after.map}`);
      }
      if (before.flying !== null && after.flying !== null && before.flying !== after.flying) {
        addResult('flight', after.flying ? 'Đã cất cánh' : 'Đã hạ cánh');
      }
      if (before.stage !== null && after.stage > before.stage) {
        addResult('stage', `Nhiệm vụ chính tăng từ giai đoạn ${before.stage} lên ${after.stage}`);
      }
      if (after.meditating && (!before.meditating || (after.meditationBonus && !before.meditationBonus))) {
        addResult('meditation', after.meditationBonus ? 'Đã vào tọa thiền có thưởng Đạo Hạnh' : 'Đã vào tọa thiền');
      }
      if (before.autoCombat === false && after.autoCombat === true) addResult('combat', 'Game báo đã bật Auto chiến đấu');
      if (after.dialogTitle && (before.dialogTitle !== after.dialogTitle ||
          before.dialog?.choices.map(choice => choice.label).join('|') !== after.dialog?.choices.map(choice => choice.label).join('|'))) {
        addResult('dialog', `Đã hiện hội thoại ${after.dialogTitle}`, after.dialog);
      }
      if (after.map === 'vuon_ca_nhan' && before.map !== after.map) addResult('garden-arrived', 'HUD xác nhận đã vào Vườn Cá Nhân.');

      const oldQuest = before.quest;
      const quest = after.quest;
      if (quest?.tasks && oldQuest?.tasks) {
        if (oldQuest.unlocked === false && quest.unlocked === true) addResult('quest-unlocked', 'Đã mở Sổ Dược Công');
        if (job && !quest.active && job.round !== null && quest.round > job.round &&
            job.points !== null && quest.points > job.points) {
          addResult('quest-turn-in', `Đã giao ${job.name} · +${quest.points - job.points} Dược Công`);
          job = null;
        }
        if (quest.active && (!job || job.id !== quest.active.id || job.round !== quest.round)) {
          job = { ...quest.active, round: quest.round, points: quest.points };
          addResult('quest-accepted', `Đang giữ việc ${job.name}`);
        }
        if (quest.active && oldQuest.active?.id === quest.active.id &&
            oldQuest.active.progress !== null && quest.active.progress > oldQuest.active.progress) {
          addResult('quest-progress', `${quest.active.name} · ${quest.active.progress}/${quest.active.need ?? '?'}`);
        }
      }

      if (before.map !== 'vuon_ca_nhan' || after.map !== 'vuon_ca_nhan') return;
      if (!before.garden?.plots || !after.garden?.plots) return;
      for (const [index, plot] of after.garden.plots.entries()) {
        const old = before.garden.plots[index];
        if (!old) continue;
        if (!old.seed && plot.seed) addResult('garden-sow', `Đã gieo ${plot.seed} ở ${plot.id}`);
        if (old.seed && old.seed === plot.seed && old.wet === false && plot.wet === true) {
          addResult('garden-water', `Đã tưới luống ${plot.id}`);
        }
        if (old.seed && old.ready === true && !plot.seed) {
          addResult('garden-empty', `Luống ${plot.id} đã trống sau khi cây chín`);
        }
      }
    }

    function refresh() {
      const runtime = probe(readRuntime);
      const sampled = runtime.game ? probe(() => readState(runtime.game)) : null;
      const runtimeState = sampled?.error ? null : sampled;
      const hudState = runtimeState ? null : probe(readHud);
      current = runtimeState ?? (hudState?.error ? null : hudState);
      const usingHud = Boolean(current && !runtimeState);
      const source = usingHud ? 'hud' : runtimeState ? runtime.source : null;
      const sameSource = source === connection?.source;
      connection = { ready: Boolean(current), namespaceHook, source,
        sources: runtime.sources ?? [], hasCanvas: Boolean(document.getElementById('game-canvas')),
        hasHud: Boolean(document.getElementById('hud')), error: runtime.error || sampled?.error || hudState?.error || null };

      if (session?.recording) {
        const signature = JSON.stringify(connection);
        if (signature !== connectionSignature) {
          connectionSignature = signature;
          session.connections.push({ at: new Date().toISOString(), ...connection });
          if (session.connections.length > 50) session.connections.splice(1, 1);
        }
        if (current) {
          if (previous && sameSource) compare(previous, current);
          else {
            movementStart = current;
            if (!session.before) {
              session.before = current;
              $('result').textContent = 'Đã có dữ liệu game. Thử di chuyển hoặc thao tác chức năng muốn kiểm tra.';
            }
            const active = current.quest?.active;
            job = active ? { ...active, round: current.quest.round, points: current.quest.points } : null;
          }
          session.after = current;
        }
        previous = current;
      }

      if (!current) {
        const waiting = Date.now() - mountedAt < 15_000;
        $('status').textContent = waiting ? 'Đã nạp script · Đang chờ dữ liệu game.' :
          'Chưa đọc được dữ liệu game. Bạn vẫn có thể ghi test và tải log.';
        $('player').textContent = '';
        $('garden').textContent = '';
        $('quests').textContent = 'Dược Công · Chờ dữ liệu';
        $('tasks').replaceChildren();
        taskSignature = '';
        return;
      }

      const { mapName, map, hp, hpMax, stage, flying, garden, quest } = current;
      $('status').textContent = usingHud ? 'Đã đọc được HUD trong game' : 'Kết nối game thành công';
      $('player').textContent = `${mapName || map} · HP ${hp ?? '?'}/${hpMax ?? '?'} · Giai đoạn ${stage ?? '?'}` +
        (flying === null ? '' : flying ? ' · Đang bay' : ' · Đang ở mặt đất') +
        (usingHud ? ` · (${current.x}, ${current.y})` : '');
      $('garden').textContent = garden?.plots ? `Vườn · ${garden.plots.filter(plot => plot.seed).length}/${garden.plots.length} luống có cây` :
        usingHud && map === 'vuon_ca_nhan' ? 'Vườn · Đang ở Vườn Cá Nhân' :
        garden?.error ? `Vườn · ${garden.error}` : 'Vườn · Chưa đọc được dữ liệu';
      $('quests').textContent = quest?.tasks ? `Dược Công · ${quest.tasks.length} việc` +
        (quest.unlocked === false ? ' · Sổ đang khóa' : '') +
        (quest.active ? ` · ${quest.active.name} ${quest.active.progress ?? '?'}/${quest.active.need ?? '?'}` : '') :
        usingHud ? 'Dược Công · Mở hội thoại để ghi nhận' : `Dược Công · ${quest?.error || 'Chưa đọc được dữ liệu'}`;
      const signature = JSON.stringify(quest?.tasks ?? null);
      if (taskSignature !== signature) {
        taskSignature = signature;
        $('tasks').replaceChildren(...(quest?.tasks || []).map(task => {
          const row = document.createElement('li');
          const availability = task.locked ? 'đang khóa' : task.exhausted ? 'hết lượt' : `${task.left ?? '?'} lượt`;
          row.textContent = `${task.name || task.id} · ${availability}`;
          return row;
        }));
      }
    }

    for (const id of testButtons) $(id).addEventListener('click', () => {
      const kind = id.replace('-test', '');
      if (kind === 'total' || kind === 'duoc-cong') startTest('auto', kind);
      else startTest(kind);
    });
    $('stop-test').addEventListener('click', () => cancelTest('Đã dừng thử theo yêu cầu.'));
    window.addEventListener('keydown', event => {
      if (!test || !event.isTrusted) return;
      const movement = /^(Arrow(Up|Down|Left|Right)|Key[WASD])$/.test(event.code);
      if (movement || ['Escape', 'KeyE', 'KeyF', 'KeyQ', 'KeyT', 'Space'].includes(event.code)) {
        cancelTest('Đã dừng thử do thao tác bàn phím.', movement);
      }
    }, true);
    document.addEventListener('pointerdown', event => {
      if (test && event.isTrusted && !event.composedPath().includes(host)) cancelTest('Đã dừng thử do bạn thao tác trong game.');
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (test && document.hidden) cancelTest('Đã dừng thử vì tab bị ẩn.');
    });

    $('record').addEventListener('click', () => {
      refresh();
      if (session?.recording) {
        session.recording = false;
        session.endedAt = new Date().toISOString();
        $('record').textContent = 'Bắt đầu ghi test';
        $('result').textContent = `Đã dừng ghi · ${session.events.length} xác nhận`;
      } else {
        session = { recording: true, startedAt: new Date().toISOString(),
          before: null, after: null, events: [], connections: [] };
        connectionSignature = '';
        previous = null;
        $('record').textContent = 'Kết thúc ghi test';
        $('result').textContent = 'Đang ghi. Hãy vào nhân vật để kết nối dữ liệu game.';
        refresh();
      }
    });

    $('export').addEventListener('click', () => {
      refresh();
      const data = JSON.stringify({ version, exportedAt: new Date().toISOString(), connection,
        snapshot: current, recording: false, events: [], connections: [], ...session, tests: testRecords }, null, 2);
      $('log-text').value = data;
      $('log').hidden = false;
      let url;
      const link = document.createElement('a');
      try {
        url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        link.href = url;
        link.download = `tutien2d-test-${Date.now()}.json`;
        root.append(link);
        link.click();
      } catch (_) {
        $('log').open = true;
        $('log-text').focus();
        $('log-text').select();
      } finally {
        link.remove();
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });

    refresh();
    setInterval(() => {
      refresh();
      if (!test) return;
      try { tickTest(); }
      catch (error) { finishTest('blocked', String(error?.message || error)); }
    }, 250);
  }

  if (document.documentElement) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
