using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ChromeGridApp
{
    internal sealed class MonitorView : UserControl
    {
        private readonly DataGridView grid = new DataGridView();
        private readonly Label status = new Label();
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        private readonly Button autoButton = new Button();
        private readonly Button farmAllButton = new Button();
        private readonly ComboBox scriptChoice = new ComboBox();
        private readonly Label activeScriptStatus = new Label();
        private readonly ComboBox profileChoice = new ComboBox();
        private readonly ComboBox farmMapChoice = new ComboBox();
        private readonly ComboBox farmZoneChoice = new ComboBox();
        private readonly Button runScript = new Button();
        private readonly Button stopScript = new Button();
        private readonly Button optimizeGraphics = new Button();
        private readonly Button restoreGraphics = new Button();
        private readonly Button openSelected = new Button();
        private readonly Button closeSelected = new Button();
        private readonly Button markDone = new Button();
        private readonly Button clearDone = new Button();
        private readonly TextBox detail = new TextBox();
        private const int MaxProfiles = 20;
        private int profileCount = 10;
        private readonly string[][] details = new string[MaxProfiles][];
        private readonly CultivationEstimate[] estimates = Enumerable.Range(0, MaxProfiles).Select(_ => new CultivationEstimate()).ToArray();
        private readonly string[] estimateText = new string[MaxProfiles];
        private readonly DateTime[] estimateUpdated = new DateTime[MaxProfiles];
        public event Action<int> OpenProfile;
        public event Action<int> CloseProfile;
        public event Action<string[][]> SnapshotsUpdated;
        public event Action<int, string, bool> DateDoneRequested;
        private event Action DateControlsChanged;
        public Func<int, string> LastCharacterForProfile;
        public Func<string, bool?> DateDoneForCharacter;
        private bool busy;
        private string autoSession;
        private readonly HashSet<int> pausedAutoProfiles = new HashSet<int>();
        private readonly string[] commandMessages = new string[MaxProfiles];
        private DateTime commandExpires = DateTime.MinValue;
        private const string Expression = @"(() => {
          const text = id => (document.getElementById(id)?.textContent || '').trim();
          const api = window.TuTienAuto;
          let s = null; try { s = api?.status?.(); } catch (_) {}
          const book = document.getElementById('tt-free-books')?.shadowRoot;
          const farmApi = window.TuTienStoneFarm;
          let farm = null; try { farm = farmApi?.status?.(); } catch (_) {}
          let bookStatus = 'Chưa đọc được dữ liệu bí kíp';
          try {
            let free = null;
            try { free = window.TuTienFreeBooks?.status?.(); } catch (_) {}
            if (!free?.ready || !Array.isArray(free.pools)) {
              const game = [window.gameDebug, window.PNTT].find(g => g?.SceneWorld?.player && g?.SceneWorld?.map?.data?.id &&
                typeof g?.Gacha?.freeToday === 'function' && typeof g?.Gacha?.soldOut === 'function');
              if (game) {
                const pools = ['so_cap', 'bi_dong'].map(id => ({ id, free: game.Gacha.freeToday(game, id), soldOut: game.Gacha.soldOut(game, id) }));
                if (pools.every(p => typeof p.free === 'boolean' && typeof p.soldOut === 'boolean')) free = { ready: true, pools };
              }
            }
            if (free?.ready && Array.isArray(free.pools)) {
              const describe = id => {
                const pool = free.pools.find(p => p.id === id);
                return !pool || typeof pool.free !== 'boolean' || typeof pool.soldOut !== 'boolean' ? 'chưa rõ' : !pool.free ? 'hết lượt' : pool.soldOut ? 'còn lượt, tủ hết' : 'còn lượt';
              };
              bookStatus = 'Sơ: ' + describe('so_cap') + ' · Bị động: ' + describe('bi_dong');
            }
          } catch (_) { bookStatus = 'Chưa đọc được dữ liệu bí kíp'; }
          const supported = [api?.startAuto ? 'Auto tổng' : '', farmApi?.start ? 'Auto quái' : ''].filter(Boolean);
          const command = __RUN_COMMAND__;
          let commandResult = '';
          if (command === 'optimizeGraphics' || command === 'restoreGraphics') {
            try {
              const g = [window.gameDebug, window.PNTT].find(x => x?.SceneWorld?.player && x?.Quality?.get && x?.Quality?.set && x?.Quality?.fpsKhoa && x?.Quality?.fpsKhoaDat);
              if (!g) commandResult = 'Chưa đọc được cài đặt đồ họa game';
              else {
                const key = 'tutien_grid_graphics_backup_v1', q = g.Quality;
                if (command === 'optimizeGraphics') {
                  const previous = { level: q.get()?.id, fps: q.fpsKhoa() };
                  if (typeof previous.level !== 'string' || !Number.isFinite(previous.fps)) throw Error('Không đọc được cấu hình đồ họa hiện tại');
                  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(previous));
                  if (q.set('sieu_lo')?.id !== 'sieu_lo' || q.fpsKhoaDat(30) !== 30) throw Error('Game không xác nhận thiết lập đồ họa');
                  commandResult = 'Đã đặt đồ họa Siêu lỏ, 30 FPS';
                } else {
                  const saved = JSON.parse(localStorage.getItem(key) || 'null');
                  if (!saved || typeof saved.level !== 'string' || !Number.isFinite(saved.fps) || !q.levels?.some(x => x.id === saved.level)) commandResult = 'Không có cấu hình đồ họa đã lưu';
                  else if (q.set(saved.level)?.id !== saved.level || q.fpsKhoaDat(saved.fps) !== saved.fps) commandResult = 'Game chưa xác nhận khôi phục đồ họa';
                  else { localStorage.removeItem(key); commandResult = 'Đã khôi phục đồ họa trước đó'; }
                }
              }
            } catch(e) { commandResult = 'Không đổi được đồ họa: ' + String(e?.message || e); }
          } else if (command === 'stopAll') {
            const results = [];
            try { if (typeof api?.stop === 'function') { api.stop(); s = api.status(); results.push(['Auto tong', !['automation','intro','quests','garden','navigation'].some(k => s?.[k]?.running)]); } else results.push(['Auto tong', false]); } catch (_) { results.push(['Auto tong', false]); }
            try { if (farmApi?.stop) { farmApi.stop(); farm = farmApi.status(); results.push(['Auto quai', !farm?.running]); } else results.push(['Auto quai', false]); } catch (_) { results.push(['Auto quai', false]); }
            try { const button = book?.getElementById('stop'); if (button && !button.disabled) button.click(); results.push(['Bi tich', !button || button.disabled]); } catch (_) { results.push(['Bi tich', false]); }
            commandResult = results.filter(x => x[1]).map(x => x[0] + ' da dung').concat(results.filter(x => !x[1]).map(x => 'Khong xac nhan duoc ' + x[0])).join(' · ');          } else if (command === 'stopMain') {
            if (typeof api?.stop !== 'function') commandResult = 'Chưa thấy script Auto TuTien2D';
            else { try { api.stop(); s = api.status(); commandResult = ['automation','intro','quests','garden','navigation'].some(k => s?.[k]?.running) ? 'Chưa xác nhận được auto đã dừng' : 'Đã dừng Auto TuTien2D'; } catch(e) { commandResult = 'Không dừng được auto: ' + String(e); } }
          } else if (command === 'stopBooks') {
            const button = book?.getElementById('stop');
            if (!button) commandResult = 'Chưa thấy script Bí tịch';
            else if (button.disabled) commandResult = 'Bí tịch đã dừng';
            else { try { button.click(); commandResult = button.disabled ? 'Đã dừng script Bí tịch' : 'Chưa xác nhận được script Bí tịch đã dừng'; } catch(e) { commandResult = 'Không dừng được Bí tịch: ' + String(e); } }
          } else if (command === 'stopStone') {
            if (!farmApi?.stop) commandResult = 'Auto farm script not found';
            else { try { farmApi.stop(); farm = farmApi.status(); commandResult = farm?.running ? 'Could not confirm Auto farm stopped' : 'Auto farm stopped'; } catch(e) { commandResult = 'Could not stop Auto farm: ' + String(e); } }
          } else if (command === 'stone' || command?.startsWith('stone:')) {
            const parts = command.startsWith('stone:') ? command.slice(6).split(':') : [];
            const mapId = parts[0] || '', zoneId = /^\d+$/.test(parts[1] || '') ? Number(parts[1]) : null;
            if (!farmApi?.start) commandResult = 'Auto farm 2.0.27 is not installed';
            else if (farmApi.version !== '2.0.27') commandResult = 'Auto farm version ' + (farmApi.version || 'unknown') + '; need 2.0.27';
            else if (farm?.running) commandResult = 'Auto farm is already running';
            else if (['automation','intro','quests','garden','navigation'].some(k => s?.[k]?.running) || (book?.getElementById('stop') && !book.getElementById('stop').disabled)) commandResult = 'Another automation is running; stop it first';
            else { try { const ok = farmApi.start({mapId, zoneId}); farm = farmApi.status(); commandResult = ok ? 'Auto farm started' : (farm?.message || 'Could not start Auto farm'); } catch(e) { commandResult = 'Auto farm error: ' + String(e); } }
          } else if (command === 'main') {
            const occupied = ['automation','intro','quests','garden','navigation'].some(k => s?.[k]?.running);
            if (!api?.startAuto) commandResult = 'Chưa thấy script Auto TuTien2D';
            else if (occupied || farm?.running) commandResult = 'Một auto đang chạy; hãy dừng trước';
            else if (book && book.getElementById('stop') && !book.getElementById('stop').disabled) commandResult = 'Bí tịch đang chạy; hãy dừng trước';
            else if (!s?.snapshot?.ready) commandResult = 'Nhân vật chưa sẵn sàng';
            else if (s?.snapshot?.controls?.autoOn || s?.snapshot?.controls?.autoDC || s?.snapshot?.controls?.diNV) commandResult = 'Tắt auto có sẵn trong game trước';
            else { try { commandResult = api.startAuto({otherScriptsStopped:true}) ? 'Đã bật Auto tổng' : 'Không bật được Auto tổng'; s = api.status(); } catch(e) { commandResult = 'Lỗi: ' + String(e); } }
          } else if (command === 'books') {
            const button = book?.getElementById('start');
            if (!button) commandResult = 'Chưa thấy script Bí tịch';
            else if (farm?.running || ['automation','intro','quests','garden','navigation'].some(k => s?.[k]?.running)) commandResult = 'Auto khác đang chạy; hãy dừng trước';
            else if (button.disabled) commandResult = 'Bí tịch chưa sẵn sàng hoặc đang chạy';
            else { button.click(); commandResult = book.getElementById('status')?.textContent?.trim() || 'Đã gửi lệnh rút bí tịch'; }
          }
          const token = __AUTO_SESSION__;
          if (token && s && typeof api.startAuto === 'function') {
            const key = '__tutienGridAutoStart';
            if (!window[key] || window[key].token !== token) window[key] = { token, attempted: false };
            const marker = window[key];
            if (!marker.attempted) {
              const otherRunning = farm?.running || ['intro','quests','garden','navigation'].some(k => s[k]?.running) || (book?.getElementById('stop') && !book.getElementById('stop').disabled);
              if (s.automation?.running || otherRunning) marker.attempted = true;
              else if (s.snapshot?.controls?.autoOn || s.snapshot?.controls?.autoDC || s.snapshot?.controls?.diNV) { marker.attempted = true; marker.error = 'Tắt auto có sẵn trong game trước'; }
              else if (s.snapshot?.ready && Number.isInteger(s.snapshot?.quest?.stage)) {
                marker.attempted = true;
                try { api.startAuto({otherScriptsStopped:true}); s = api.status(); } catch (error) { marker.error = String(error); }
              }
            }
          }
          const h = s?.snapshot?.hud || {};
          const visible = el => !!el && !el.hidden && !el.classList.contains('hidden') && !!el.getClientRects().length;
          const inGame = visible(document.getElementById('hud')) && !visible(document.getElementById('auth-gate')) && !visible(document.getElementById('loading')) && !!text('hud-map') && !!text('hud-pos');
          const q = s?.snapshot?.quest || {};
          let cultivation = 'Chưa đọc được điều kiện đột phá.';
          let cultivationExperience = null;
          if (__DETAIL__ && inGame && typeof api?.report === 'function') {
            try {
              const d = api.report()?.gardenData;
              if (d) {
                if (d.experience && Number.isFinite(d.experience.current) && Number.isFinite(d.experience.target)) cultivationExperience = d.experience;
                const lines = [];
                if (d.duocCong != null) lines.push('Điểm Dược Công: ' + d.duocCong);
                if (d.breakthrough?.nextName || d.breakthrough?.next) lines.push('Cảnh giới kế tiếp: ' + (d.breakthrough.nextName || d.breakthrough.next));
                const conditions = Array.isArray(d.breakthrough?.conditions) ? d.breakthrough.conditions : [];
                for (const c of conditions) lines.push((c.done ? '✓ ' : '○ ') + (c.label || 'Điều kiện') + ': ' + (c.current ?? '?') + '/' + (c.target ?? '?'));
                if (!conditions.length && d.experience) lines.push('Đạo Hạnh: ' + Math.floor(d.experience.current || 0) + '/' + (d.experience.target || '?'));
                if (d.breakthrough?.blocked) lines.push('Đang bị chặn: ' + d.breakthrough.blocked);
                if (d.goal) {
                  lines.push('Đan cần: ' + (d.goal.name || d.goal.id) + ' · Có ' + (d.goal.have ?? '?') + '/' + (d.goal.need ?? '?'));
                  for (const m of d.goal.materials || []) lines.push('  ' + (m.name || m.id || 'Nguyên liệu') + ': ' + (m.have ?? '?') + '/' + (m.required ?? '?'));
                }
                if (lines.length) cultivation = lines.join('\n');
              }
            } catch (_) { cultivation = 'Chưa đọc được điều kiện đột phá.'; }
          }
          const objectiveNode = document.getElementById('quest-objectives');
          const objectives = (objectiveNode?.innerText || '').trim() || (Array.isArray(q.objectives) ? q.objectives.map(o => (o.text || '') + (o.cur != null && o.max != null ? ' ' + o.cur + '/' + o.max : '')).filter(Boolean).join('\n') : '') || text('quest-objectives');
          const stageText = text('quest-stage').match(/\d+/);
          const types = ['automation','intro','quests','garden','navigation'];
          const running = types.find(k => s?.[k]?.running && !(k === 'quests' && farm?.running && farm?.phase === 'QUESTS'));
          const bookStop = book?.getElementById('stop');
          const bookRunning = !!bookStop && !bookStop.disabled;
          const activeCount = Number(!!running) + Number(bookRunning) + Number(!!farm?.running);
          const activeScript = !inGame ? '' : activeCount > 1 ? 'both' : running ? 'main' : bookRunning ? 'books' : farm?.running ? 'stone' : '';
          let stoneInfo = '', stoneDay = '', stoneBalance = '', stoneEarnedToday = '', stoneDayKey = '', zone = '', farmMaps = [], farmZoneCount = 0;
          try { const m = farmApi?.maps?.(); if (Array.isArray(m)) farmMaps = m.filter(x => typeof x.id === 'string' && typeof x.name === 'string').slice(0, 100); } catch (_) {}
          if (inGame) {
            try {
              const game = [window.gameDebug, window.PNTT].find(g => g?.SceneWorld?.player && Number.isFinite(g?.Progress?.stones));
              if (Number.isInteger(game?.KhuUI?.soKhu)) farmZoneCount = game.KhuUI.soKhu;
              const balance = game?.Progress?.stones;
              if (Number.isFinite(balance)) stoneBalance = String(balance);
              const today = game?.Loot?.stoneToday?.(game);
              const parts = ['Ví: ' + (Number.isFinite(balance) ? balance : 'chưa đọc được')];
              if (today && Number.isFinite(today.da)) stoneEarnedToday = String(today.da);
              if (today && Number.isFinite(today.ngay)) stoneDayKey = String(today.ngay);
              if (farm?.startBalance != null) {
                parts.push('Tăng trong phiên: ' + (farm.gained ?? 0));
                parts.push('Tốc độ: ' + (farm.perHour == null ? 'chờ đo (30 giây)' : farm.perHour + '/giờ'));
                if (farm.spent > 0) parts.push('Giảm trong phiên: ' + farm.spent);
                if (farm.targetMap || farm.map) parts.push('Bãi: ' + (farm.targetMap || farm.map));
              } else parts.push('Chưa bắt đầu phiên farm');
              if (today && Number.isFinite(today.da) && Number.isFinite(today.tran)) { stoneDay = today.da + '/' + today.tran; parts.push('Đá rơi hôm nay: ' + stoneDay); }
              if (Number.isInteger(game?.KhuUI?.khu)) { zone = String(game.KhuUI.khu); parts.push('Khu: ' + zone); }
              stoneInfo = parts.join(' · ');
            } catch (_) { stoneInfo = 'Chưa đọc được thông tin Linh Thạch.'; }
          }
          const failed = types.find(k => s?.[k]?.state === 'ERROR');
          const a = running ? s[running] : s?.automation;
          return JSON.stringify({realm: h.realm || text('hud-realm'), hp: h.hp != null && h.hpMax != null ? h.hp + '/' + h.hpMax : text('value-hp'),
            stage: q.stage == null ? (stageText ? stageText[0] : '') : String(q.stage),
            auto: commandResult || (activeCount > 1 ? 'Nhiều auto đang chạy' : farm?.running ? ('Auto quái: ' + farm.message + ' · Tăng ví: ' + farm.gained + ' · ' + (farm.perHour == null ? 'chờ đo' : farm.perHour + '/giờ')) : running ? (running + ': ' + (a.message || a.state || 'đang chạy')) : bookRunning ? ('Bí tịch cũ: ' + (book.getElementById('status')?.textContent?.trim() || 'đang chạy')) : farm && (farm.startBalance != null || farm.state === 'ERROR') ? ('Auto quái: ' + farm.message + ' · Tăng ví: ' + farm.gained + ' · ' + (farm.perHour == null ? 'chờ đo' : farm.perHour + '/giờ')) : !s ? 'Chưa thấy Auto TuTien2D' : failed ? ('Lỗi: ' + (s[failed].message || '')) : (token && window.__tutienGridAutoStart?.error) || 'Đã dừng'),
            scripts: supported.join(', ') || 'Chưa nhận diện',
            map: h.map || text('hud-map'), position: h.x != null && h.y != null ? '(' + h.x + ', ' + h.y + ')' : text('hud-pos'), version: s?.version || '', character: inGame ? text('hud-name') : '', books: inGame ? bookStatus : 'Chưa vào game',
            objectives: inGame ? objectives : '', questHint: inGame ? text('quest-hint') : '', cultivation,
            cultivationCurrent: cultivationExperience ? String(cultivationExperience.current) : '', cultivationTarget: cultivationExperience ? String(cultivationExperience.target) : '', cultivationFull: cultivationExperience ? String(cultivationExperience.full === true) : '', activeScript, stoneInfo, stoneDay, stoneBalance, stoneEarnedToday, stoneDayKey, farmMaps: JSON.stringify(farmMaps), farmPreferred: farm?.preferredMapId || '', zone, farmZoneCount, farmZonePreferred: farm?.preferredZoneId || ''});
        })()";

        public MonitorView()
        {
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 6, Padding = new Padding(12) };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 40)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 60));
            Controls.Add(layout);
            var note = new Label { AutoSize = true, MaximumSize = new Size(700, 0), Text = "Chọn Auto tổng hoặc Auto quái cho từng profile. Auto quái tự xử lý bí tịch, Dược Công rồi farm Linh Thạch. Dữ liệu cập nhật khoảng 5 giây/lần.\nChrome cần được mở với chế độ theo dõi. Chế độ này bật cổng điều khiển Chrome trên máy; phần mềm khác chạy trên máy có thể truy cập các profile đó." };
            layout.Controls.Add(note, 0, 0);
            autoButton.AutoSize = true; autoButton.Text = "Bật Auto tổng 10 profile"; autoButton.Click += delegate { SetAutoEnabled(autoSession == null); };
            farmAllButton.AutoSize = true; farmAllButton.Text = "Bật Auto quái 10 profile";
            farmAllButton.Click += async delegate {
                if (scriptChoice.SelectedIndex != 1) scriptChoice.SelectedIndex = 1;
                if (profileChoice.SelectedIndex != 0) profileChoice.SelectedIndex = 0;
                await RunSelectedScript(false);
            };
            var bulkButtons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
            bulkButtons.Controls.Add(autoButton); bulkButtons.Controls.Add(farmAllButton);
            layout.Controls.Add(bulkButtons, 0, 1);
            var scriptRow = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
            scriptChoice.DropDownStyle = ComboBoxStyle.DropDownList; scriptChoice.Width = 175;
            scriptChoice.Items.AddRange(new object[] { "Auto tổng", "Auto quái" }); scriptChoice.SelectedIndex = 0;
            profileChoice.DropDownStyle = ComboBoxStyle.DropDownList; profileChoice.Width = 130; profileChoice.Items.Add("Tất cả profile");
            for (int i = 1; i <= profileCount; i++) profileChoice.Items.Add("Profile" + i.ToString("00")); profileChoice.SelectedIndex = 0;
            activeScriptStatus.AutoSize = true; activeScriptStatus.Text = "\u0110ang ch\u1ea1y: ch\u01b0a x\u00e1c \u0111\u1ecbnh"; activeScriptStatus.Margin = new Padding(3, 7, 8, 0);
            farmMapChoice.DropDownStyle = ComboBoxStyle.DropDownList; farmMapChoice.Width = 180;
            farmMapChoice.Items.Add(new FarmMapOption("", "Map: Tự động")); farmMapChoice.SelectedIndex = 0;
            farmZoneChoice.DropDownStyle = ComboBoxStyle.DropDownList; farmZoneChoice.Width = 110;
            farmZoneChoice.Items.Add(new FarmZoneOption(0)); for (int i = 1; i <= 30; i++) farmZoneChoice.Items.Add(new FarmZoneOption(i)); farmZoneChoice.SelectedIndex = 0;
            profileChoice.SelectedIndexChanged += delegate {
                UpdateMapChoices(); UpdateZoneChoices();
                if (profileChoice.SelectedIndex > 0) SyncScriptForProfile(profileChoice.SelectedIndex);
                else activeScriptStatus.Text = "Ch\u1ecdn profile \u0111\u1ec3 xem script \u0111ang ch\u1ea1y";
            };
            runScript.AutoSize = true; runScript.Text = "Chạy script đã chọn"; runScript.Click += async delegate { await RunSelectedScript(false); };
            stopScript.AutoSize = true; stopScript.Text = "Dừng script profile này"; stopScript.Click += async delegate { await RunSelectedScript(true); };
            optimizeGraphics.AutoSize = true; optimizeGraphics.Text = "Giảm đồ họa"; optimizeGraphics.Click += async delegate { await ChangeGraphics(false); };
            restoreGraphics.AutoSize = true; restoreGraphics.Text = "Khôi phục đồ họa"; restoreGraphics.Click += async delegate { await ChangeGraphics(true); };
            scriptRow.Controls.Add(scriptChoice); scriptRow.Controls.Add(profileChoice); scriptRow.Controls.Add(farmMapChoice); scriptRow.Controls.Add(farmZoneChoice); scriptRow.Controls.Add(runScript); scriptRow.Controls.Add(stopScript); scriptRow.Controls.Add(optimizeGraphics); scriptRow.Controls.Add(restoreGraphics); layout.Controls.Add(scriptRow, 0, 2);
            scriptRow.Controls.Add(activeScriptStatus); scriptRow.Controls.SetChildIndex(activeScriptStatus, 1);
            status.AutoSize = true; status.Text = "Đang kiểm tra…"; status.Margin = new Padding(0, 8, 0, 8); layout.Controls.Add(status, 0, 3);
            grid.Dock = DockStyle.Fill; grid.ReadOnly = true; grid.AllowUserToAddRows = false; grid.AllowUserToDeleteRows = false;
            grid.RowHeadersVisible = false; grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
            grid.MultiSelect = false; grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.Columns.Add("profile", "Profile"); grid.Columns.Add("character", "Tên nhân vật"); grid.Columns.Add("realm", "Cảnh giới"); grid.Columns.Add("auto", "Trạng thái auto"); grid.Columns.Add("books", "Bí kíp miễn phí");
            grid.Columns.Add("stoneDay", "Linh Thạch rơi hôm nay");
            grid.Columns.Add("zone", "Khu");
            grid.Columns["stoneDay"].ToolTipText = "Số đá game tính vào hạn mức rơi hôm nay; có thể khác số đá đã nhặt vào ví.";
            grid.Columns["auto"].FillWeight = 180;
            for (int i = 1; i <= MaxProfiles; i++) { int row = grid.Rows.Add("Profile" + i.ToString("00"), "—", "—", "Chưa kết nối", "Chưa kết nối", "—", "—"); if (i > profileCount) grid.Rows[row].Visible = false; }
            layout.Controls.Add(grid, 0, 4);
            var detailBox = new GroupBox { Text = "Chi tiết profile đã chọn", Dock = DockStyle.Fill };
            var detailLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
            detailLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); detailLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            detail.Dock = DockStyle.Fill; detail.Multiline = true; detail.ReadOnly = true; detail.ScrollBars = ScrollBars.Vertical; detail.Text = "Chọn một profile trong bảng.";
            detailLayout.Controls.Add(detail, 0, 0);
            var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
            openSelected.Text = "Mở Chrome profile này"; openSelected.AutoSize = true;
            closeSelected.Text = "Đóng Chrome profile này"; closeSelected.AutoSize = true;
            var expandDetail = new Button { Text = "Xem chi tiết lớn", AutoSize = true };
            expandDetail.Click += delegate { ShowDetailsDialog(); };
            markDone.Text = "Done date & đóng Chrome"; markDone.AutoSize = true;
            clearDone.Text = "Chuyển sang chưa Done date"; clearDone.AutoSize = true;
            markDone.Click += delegate { RequestDateDone(true); };
            clearDone.Click += delegate { RequestDateDone(false); };
            openSelected.Click += delegate { int selected = SelectedProfile(); if (selected > 0 && OpenProfile != null) OpenProfile(selected); };
            closeSelected.Click += delegate { int selected = SelectedProfile(); if (selected > 0 && CloseProfile != null) CloseProfile(selected); };
            actions.Controls.Add(openSelected); actions.Controls.Add(closeSelected); actions.Controls.Add(expandDetail); actions.Controls.Add(markDone); actions.Controls.Add(clearDone); detailLayout.Controls.Add(actions, 0, 1);
            detailBox.Controls.Add(detailLayout); layout.Controls.Add(detailBox, 0, 5);
            grid.CurrentCellChanged += delegate {
                int selected = SelectedProfile();
                if (selected >= 1 && selected <= profileCount) profileChoice.SelectedIndex = selected;
                SyncScriptForProfile(selected);
                UpdateDetails();
            };
            grid.CellClick += delegate(object sender, DataGridViewCellEventArgs e) {
                if (e.RowIndex >= 0 && e.RowIndex < profileCount) { profileChoice.SelectedIndex = e.RowIndex + 1; SyncScriptForProfile(e.RowIndex + 1); }
            };
            grid.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e) { if (e.RowIndex >= 0 && e.RowIndex < profileCount) ShowDetailsDialog(); };
            UpdateDetails();
            timer.Interval = 5000; timer.Tick += async delegate { await RefreshRows(); }; timer.Start();
            HandleCreated += async delegate { await RefreshRows(); };
            Disposed += delegate { timer.Stop(); timer.Dispose(); };
        }

        private int SelectedProfile() { return grid.CurrentCell == null ? 0 : grid.CurrentCell.RowIndex + 1; }
        internal int ConfiguredProfileCount { get { return profileCount; } }

        public void SetProfileCount(int count)
        {
            if (count < 1 || count > MaxProfiles) throw new ArgumentOutOfRangeException("count");
            if (grid.CurrentCell != null && grid.CurrentCell.RowIndex >= count) grid.CurrentCell = grid.Rows[0].Cells[0];
            profileCount = count;
            for (int i = 0; i < grid.Rows.Count; i++) grid.Rows[i].Visible = i < count;
            int previous = profileChoice.SelectedIndex;
            profileChoice.BeginUpdate();
            try { profileChoice.Items.Clear(); profileChoice.Items.Add("Tất cả profile"); for (int i = 1; i <= count; i++) profileChoice.Items.Add("Profile" + i.ToString("00")); profileChoice.SelectedIndex = previous <= count ? Math.Max(0, previous) : 0; }
            finally { profileChoice.EndUpdate(); }
            autoButton.Text = autoSession == null ? "Bật Auto tổng " + count + " profile" : "Tắt tự bật lại Auto tổng";
            farmAllButton.Text = "Bật Auto quái " + count + " profile";
            UpdateMapChoices(); UpdateZoneChoices(); UpdateDetails();
        }

        private sealed class FarmMapOption {
            public readonly string Id, Name;
            public FarmMapOption(string id, string name) { Id = id; Name = name; }
            public override string ToString() { return Name; }
        }
        private sealed class FarmZoneOption {
            public readonly int Id;
            public FarmZoneOption(int id) { Id = id; }
            public override string ToString() { return Id == 0 ? "Khu: Tự động" : "Khu: " + Id; }
        }
        private static Dictionary<string, string> ParseFarmMaps(string[] row) {
            var result = new Dictionary<string, string>();
            if (row == null || row.Length <= 19 || row[19] == "—") return result;
            try {
                var values = new JavaScriptSerializer().DeserializeObject(row[19]) as object[];
                if (values == null) return result;
                foreach (var value in values.OfType<Dictionary<string, object>>()) {
                    object id, name;
                    if (value.TryGetValue("id", out id) && value.TryGetValue("name", out name) && Regex.IsMatch(Convert.ToString(id), "^[a-z0-9_]{1,80}$")) result[Convert.ToString(id)] = Convert.ToString(name);
                }
            } catch (Exception) { }
            return result;
        }
        private void UpdateMapChoices() {
            if (farmMapChoice.IsDisposed || farmMapChoice.Items.Count == 0) return;
            int selected = profileChoice.SelectedIndex;
            var available = selected > 0 ? ParseFarmMaps(details[selected - 1]) : new Dictionary<string, string>();
            if (selected == 0) {
                bool first = true;
                foreach (var row in details.Take(profileCount)) {
                    if (row == null || row.Length <= 19 || row[19] == "—" || row[19] == "[]") continue;
                    var next = ParseFarmMaps(row);
                    if (first) { available = next; first = false; }
                    else foreach (string id in available.Keys.ToArray()) if (!next.ContainsKey(id)) available.Remove(id);
                }
            }
            var currentOption = farmMapChoice.SelectedItem as FarmMapOption;
            string current = currentOption == null ? "" : currentOption.Id;
            var wanted = available.OrderBy(k => k.Value).Select(k => new FarmMapOption(k.Key, k.Value)).ToArray();
            var previous = farmMapChoice.Items.Cast<FarmMapOption>().Skip(1).Select(x => x.Id + "=" + x.Name);
            if (previous.SequenceEqual(wanted.Select(x => x.Id + "=" + x.Name))) return;
            farmMapChoice.BeginUpdate();
            try { farmMapChoice.Items.Clear(); farmMapChoice.Items.Add(new FarmMapOption("", "Map: Tự động")); farmMapChoice.Items.AddRange(wanted); farmMapChoice.SelectedIndex = Math.Max(0, Array.FindIndex(wanted, x => x.Id == current) + 1); }
            finally { farmMapChoice.EndUpdate(); }
        }

        private void UpdateZoneChoices() {
            if (farmZoneChoice.IsDisposed || farmZoneChoice.Items.Count == 0) return;
            int selected = profileChoice.SelectedIndex, maxZones = 30;
            if (selected > 0 && details[selected - 1] != null && details[selected - 1].Length > 25) {
                int count; if (int.TryParse(details[selected - 1][25], out count) && count > 0) maxZones = Math.Min(30, count);
            } else if (selected == 0) {
                var counts = details.Take(profileCount).Where(row => row != null && row.Length > 25).Select(row => { int n; return int.TryParse(row[25], out n) && n > 0 ? n : 0; }).Where(n => n > 0).ToArray();
                if (counts.Length > 0) maxZones = Math.Min(30, counts.Min());
            }
            var currentOption = farmZoneChoice.SelectedItem as FarmZoneOption;
            int current = currentOption == null ? 0 : currentOption.Id;
            var wanted = Enumerable.Range(0, maxZones + 1).Select(n => new FarmZoneOption(n)).ToArray();
            if (farmZoneChoice.Items.Count == wanted.Length && farmZoneChoice.Items.Cast<FarmZoneOption>().Select(x => x.Id).SequenceEqual(wanted.Select(x => x.Id))) return;
            farmZoneChoice.BeginUpdate();
            try { farmZoneChoice.Items.Clear(); farmZoneChoice.Items.AddRange(wanted); farmZoneChoice.SelectedIndex = Math.Min(current, maxZones); }
            finally { farmZoneChoice.EndUpdate(); }
        }

        private void SyncScriptForProfile(int number)
        {
            if (number < 1 || number > MaxProfiles) return;
            var row = details[number - 1];
            string active = row != null && row.Length > 16 ? row[16] : null;
            if (active == "main") scriptChoice.SelectedIndex = 0;
            else if (active == "stone") scriptChoice.SelectedIndex = 1;
            else scriptChoice.SelectedIndex = -1;
            if (active == "main") activeScriptStatus.Text = "\u0110ang ch\u1ea1y: Auto t\u1ed5ng";
            else if (active == "stone") activeScriptStatus.Text = "\u0110ang ch\u1ea1y: Auto qu\u00e1i";
            else if (active == "both") activeScriptStatus.Text = "\u0110ang ch\u1ea1y: Auto t\u1ed5ng + Auto qu\u00e1i";
            else if (active == "books") activeScriptStatus.Text = "\u0110ang ch\u1ea1y: B\u00ed t\u1ecbch";
            else if (row == null || row.Length <= 8 || row[8] == "—") activeScriptStatus.Text = "\u0110ang ch\u1ea1y: ch\u01b0a k\u1ebft n\u1ed1i game";
            else activeScriptStatus.Text = "\u0110ang ch\u1ea1y: kh\u00f4ng ph\u00e1t hi\u1ec7n auto";
        }

        private static string ActiveScript(string[] row) { return row != null && row.Length > 16 ? row[16] : null; }

        private string CharacterForProfile(int number, out bool live)
        {
            var row = number >= 1 && number <= MaxProfiles ? details[number - 1] : null;
            string name = row != null && row.Length > 8 ? row[8] : null;
            live = !string.IsNullOrWhiteSpace(name) && name != "—";
            return live ? name : LastCharacterForProfile == null ? null : LastCharacterForProfile(number);
        }

        public string MobileCharacterForProfile(int number, out bool live) { return CharacterForProfile(number, out live); }

        private void RequestDateDone(bool value)
        {
            int number = SelectedProfile(); bool live;
            string name = CharacterForProfile(number, out live);
            if (number < 1 || number > MaxProfiles || string.IsNullOrWhiteSpace(name) || (value && !live)) return;
            if (DateDoneRequested != null) DateDoneRequested(number, name, value);
        }

        public void RefreshDetails() { UpdateDetails(); }
        public static string ReadCurrentCharacter(int number)
        {
            if (number < 1 || number > MaxProfiles) return null;
            var row = ReadProfile(19300 + number, null, null, false);
            return row.Length > 8 && row[8] != "—" ? row[8] : null;
        }

        public object[] MobileProfiles()
        {
            var result = new List<object>();
            for (int i = 0; i < profileCount; i++) {
                var row = details[i]; bool live;
                string name = CharacterForProfile(i + 1, out live);
                bool? done = DateDoneForCharacter == null || string.IsNullOrWhiteSpace(name) ? null : DateDoneForCharacter(name);
                int zoneCount = 0;
                if (row != null && row.Length > 25) int.TryParse(row[25], out zoneCount);
                result.Add(new { number = i + 1, name = name ?? "", online = live, realm = row == null ? "—" : row[0],
                    auto = row == null ? "Chưa kết nối" : row[3], books = row == null ? "Chưa kết nối" : row[9],
                    active = row != null && row.Length > 16 ? row[16] : "", stone = row != null && row.Length > 17 ? row[17] : "",
                    maps = ParseFarmMaps(row).Select(k => new { id = k.Key, name = k.Value }).ToArray(),
                    farmMap = row != null && row.Length > 20 && row[20] != "—" ? row[20] : "",
                    zone = row != null && row.Length > 24 ? row[24] : "", zoneCount,
                    farmZone = row != null && row.Length > 26 ? row[26] : "", done });
            }
            return result.ToArray();
        }

        public static object MobileDetail(int number)
        {
            if (number < 1 || number > MaxProfiles) return new { error = "Profile không hợp lệ" };
            var rows = ReadAll(null, null, 0, number, null);
            var row = rows[number - 1];
            return new { detail = "Nhân vật: " + row[8] + "\nCảnh giới: " + row[0] + " · HP: " + row[1] + "\nGiai đoạn nhiệm vụ: " + row[2] +
                "\nBản đồ: " + row[5] + " · Tọa độ: " + row[6] + "\nAuto: " + row[3] + "\nLinh Thạch: " + (row.Length > 17 ? row[17] : "Chưa có dữ liệu") + "\nBí kíp: " + row[9] +
                "\n\nMục tiêu luyện khí / đột phá:\n" + row[12] + "\n\nMục tiêu nhiệm vụ:\n" + row[10] + "\nGợi ý: " + row[11] };
        }

        public static string VerifiedMobileCharacter(int number)
        {
            if (number < 1 || number > MaxProfiles) return null;
            var rows = ReadAll(null, null, 0, number, null);
            string name = rows[number - 1][8];
            return name == "—" ? null : name;
        }

        public async Task<string> MobileScript(int number, string script, bool stop, string mapId = "", int zoneId = 0)
        {
            if (number < 1 || number > profileCount || (script != "main" && script != "books" && script != "stone")) return "Profile hoặc script không hợp lệ.";
            if (busy || !actionsEnabled) return "Ứng dụng đang cập nhật hoặc xử lý Chrome; thử lại sau vài giây.";
            if (!string.IsNullOrEmpty(mapId) && !Regex.IsMatch(mapId, "^[a-z0-9_]{1,80}$")) return "Map không hợp lệ.";
            if (zoneId < 0 || zoneId > 30) return "Khu farm phải từ 1 đến 30 hoặc để tự động.";
            if (!stop && script == "stone" && !string.IsNullOrEmpty(mapId) && !ParseFarmMaps(details[number - 1]).ContainsKey(mapId)) return "Map không phù hợp hoặc chưa có dữ liệu; chờ cập nhật và thử lại.";
            if (stop && script == "main") pausedAutoProfiles.Add(number);
            else if (!stop && script == "main") pausedAutoProfiles.Remove(number);
            if (!stop && script == "stone") pausedAutoProfiles.Add(number);
            string command = stop ? (script == "main" ? "stopMain" : script == "books" ? "stopBooks" : "stopStone") : script == "stone" && (!string.IsNullOrEmpty(mapId) || zoneId > 0) ? "stone:" + mapId + ":" + (zoneId > 0 ? zoneId.ToString() : "") : script;
            int detailProfile = SelectedProfile(), requestedCount = profileCount;
            busy = true; runScript.Enabled = false; stopScript.Enabled = false;
            try {
                var rows = await Task.Run(() => ReadAll(null, command, number, detailProfile, null, requestedCount));
                if (IsDisposed) return "Ứng dụng đã đóng.";
                RecordEstimate(rows, detailProfile);
                commandMessages[number - 1] = rows[number - 1][3]; commandExpires = DateTime.Now.AddSeconds(30);
                for (int i = 0; i < rows.Length; i++) {
                    details[i] = rows[i];
                    grid.Rows[i].Cells["realm"].Value = rows[i][0]; grid.Rows[i].Cells["character"].Value = rows[i][8];
                    grid.Rows[i].Cells["auto"].Value = rows[i][3]; grid.Rows[i].Cells["books"].Value = rows[i][9]; grid.Rows[i].Cells["stoneDay"].Value = rows[i].Length > 18 ? rows[i][18] : "—"; grid.Rows[i].Cells["zone"].Value = rows[i].Length > 24 ? rows[i][24] : "—";
                }
                SyncScriptForProfile(SelectedProfile()); UpdateDetails();
                status.Text = rows[number - 1][3]; return rows[number - 1][3];
            } catch (Exception error) { return "Không gửi được lệnh: " + error.Message; }
            finally { busy = false; if (!IsDisposed) { runScript.Enabled = true; stopScript.Enabled = true; } }
        }

        private void ShowDetailsDialog()
        {
            int number = SelectedProfile();
            if (number < 1 || number > MaxProfiles) return;
            using (var dialog = new Form { Text = "Chi tiết Profile" + number.ToString("00"), StartPosition = FormStartPosition.CenterParent,
                Size = new Size(750, 500), MinimumSize = new Size(450, 300), Font = Font, ShowInTaskbar = false })
            using (var text = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Text = detail.Text })
            {
                var close = new Button { Text = "Đóng", Dock = DockStyle.Bottom, Height = 36, DialogResult = DialogResult.Cancel };
                var dateAction = new Button { Dock = DockStyle.Bottom, Height = 36 };
                var operation = new Label { Dock = DockStyle.Bottom, Height = 42, AutoEllipsis = true, Text = status.Text };
                Action syncDateAction = delegate {
                    bool live; string name = CharacterForProfile(SelectedProfile(), out live);
                    bool? done = DateDoneForCharacter == null || string.IsNullOrWhiteSpace(name) ? null : DateDoneForCharacter(name);
                    dateAction.Text = done == true ? clearDone.Text : markDone.Text;
                    dateAction.Enabled = actionsEnabled && (done == true || (done == false && live));
                };
                syncDateAction();
                dateAction.Click += delegate {
                    bool live; string name = CharacterForProfile(SelectedProfile(), out live);
                    bool? done = DateDoneForCharacter == null || string.IsNullOrWhiteSpace(name) ? null : DateDoneForCharacter(name);
                    if (done != null) RequestDateDone(!done.Value);
                    syncDateAction();
                };
                dialog.Controls.Add(text); dialog.Controls.Add(operation); dialog.Controls.Add(dateAction); dialog.Controls.Add(close); dialog.CancelButton = close;
                EventHandler update = delegate { if (!text.IsDisposed && text.Text != detail.Text) text.Text = detail.Text; if (!dateAction.IsDisposed) syncDateAction(); };
                EventHandler updateOperation = delegate { if (!operation.IsDisposed) operation.Text = status.Text; };
                detail.TextChanged += update;
                status.TextChanged += updateOperation;
                DateControlsChanged += syncDateAction;
                try { dialog.ShowDialog(FindForm()); }
                finally { detail.TextChanged -= update; status.TextChanged -= updateOperation; DateControlsChanged -= syncDateAction; }
            }
        }

        private void UpdateDetails()
        {
            int n = SelectedProfile();
            openSelected.Enabled = closeSelected.Enabled = n >= 1 && n <= profileCount && actionsEnabled;
            bool live; string name = CharacterForProfile(n, out live);
            bool? done = DateDoneForCharacter == null || string.IsNullOrWhiteSpace(name) ? null : DateDoneForCharacter(name);
            markDone.Visible = done != true;
            clearDone.Visible = done == true;
            markDone.Enabled = actionsEnabled && live && done == false;
            clearDone.Enabled = actionsEnabled && done == true;
            if (DateControlsChanged != null) DateControlsChanged();
            if (n < 1 || n > profileCount) { detail.Text = "Chọn một profile trong bảng."; return; }
            var row = details[n - 1];
            string dateStatus = done == null ? "Chưa có trong thống kê" : done.Value ? "Đã Done date" : "Chưa Done date";
            string character = string.IsNullOrWhiteSpace(name) ? "—" : name + (live ? "" : " (lần cuối)");
            if (row == null) { detail.Text = "Profile" + n.ToString("00") + " · Nhân vật: " + character + " · " + dateStatus + "\r\nĐang chờ dữ liệu."; return; }
            string estimate = DateTime.UtcNow - estimateUpdated[n - 1] <= TimeSpan.FromSeconds(15) ? estimateText[n - 1] : "Đang chờ dữ liệu để đo tốc độ.";
            string display = string.Format("Profile{0:00} · Nhân vật: {1} · Cảnh giới: {2} · HP: {3} · Giai đoạn: {4}\r\nDate Done: {14}\r\nBản đồ: {5} · Tọa độ: {6} · Phiên bản: {7}\r\nAuto: {8}\r\nLinh Thạch: {16}\r\nScript: {9} · Bí kíp: {10}\r\n\r\nMục tiêu luyện khí / đột phá:\r\n{13}\r\nThời gian dự kiến: {15}\r\n\r\nMục tiêu nhiệm vụ:\r\n{11}\r\nGợi ý: {12}", n, character, row[0], row[1], row[2], row[5], row[6], row[7], row[3], row[4], row[9], row[10].Replace("\n", "\r\n"), row[11], row[12].Replace("\n", "\r\n"), dateStatus, estimate, row.Length > 17 ? row[17] : "Chưa có dữ liệu");
            if (detail.Text != display) detail.Text = display;
        }

        private bool actionsEnabled = true;
        public void SetActionsEnabled(bool enabled) { actionsEnabled = enabled; UpdateDetails(); }
        public void SetOperationStatus(string message) { status.Text = message; }

        public void SetAutoEnabled(bool enabled)
        {
            if (enabled && autoSession != null) return;
            if (enabled) pausedAutoProfiles.Clear();
            autoSession = enabled ? Guid.NewGuid().ToString("N") : null;
            autoButton.Text = enabled ? "Tắt tự bật lại Auto tổng" : "Bật Auto tổng " + profileCount + " profile";
            status.Text = enabled ? "Đang chờ game sẵn sàng để bật Auto tổng." : "Đã tắt tự bật lại; auto đang chạy vẫn tiếp tục.";
        }

        private async Task RefreshRows()
        {
            if (busy || IsDisposed) return;
            busy = true;
            try
            {
                string session = autoSession;
                int detailProfile = SelectedProfile(), requestedCount = profileCount;
                bool[] paused = Enumerable.Range(1, requestedCount).Select(i => pausedAutoProfiles.Contains(i)).ToArray();
                var rows = await Task.Run(() => ReadAll(session, null, 0, detailProfile, paused, requestedCount));
                if (IsDisposed) return;
                RecordEstimate(rows, detailProfile);
                int currentProfile = SelectedProfile();
                string previouslyActive = currentProfile >= 1 && currentProfile <= rows.Length ? ActiveScript(details[currentProfile - 1]) : null;
                for (int i = 0; i < rows.Length; i++)
                {
                    details[i] = rows[i];
                }
                UpdateMapChoices(); UpdateZoneChoices();
                if (currentProfile >= 1 && currentProfile <= rows.Length && previouslyActive != ActiveScript(details[currentProfile - 1])) SyncScriptForProfile(currentProfile);
                if (SnapshotsUpdated != null) SnapshotsUpdated(rows);
                for (int i = 0; i < rows.Length; i++)
                {
                    if (DateTime.Now < commandExpires && commandMessages[i] != null) rows[i][3] = commandMessages[i];
                    grid.Rows[i].Cells["realm"].Value = rows[i][0];
                    grid.Rows[i].Cells["character"].Value = rows[i][8];
                    grid.Rows[i].Cells["auto"].Value = rows[i][3];
                    grid.Rows[i].Cells["books"].Value = rows[i][9];
                    grid.Rows[i].Cells["stoneDay"].Value = rows[i].Length > 18 ? rows[i][18] : "—"; grid.Rows[i].Cells["zone"].Value = rows[i].Length > 24 ? rows[i][24] : "—";
                }
                UpdateDetails();
                status.Text = "Cập nhật lúc " + DateTime.Now.ToString("HH:mm:ss");
            }
            catch (Exception ex) { if (!IsDisposed) status.Text = "Không thể cập nhật: " + ex.Message; }
            finally { busy = false; }
        }

        private async Task RunSelectedScript(bool stop)
        {
            if (busy) { status.Text = "Đang cập nhật; vui lòng bấm lại."; return; }
            if (scriptChoice.SelectedIndex < 0 || scriptChoice.SelectedIndex > 1) { status.Text = "Profile này không có Auto tổng hoặc Auto quái đang chạy; hãy chọn script muốn bật trước."; return; }
            int selected = profileChoice.SelectedIndex;
            if (stop && selected == 0) { status.Text = "Hãy chọn một profile cụ thể trước khi dừng script."; return; }
            bool main = scriptChoice.SelectedIndex == 0;
            bool stone = scriptChoice.SelectedIndex == 1;
            if (stop && main) pausedAutoProfiles.Add(selected);
            if (!stop) {
                if (main) { if (selected == 0) pausedAutoProfiles.Clear(); else pausedAutoProfiles.Remove(selected); }
                if (stone) { if (selected == 0) for (int i = 1; i <= profileCount; i++) pausedAutoProfiles.Add(i); else pausedAutoProfiles.Add(selected); }
                else SetAutoEnabled(false);
            }
            busy = true; runScript.Enabled = false; stopScript.Enabled = false;
            var selectedMapOption = farmMapChoice.SelectedItem as FarmMapOption;
            string selectedMap = selectedMapOption == null ? "" : selectedMapOption.Id;
            var selectedZoneOption = farmZoneChoice.SelectedItem as FarmZoneOption;
            int selectedZone = selectedZoneOption == null ? 0 : selectedZoneOption.Id;
            string stoneCommand = selectedMap.Length == 0 && selectedZone == 0 ? "stone" : "stone:" + selectedMap + ":" + (selectedZone > 0 ? selectedZone.ToString() : "");
            string command = stop ? (main ? "stopMain" : stone ? "stopStone" : "stopBooks") : (main ? "main" : stone ? stoneCommand : "books");
            int detailProfile = SelectedProfile(), requestedCount = profileCount;
            status.Text = "Đang gửi lệnh đến profile đã chọn…";
            try
            {
                var rows = await Task.Run(() => ReadAll(null, command, selected, detailProfile, null, requestedCount));
                if (IsDisposed) return;
                RecordEstimate(rows, detailProfile);
                int currentProfile = SelectedProfile();
                string previouslyActive = currentProfile >= 1 && currentProfile <= rows.Length ? ActiveScript(details[currentProfile - 1]) : null;
                for (int i = 0; i < rows.Length; i++) commandMessages[i] = selected == 0 || selected == i + 1 ? rows[i][3] : null;
                commandExpires = DateTime.Now.AddSeconds(30);
                for (int i = 0; i < rows.Length; i++)
                {
                    details[i] = rows[i];
                    grid.Rows[i].Cells["realm"].Value = rows[i][0];
                    grid.Rows[i].Cells["character"].Value = rows[i][8];
                    grid.Rows[i].Cells["auto"].Value = rows[i][3];
                    grid.Rows[i].Cells["books"].Value = rows[i][9];
                    grid.Rows[i].Cells["stoneDay"].Value = rows[i].Length > 18 ? rows[i][18] : "—"; grid.Rows[i].Cells["zone"].Value = rows[i].Length > 24 ? rows[i][24] : "—";
                }
                if (currentProfile >= 1 && currentProfile <= rows.Length && previouslyActive != ActiveScript(details[currentProfile - 1])) SyncScriptForProfile(currentProfile);
                UpdateDetails();
                status.Text = "Đã gửi lệnh. Xem kết quả ở cột Trạng thái auto.";
            }
            catch (Exception ex) { if (!IsDisposed) status.Text = "Không gửi được lệnh: " + ex.Message; }
            finally { busy = false; if (!IsDisposed) { runScript.Enabled = true; stopScript.Enabled = true; } }
        }

        public async Task<string> StopBotForProfile(int number)
        {
            if (number < 1 || number > profileCount) return "Profile khong hop le.";
            if (busy || !actionsEnabled) return "Ung dung dang xu ly thao tac khac; thu lai sau.";
            pausedAutoProfiles.Add(number);
            int detailProfile = SelectedProfile(), requestedCount = profileCount;
            busy = true; runScript.Enabled = false; stopScript.Enabled = false;
            status.Text = "Dang gui lenh dung tat ca auto toi Profile" + number.ToString("00") + "...";
            try
            {
                var rows = await Task.Run(() => ReadAll(null, "stopAll", number, detailProfile, null, requestedCount));
                if (IsDisposed) return "Ung dung da dong.";
                RecordEstimate(rows, detailProfile);
                for (int i = 0; i < rows.Length; i++)
                {
                    details[i] = rows[i];
                    commandMessages[i] = i == number - 1 ? rows[i][3] : null;
                    grid.Rows[i].Cells["realm"].Value = rows[i][0]; grid.Rows[i].Cells["character"].Value = rows[i][8];
                    grid.Rows[i].Cells["auto"].Value = rows[i][3]; grid.Rows[i].Cells["books"].Value = rows[i][9];
                    grid.Rows[i].Cells["stoneDay"].Value = rows[i].Length > 18 ? rows[i][18] : "—";
                    grid.Rows[i].Cells["zone"].Value = rows[i].Length > 24 ? rows[i][24] : "—";
                }
                commandExpires = DateTime.Now.AddSeconds(30); UpdateDetails();
                status.Text = rows[number - 1][3]; return rows[number - 1][3];
            }
            catch (Exception error) { status.Text = "Khong gui duoc lenh dung: " + error.Message; return status.Text; }
            finally { busy = false; if (!IsDisposed) { runScript.Enabled = true; stopScript.Enabled = true; } }
        }
        public async Task<string> StartMainForProfile(int number)
        {
            if (number < 1 || number > profileCount) return "Profile không hợp lệ.";
            if (busy || !actionsEnabled) return "Ứng dụng đang xử lý thao tác khác; thử lại sau.";
            profileChoice.SelectedIndex = number;
            scriptChoice.SelectedIndex = 0;
            await RunSelectedScript(false);
            string[] row = number <= details.Length ? details[number - 1] : null;
            return row != null && row.Length > 3 ? row[3] : status.Text;
        }

        private async Task ChangeGraphics(bool restore)
        {
            if (busy || !actionsEnabled) { status.Text = "Đang cập nhật; vui lòng thử lại."; return; }
            int selected = profileChoice.SelectedIndex, detailProfile = SelectedProfile(), requestedCount = profileCount;
            busy = true; optimizeGraphics.Enabled = restoreGraphics.Enabled = false;
            status.Text = restore ? "Đang khôi phục đồ họa…" : "Đang giảm đồ họa…";
            try {
                string command = restore ? "restoreGraphics" : "optimizeGraphics";
                var rows = await Task.Run(() => ReadAll(null, command, selected, detailProfile, null, requestedCount));
                if (IsDisposed) return;
                for (int i = 0; i < rows.Length; i++) {
                    details[i] = rows[i];
                    commandMessages[i] = selected == 0 || selected == i + 1 ? rows[i][3] : null;
                    grid.Rows[i].Cells["realm"].Value = rows[i][0]; grid.Rows[i].Cells["character"].Value = rows[i][8];
                    grid.Rows[i].Cells["auto"].Value = rows[i][3]; grid.Rows[i].Cells["books"].Value = rows[i][9];
                    grid.Rows[i].Cells["stoneDay"].Value = rows[i].Length > 18 ? rows[i][18] : "—"; grid.Rows[i].Cells["zone"].Value = rows[i].Length > 24 ? rows[i][24] : "—";
                }
                commandExpires = DateTime.Now.AddSeconds(30); UpdateDetails();
                status.Text = "Đã gửi lệnh. Xem kết quả ở cột Trạng thái auto.";
            } catch (Exception error) { if (!IsDisposed) status.Text = "Không đổi được đồ họa: " + error.Message; }
            finally { busy = false; if (!IsDisposed) optimizeGraphics.Enabled = restoreGraphics.Enabled = true; }
        }

        public async Task<string> MobileGraphics(int number, bool restore)
        {
            if (number < 0 || number > profileCount) return "Profile không hợp lệ.";
            if (busy || !actionsEnabled) return "Ứng dụng đang cập nhật hoặc xử lý Chrome; thử lại sau vài giây.";
            int requestedCount = profileCount, detailProfile = SelectedProfile();
            busy = true; optimizeGraphics.Enabled = restoreGraphics.Enabled = false;
            try {
                string command = restore ? "restoreGraphics" : "optimizeGraphics";
                var rows = await Task.Run(() => ReadAll(null, command, number, detailProfile, null, requestedCount));
                if (IsDisposed) return "Ứng dụng đã đóng.";
                var reports = new List<string>();
                for (int i = 0; i < rows.Length; i++) {
                    details[i] = rows[i];
                    if (number == 0 || number == i + 1) { commandMessages[i] = rows[i][3]; reports.Add("Profile" + (i + 1).ToString("00") + ": " + rows[i][3]); }
                    grid.Rows[i].Cells["realm"].Value = rows[i][0]; grid.Rows[i].Cells["character"].Value = rows[i][8];
                    grid.Rows[i].Cells["auto"].Value = rows[i][3]; grid.Rows[i].Cells["books"].Value = rows[i][9];
                    grid.Rows[i].Cells["stoneDay"].Value = rows[i].Length > 18 ? rows[i][18] : "—"; grid.Rows[i].Cells["zone"].Value = rows[i].Length > 24 ? rows[i][24] : "—";
                }
                commandExpires = DateTime.Now.AddSeconds(30); UpdateDetails();
                return string.Join("\n", reports);
            } catch (Exception error) { return "Không đổi được đồ họa: " + error.Message; }
            finally { busy = false; if (!IsDisposed) optimizeGraphics.Enabled = restoreGraphics.Enabled = true; }
        }

        private void RecordEstimate(string[][] rows, int number)
        {
            if (number < 1 || number > MaxProfiles || rows == null || rows.Length < number) return;
            var row = rows[number - 1];
            double current, target;
            DateTime now = DateTime.UtcNow;
            if (row == null || row.Length < 16 || row[8] == "—" || row[0] == "—" ||
                !double.TryParse(row[13], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out current) ||
                !double.TryParse(row[14], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out target)) {
                estimates[number - 1].Reset(); estimateText[number - 1] = "Chưa đủ dữ liệu để tính.";
            } else {
                estimateText[number - 1] = estimates[number - 1].Observe(row[8], row[0], current, target, row[15] == "true", now);
            }
            estimateUpdated[number - 1] = now;
        }

        private static string[][] ReadAll(string session, string command, int selected, int detailProfile, bool[] paused, int count = MaxProfiles)
        {
            var active = new bool[count];
            using (var search = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='chrome.exe'"))
            using (var processes = search.Get())
            foreach (ManagementObject process in processes)
            {
                string line = Convert.ToString(process["CommandLine"]);
                if (string.IsNullOrEmpty(line) || Regex.IsMatch(line, @"(?:^|\s)--type=", RegexOptions.IgnoreCase)) continue;
                var dir = Regex.Match(line, "--user-data-dir=(?:\"([^\"]+)\"|(\\S+))", RegexOptions.IgnoreCase);
                var port = Regex.Match(line, @"--remote-debugging-port=(\d+)", RegexOptions.IgnoreCase);
                if (!dir.Success || !port.Success) continue;
                string path = (dir.Groups[1].Success ? dir.Groups[1].Value : dir.Groups[2].Value).TrimEnd('\\');
                for (int i = 0; i < count; i++)
                    if (string.Equals(path, @"D:\Auto\ChromeProxy\Profile" + (i + 1).ToString("00"), StringComparison.OrdinalIgnoreCase) && port.Groups[1].Value == (19301 + i).ToString()) active[i] = true;
            }
            var tasks = Enumerable.Range(0, count).Select(i => Task.Run(() => active[i] ? ReadProfile(19301 + i, paused != null && paused[i] ? null : session, CommandForProfile(command, selected, i + 1), detailProfile == i + 1) : new[] { "—", "—", "—", "Chưa bật theo dõi / đã đóng", "—", "—", "—", "—", "—", "Chưa kết nối", "—", "—", "Chưa đọc được điều kiện đột phá.", "—", "—", "—" })).ToArray();
            Task.WaitAll(tasks);
            return tasks.Select(t => t.Result).ToArray();
        }

        private static string CommandForProfile(string command, int selected, int profile)
        {
            if (string.IsNullOrEmpty(command) || profile < 1 || profile > MaxProfiles) return null;
            if ((command == "stopMain" || command == "stopBooks" || command == "stopStone") && selected == 0) return null;
            return selected == 0 || selected == profile ? command : null;
        }

        private static string[] ReadProfile(int port, string session, string command, bool detailed)
        {
            try
            {
                var serializer = new JavaScriptSerializer();
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/json/list");
                request.Proxy = null; request.Timeout = 2000; request.ReadWriteTimeout = 2000;
                string raw;
                using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream())) raw = reader.ReadToEnd();
                var targets = serializer.DeserializeObject(raw) as object[];
                if (targets == null) throw new Exception("Không tìm thấy tab game");
                var target = targets.OfType<Dictionary<string, object>>().FirstOrDefault(x => {
                    Uri u; object value; return x.TryGetValue("url", out value) && Uri.TryCreate(Convert.ToString(value), UriKind.Absolute, out u) && IsGameHost(u.Host);
                });
                if (target == null) return new[] { "—", "—", "—", "Chưa mở tab game", "—", "—", "—", "—", "—", "Chưa mở game", "—", "—", "Chưa đọc được điều kiện đột phá.", "—", "—", "—" };
                var ws = new Uri(Convert.ToString(target["webSocketDebuggerUrl"]));
                if (ws.Host != "127.0.0.1" && ws.Host != "localhost") throw new Exception("Địa chỉ kết nối không hợp lệ");
                using (var socket = new ClientWebSocket()) using (var timeout = new CancellationTokenSource(3000))
                {
                    socket.ConnectAsync(ws, timeout.Token).GetAwaiter().GetResult();
                    string expression = Expression.Replace("__AUTO_SESSION__", serializer.Serialize(session)).Replace("__RUN_COMMAND__", serializer.Serialize(command)).Replace("__DETAIL__", detailed ? "true" : "false");
                    string cmd = serializer.Serialize(new { id = 1, method = "Runtime.evaluate", @params = new { expression = expression, returnByValue = true } });
                    byte[] bytes = Encoding.UTF8.GetBytes(cmd);
                    socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, timeout.Token).GetAwaiter().GetResult();
                    using (var stream = new MemoryStream())
                    {
                        var buffer = new byte[8192]; WebSocketReceiveResult part;
                        do { part = socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token).GetAwaiter().GetResult(); stream.Write(buffer, 0, part.Count); if (stream.Length > 262144) throw new Exception("Dữ liệu quá lớn"); } while (!part.EndOfMessage);
                        var packet = (Dictionary<string, object>)serializer.DeserializeObject(Encoding.UTF8.GetString(stream.ToArray()));
                        var result = (Dictionary<string, object>)packet["result"];
                        var value = (Dictionary<string, object>)result["result"];
                        var data = (Dictionary<string, object>)serializer.DeserializeObject(Convert.ToString(value["value"]));
                        return new[] { Field(data, "realm"), Field(data, "hp"), Field(data, "stage"), Field(data, "auto"), Field(data, "scripts"), Field(data, "map"), Field(data, "position"), Field(data, "version"), Field(data, "character"), Field(data, "books"), Field(data, "objectives"), Field(data, "questHint"), Field(data, "cultivation"), Field(data, "cultivationCurrent"), Field(data, "cultivationTarget"), Field(data, "cultivationFull"), Field(data, "activeScript"), Field(data, "stoneInfo"), Field(data, "stoneDay"), Field(data, "farmMaps"), Field(data, "farmPreferred"), Field(data, "stoneBalance"), Field(data, "stoneEarnedToday"), Field(data, "stoneDayKey"), Field(data, "zone"), Field(data, "farmZoneCount"), Field(data, "farmZonePreferred") };
                    }
                }
            }
            catch (Exception) { return new[] { "—", "—", "—", "Không kết nối được Chrome", "—", "—", "—", "—", "—", "Không kết nối", "—", "—", "Chưa đọc được điều kiện đột phá.", "—", "—", "—" }; }
        }
        private static bool IsGameHost(string host)
        {
            return host.Equals("tutien2d.com", StringComparison.OrdinalIgnoreCase) ||
                host.EndsWith(".tutien2d.com", StringComparison.OrdinalIgnoreCase) ||
                host.Equals("tutienpixel.online", StringComparison.OrdinalIgnoreCase) ||
                host.EndsWith(".tutienpixel.online", StringComparison.OrdinalIgnoreCase);
        }

        private static string Field(Dictionary<string, object> data, string name) { object v; return data.TryGetValue(name, out v) && !string.IsNullOrWhiteSpace(Convert.ToString(v)) ? Convert.ToString(v) : "—"; }
    }
}
