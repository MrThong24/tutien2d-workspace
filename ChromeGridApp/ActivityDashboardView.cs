using System;
using System.Drawing;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ChromeGridApp
{
    // The one-screen activity dashboard. Farm map selection starts the matching
    // Auto quái workflow; the remaining proposed activities stay display-only.
    internal sealed class ActivityDashboardView : UserControl
    {
        private readonly DataGridView grid = new DataGridView();
        private readonly Label status = new Label();
        private readonly ComboBox farmZone = new ComboBox();
        private readonly ComboBox farmMode = new ComboBox();
        private readonly CheckBox autoFarm = new CheckBox { Text = "Farm khi rảnh (TuTienBot)", AutoSize = true, Checked = false, Margin = new Padding(4, 7, 9, 0) };
        private readonly CheckBox autoTotal = new CheckBox { Text = "Auto tổng", AutoSize = true, Checked = false, Margin = new Padding(6, 8, 6, 0) };
        private string[][] latestSnapshots;
        private int profileCount;
        private bool syncingActiveMode;
        private bool autoModeManualOverride;
        private int autoModeProfile;
        private string previousAutoScript = "";
        public event Action AddAccountRequested;
        public event Action<int> DeleteAccountRequested;
        public event Action<int> OpenProfileRequested;
        public event Action<int> CloseProfileRequested;
        public event Action<int> StartAutoTotalRequested;
        public event Action<int, string> StartAutoFarmRequested;
        public event Action<int> StopBotRequested;
        public event Action JournalRequested;

        public ActivityDashboardView()
        {
            BackColor = SystemColors.Control;
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 9, Padding = new Padding(10) };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 48));
            for (int i = 0; i < 5; i++) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(layout);

            var title = new Label { Text = "QUẢN LÝ HOẠT ĐỘNG TU TIÊN 2D", AutoSize = true, Font = new Font("Segoe UI", 12F, FontStyle.Bold), Margin = new Padding(2, 0, 0, 7) };
            layout.Controls.Add(title, 0, 0);

            ConfigureGrid();
            layout.Controls.Add(grid, 0, 1);

            layout.Controls.Add(Band("Bí cảnh",
                Check("Bí cảnh tổ đội (làm trước)", false),
                Check("Yên Lãng Sơn", false),
                Check("Huyết Xích Cấm Địa", false),
                Label("Tổ trưởng:"), LeaderChoice(),
                Check("Vận Tiêu 6 chuyến (sau bí cảnh)", false)), 0, 2);

            layout.Controls.Add(Band("Săn boss và sự kiện",
                Check("Săn boss (4 boss + Giao Long tối CN; tới giờ thì ưu tiên)", false),
                Check("Săn Thương Đội khi Thiên Đạo báo", false),
                Check("Hiện khung thông báo trong game (Ctrl+Shift+H)", false)), 0, 3);

            farmMode.DropDownStyle = ComboBoxStyle.DropDownList; farmMode.Width = 395;
            farmMode.Items.Add(new FarmMapOption("", "Map: Tự động")); farmMode.SelectedIndex = 0;
            farmZone.DropDownStyle = ComboBoxStyle.DropDownList; farmZone.Width = 180; farmZone.Enabled = false;
            farmZone.Items.Add("Chưa có dữ liệu khu"); farmZone.SelectedIndex = 0;
            layout.Controls.Add(Band("Farm tự động",
                autoFarm,
                Label("Chế độ:"), farmMode,
                new RadioButton { Text = "Riêng lẻ", AutoSize = true, Margin = new Padding(8, 7, 2, 0) },
                new RadioButton { Text = "Tổ đội (theo Tổ trưởng)", AutoSize = true, Margin = new Padding(3, 7, 4, 0) },
                Label("Khu vực:"), farmZone), 0, 4);

            var members = new NumericUpDown { Minimum = 1, Maximum = 20, Value = 6, Width = 55, TextAlign = HorizontalAlignment.Center };
            var teamHelp = new Label {
                Text = "Chia đội theo thứ tự tài khoản; chọn Tổ trưởng trong hàng Bí cảnh. Bot ưu tiên theo thứ tự hoạt động đã ghi bên dưới.",
                AutoSize = false, Width = 390, Height = 34, TextAlign = ContentAlignment.MiddleLeft,
                Font = new Font("Segoe UI", 8F), Margin = new Padding(12, 0, 0, 0)
            };
            layout.Controls.Add(Band("Tổ đội và Tông môn",
                Check("Cho phép Sát Nghiệp từ 20 (tên đỏ)", false),
                Label("Số người/đội:"), members,
                Check("Làm Lăng khí Tông môn mở (ưu tiên)", false), teamHelp), 0, 5);

            var gate = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 115 };
            gate.Items.Add("Kim Môn"); gate.SelectedIndex = 0;
            layout.Controls.Add(Band("Vết Nứt Không Gian",
                Check("Vết Nứt Không Gian (22:00) – đi lẻ", false),
                Label("Cổng:"), gate,
                Check("Đi độc lập (không lập tổ đội)", false)), 0, 6);

            autoTotal.Enabled = true;
            autoTotal.CheckedChanged += delegate { if (!syncingActiveMode) autoModeManualOverride = true; };
            autoFarm.CheckedChanged += delegate { if (!syncingActiveMode) autoModeManualOverride = true; };
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = false, AutoScroll = true, Margin = new Padding(0, 7, 0, 4) };
            buttons.Controls.Add(autoTotal);
            AddButton(buttons, "▶ Bắt đầu", 108);
            AddButton(buttons, "■ Dừng bot", 108);
            AddButton(buttons, "Mở Chrome", 108);
            AddButton(buttons, "Đóng Chrome", 108);
            AddButton(buttons, "Thêm acc", 90);
            AddButton(buttons, "Xóa acc", 90);
            var journalButton = new Button { Text = "Nh\u1eadt k\u00fd...", Width = 95, Height = 31, Margin = new Padding(3, 1, 3, 1), UseVisualStyleBackColor = true };
            journalButton.Click += delegate { if (JournalRequested != null) JournalRequested(); };
            buttons.Controls.Add(journalButton);
            AddButton(buttons, "Nhập nhiều acc...", 130);
            layout.Controls.Add(buttons, 0, 7);

            status.AutoSize = true;
            status.MaximumSize = new Size(1400, 0);
            status.Margin = new Padding(2, 5, 0, 0);
            status.Text = "Chọn Farm khi rảnh để chạy Auto quái theo map. Các mục hoạt động khác đang là tùy chọn giao diện.";
            layout.Controls.Add(status, 0, 8);
        }

        private void ConfigureGrid()
        {
            grid.Dock = DockStyle.Fill;
            grid.ReadOnly = true;
            grid.AllowUserToAddRows = false;
            grid.AllowUserToDeleteRows = false;
            grid.RowHeadersVisible = false;
            grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
            grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.MultiSelect = false;
            grid.SelectionChanged += delegate { UpdateFarmZoneChoice(); UpdateFarmMapChoices(); UpdateAutoTotalStatus(); };
            grid.CellDoubleClick += delegate { RequestOpenSelectedProfile(); };
            grid.BackgroundColor = SystemColors.Window;
            grid.Columns.Add("profile", "Profile");
            grid.Columns.Add("account", "Tài khoản");
            grid.Columns.Add("character", "Tên nhân vật");
            grid.Columns.Add("realm", "Cảnh giới");
            grid.Columns.Add("farm", "Trạng thái farm");
            grid.Columns.Add("stoneBalance", "Linh Thạch hiện tại");
            grid.Columns.Add("stoneDay", "Linh Thạch hôm nay / giới hạn");
            grid.Columns["stoneDay"].ToolTipText = "Tiến độ Linh Thạch game tính trong ngày so với giới hạn rơi.";
            grid.Columns.Add("activity", "Trạng thái hoạt động");
            grid.Columns["profile"].FillWeight = 55;
            grid.Columns["account"].FillWeight = 100;
            grid.Columns["character"].FillWeight = 110;
            grid.Columns["realm"].FillWeight = 105;
            grid.Columns["farm"].FillWeight = 165;
            grid.Columns["stoneBalance"].FillWeight = 85;
            grid.Columns["stoneDay"].FillWeight = 120;
            grid.Columns["activity"].FillWeight = 180;
            grid.RowTemplate.Height = 25;
            for (int i = 1; i <= 20; i++)
            {
                int row = grid.Rows.Add("Profile" + i.ToString("00"), "—", "—", "—", "Chưa có dữ liệu", "—", "—", "Chưa kết nối");
                grid.Rows[row].Visible = i <= profileCount;
            }
        }

        private GroupBox Band(string title, params Control[] controls)
        {
            var group = new GroupBox { Text = title, Dock = DockStyle.Fill, Padding = new Padding(7, 3, 7, 2), Margin = new Padding(0, 1, 0, 1) };
            var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, AutoScroll = true, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0) };
            foreach (var control in controls) flow.Controls.Add(control);
            group.Controls.Add(flow);
            return group;
        }

        private static CheckBox Check(string text, bool isChecked)
        {
            return new CheckBox { Text = text, Checked = isChecked, AutoSize = true, Margin = new Padding(4, 7, 9, 0) };
        }

        private static Label Label(string text)
        {
            return new Label { Text = text, AutoSize = true, Margin = new Padding(5, 8, 2, 0) };
        }

        private static ComboBox LeaderChoice()
        {
            var leader = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 125 };
            leader.Items.Add("Chọn tổ trưởng");
            for (int i = 1; i <= 20; i++) leader.Items.Add("Profile" + i.ToString("00"));
            leader.SelectedIndex = 0;
            return leader;
        }

        private void AddButton(FlowLayoutPanel row, string text, int width)
        {
            var button = new Button { Text = text, Width = width, Height = 31, Margin = new Padding(3, 1, 3, 1), UseVisualStyleBackColor = true };
            if (text == "Thêm acc") button.Click += delegate { if (AddAccountRequested != null) AddAccountRequested(); };
            else if (text == "▶ Bắt đầu") button.Click += delegate { RequestStartStage(); };
            else if (text == "Mở Chrome") button.Click += delegate { RequestOpenSelectedProfile(); };
            else if (text == "Đóng Chrome") button.Click += delegate { RequestCloseSelectedProfile(); };
            else if (text == "Xóa acc") button.Click += delegate {
                int profile = SelectedProfile();
                if (profile < 1) { status.Text = "Chọn profile có acc cần xóa trước."; return; }
                if (DeleteAccountRequested != null) DeleteAccountRequested(profile);
            };
            else if (text.Contains("bot")) button.Click += delegate { RequestStopBot(); };
            else button.Click += delegate { status.Text = "Bản xem trước giao diện · Nút “" + text + "” chưa được nối với thao tác game."; };
            row.Controls.Add(button);
        }

        private int SelectedProfile()
        {
            if (grid.CurrentRow == null) return 0;
            int profile;
            return int.TryParse(Convert.ToString(grid.CurrentRow.Cells["profile"].Value).Replace("Profile", ""), out profile) ? profile : 0;
        }

        private void RequestOpenSelectedProfile()
        {
            int profile = SelectedProfile();
            if (profile < 1) { status.Text = "Chọn profile cần mở Chrome trước."; return; }
            if (OpenProfileRequested != null) OpenProfileRequested(profile);
        }

        private void RequestCloseSelectedProfile()
        {
            int profile = SelectedProfile();
            if (profile < 1) { status.Text = "Chọn profile cần đóng Chrome trước."; return; }
            if (CloseProfileRequested != null) CloseProfileRequested(profile);
        }

        private void RequestStartStage()
        {
            int profile = SelectedProfile();
            if (profile < 1) { status.Text = "Chọn profile cần chạy trước."; return; }
            if (autoFarm.Checked)
            {
                var option = farmMode.SelectedItem as FarmMapOption;
                if (StartAutoFarmRequested != null) StartAutoFarmRequested(profile, option == null ? "" : option.Id);
                return;
            }
            if (StartAutoTotalRequested != null) StartAutoTotalRequested(profile);
        }

        private sealed class FarmMapOption
        {
            public readonly string Id, Name;
            public FarmMapOption(string id, string name) { Id = id; Name = name; }
            public override string ToString() { return Name; }
        }

        private void UpdateFarmMapChoices()
        {
            if (farmMode.IsDisposed) return;
            int profile = SelectedProfile();
            string[] row = latestSnapshots != null && profile > 0 && profile <= latestSnapshots.Length ? latestSnapshots[profile - 1] : null;
            string json = row != null && row.Length > 19 ? row[19] : "";
            var maps = new List<FarmMapOption>();
            try
            {
                var values = new JavaScriptSerializer().DeserializeObject(json) as object[];
                foreach (var value in values ?? new object[0])
                {
                    var item = value as Dictionary<string, object>;
                    if (item == null || !item.ContainsKey("id") || !item.ContainsKey("name")) continue;
                    string id = Convert.ToString(item["id"]), name = Convert.ToString(item["name"]);
                    if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
                    string label = id == "mo_linh_thach"
                        ? "Mỏ Linh Thạch – Thạch Ma + đào tinh thạch (tránh boss)"
                        : name + " – Auto đánh quái farm Linh Thạch";
                    maps.Add(new FarmMapOption(id, label));
                }
            }
            catch (Exception) { }
            maps = maps.OrderBy(x => x.Name).ToList();
            var selected = farmMode.SelectedItem as FarmMapOption;
            string current = selected == null ? "" : selected.Id;
            farmMode.BeginUpdate();
            try
            {
                farmMode.Items.Clear();
                farmMode.Items.Add(new FarmMapOption("", maps.Count == 0 ? "Map: Tự động (chờ profile vào game)" : "Map: Tự động"));
                foreach (var map in maps) farmMode.Items.Add(map);
                int index = -1;
                for (int i = 1; i < farmMode.Items.Count; i++) if (((FarmMapOption)farmMode.Items[i]).Id == current) { index = i; break; }
                farmMode.SelectedIndex = index >= 0 ? index : 0;
            }
            finally { farmMode.EndUpdate(); }
        }

        private void RequestStopBot()
        {
            int profile = SelectedProfile();
            if (profile < 1) { status.Text = "Ch\u1ecdn profile c\u1ea7n d\u1eebng bot tr\u01b0\u1edbc."; return; }
            if (StopBotRequested != null) StopBotRequested(profile);
        }
        public void SetProfileCount(int count)
        {
            if (count < 0 || count > 20) return;
            profileCount = count;
            for (int i = 0; i < grid.Rows.Count; i++) grid.Rows[i].Visible = i < count;
        }

        public void SetSnapshots(string[][] snapshots)
        {
            if (IsDisposed || snapshots == null) return;
            if (InvokeRequired) { BeginInvoke((MethodInvoker)delegate { SetSnapshots(snapshots); }); return; }
            latestSnapshots = snapshots;
            int limit = Math.Min(Math.Min(profileCount, snapshots.Length), grid.Rows.Count);
            for (int i = 0; i < limit; i++)
            {
                string[] row = snapshots[i];
                if (row == null) continue;
                string active = row.Length > 3 ? row[3] : "Chưa có dữ liệu";
                string script = row.Length > 16 ? row[16] : "";
                string farm = script.IndexOf("quái", StringComparison.OrdinalIgnoreCase) >= 0 ? active : "—";
                grid.Rows[i].Cells["character"].Value = row.Length > 8 ? row[8] : "—";
                grid.Rows[i].Cells["realm"].Value = row.Length > 0 ? row[0] : "—";
                grid.Rows[i].Cells["farm"].Value = farm;
                grid.Rows[i].Cells["stoneBalance"].Value = row.Length > 21 ? FormatStoneBalance(row[21]) : "—";
                grid.Rows[i].Cells["stoneDay"].Value = row.Length > 18 && !string.IsNullOrWhiteSpace(row[18]) ? row[18] : "—";
                grid.Rows[i].Cells["activity"].Value = active;
            }
            UpdateFarmZoneChoice();
            UpdateFarmMapChoices();
            UpdateAutoTotalStatus();
        }

        private void UpdateAutoTotalStatus()
        {
            int profile = SelectedProfile();
            if (profile < 1 || profile > 20) return;
            bool changedProfile = profile != autoModeProfile;
            string[] row = latestSnapshots != null && profile <= latestSnapshots.Length ? latestSnapshots[profile - 1] : null;
            string active = row != null && row.Length > 16 ? row[16] : "";
            string activity = row != null && row.Length > 3 ? row[3] : "";
            bool mainWorkflow = new[] { "automation:", "intro:", "quests:", "garden:", "navigation:" }
                .Any(prefix => activity.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            bool farmWorkflow = activity.StartsWith("Auto quái:", StringComparison.OrdinalIgnoreCase) || active == "stone" || active == "both";
            bool mainActive = active == "main" || active == "both" || mainWorkflow;
            string actual = mainActive && farmWorkflow ? "both" : mainActive ? "main" : farmWorkflow ? "stone" : "";

            if (changedProfile)
            {
                autoModeProfile = profile;
                autoModeManualOverride = false;
            }
            if (actual.Length > 0)
            {
                autoModeManualOverride = false;
                SetAutomationChecks(mainActive, farmWorkflow);
            }
            else if (changedProfile || (previousAutoScript.Length > 0 && !autoModeManualOverride))
            {
                SetAutomationChecks(false, false);
                autoModeManualOverride = false;
            }
            previousAutoScript = actual;
        }

        private void SetAutomationChecks(bool total, bool farm)
        {
            syncingActiveMode = true;
            try { autoTotal.Checked = total; autoFarm.Checked = farm; }
            finally { syncingActiveMode = false; }
        }

        private static string FormatStoneBalance(string value)
        {
            long count;
            return long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out count)
                ? count.ToString("N0", CultureInfo.CurrentCulture)
                : string.IsNullOrWhiteSpace(value) ? "—" : value;
        }

        private void UpdateFarmZoneChoice()
        {
            if (farmZone.IsDisposed) return;
            int index = grid.CurrentRow == null ? 0 : grid.CurrentRow.Index;
            string[] row = latestSnapshots != null && index >= 0 && index < latestSnapshots.Length ? latestSnapshots[index] : null;
            int count = 0;
            if (row != null && row.Length > 25) int.TryParse(row[25], out count);
            farmZone.BeginUpdate();
            try
            {
                farmZone.Items.Clear();
                if (count < 1)
                {
                    farmZone.Items.Add("Chưa có dữ liệu khu"); farmZone.SelectedIndex = 0; farmZone.Enabled = false;
                    return;
                }
                farmZone.Enabled = true;
                farmZone.Items.Add("Tự động");
                for (int i = 1; i <= Math.Min(30, count); i++) farmZone.Items.Add("Khu " + i);
                int preferred;
                farmZone.SelectedIndex = row.Length > 26 && int.TryParse(row[26], out preferred) && preferred >= 1 && preferred <= count ? preferred : 0;
            }
            finally { farmZone.EndUpdate(); }
        }

        public void SetAccounts(System.Collections.Generic.IEnumerable<AccountEntry> accounts)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { BeginInvoke((MethodInvoker)delegate { SetAccounts(accounts); }); return; }
            var byProfile = (accounts ?? Enumerable.Empty<AccountEntry>()).ToDictionary(x => x.Profile, x => x);
            for (int i = 0; i < grid.Rows.Count; i++)
            {
                AccountEntry entry;
                grid.Rows[i].Cells["account"].Value = byProfile.TryGetValue(i + 1, out entry) ? entry.Username : "—";
            }
        }

        public void SetStatus(string message)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { BeginInvoke((MethodInvoker)delegate { SetStatus(message); }); return; }
            status.Text = message;
        }
    }
}
