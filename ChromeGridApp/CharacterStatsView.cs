using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ChromeGridApp
{
    internal sealed class CharacterRecord
    {
        public string Name { get; set; }
        public string Profile { get; set; }
        public string Realm { get; set; }
        public string Hp { get; set; }
        public string Stage { get; set; }
        public string Map { get; set; }
        public string Position { get; set; }
        public string Auto { get; set; }
        public string LastSeenUtc { get; set; }
        public bool Online { get; set; }
        public string StoneBalance { get; set; }
        public string StoneEarnedToday { get; set; }
        public string StoneEarnedDayKey { get; set; }
        public bool VBP { get; set; }
        public bool Sale { get; set; }
        public bool DateDone { get; set; }
        public bool Deleted { get; set; }
    }

    internal sealed class CharacterStatsView : UserControl
    {
        private readonly string file;
        private readonly string passwordFile;
        private readonly Dictionary<string, CharacterRecord> records = new Dictionary<string, CharacterRecord>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> passwords = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly string[] candidates = new string[20];
        private readonly int[] observations = new int[20];
        private readonly DataGridView grid = new DataGridView();
        private readonly Label status = new Label();
        private readonly Label stoneSummary = new Label();
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private bool canSave = true;
        private bool rendering;
        private string passwordError;
        public event Action DateDoneChanged;

        public CharacterStatsView() : this(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TuTienChromeGrid", "characters.json")) { }
        internal CharacterStatsView(string path)
        {
            file = path;
            passwordFile = Path.Combine(Path.GetDirectoryName(file), "account-passwords.dat");
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, Padding = new Padding(12) };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); Controls.Add(layout);
            var note = new Label { AutoSize = true, MaximumSize = new Size(720, 0), Text = "Chọn ô tên nhân vật hoặc mật khẩu rồi nhấn Ctrl+C, hoặc bấm chuột phải để sao chép. Nhấp đúp ô mật khẩu để nhập hoặc sửa, nhấn Enter để lưu. Bản ghi vẫn còn sau khi đăng xuất." };
            layout.Controls.Add(note, 0, 0);
            status.AutoSize = true; status.Margin = new Padding(0, 8, 0, 8); layout.Controls.Add(status, 0, 1);
            stoneSummary.AutoSize = true; stoneSummary.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold); stoneSummary.Margin = new Padding(0, 0, 0, 8); layout.Controls.Add(stoneSummary, 0, 2);
            var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 6) };
            var delete = new Button { Text = "Xóa nhân vật đã chọn", AutoSize = true };
            var restore = new Button { Text = "Cho phép ghi lại nhân vật đã xóa", AutoSize = true };
            delete.Click += delegate { DeleteSelected(); };
            restore.Click += delegate { AllowDeletedCharacters(); };
            actions.Controls.Add(delete); actions.Controls.Add(restore); layout.Controls.Add(actions, 0, 3);
            grid.Dock = DockStyle.Fill; grid.ReadOnly = false; grid.AllowUserToAddRows = false; grid.AllowUserToDeleteRows = false; grid.RowHeadersVisible = false;
            grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill; grid.SelectionMode = DataGridViewSelectionMode.CellSelect; grid.ClipboardCopyMode = DataGridViewClipboardCopyMode.EnableWithoutHeaderText; grid.MultiSelect = false;
            grid.Columns.Add("number", "STT"); grid.Columns.Add("profile", "Profile"); grid.Columns.Add("online", "Online"); grid.Columns.Add("name", "Tên nhân vật"); grid.Columns.Add("stoneBalance", "Linh Thạch đang có"); grid.Columns.Add("stoneEarnedToday", "Linh Thạch kiếm hôm nay"); grid.Columns.Add("password", "Mật khẩu"); grid.Columns.Add("realm", "Cảnh giới");
            grid.Columns.Add(new DataGridViewCheckBoxColumn { Name = "vbp", HeaderText = "VBP", ThreeState = false, FalseValue = false, TrueValue = true });
            grid.Columns.Add(new DataGridViewCheckBoxColumn { Name = "sale", HeaderText = "Sale", ThreeState = false, FalseValue = false, TrueValue = true });
            grid.Columns.Add(new DataGridViewCheckBoxColumn { Name = "dateDone", HeaderText = "Date Done", ThreeState = false, FalseValue = false, TrueValue = true });
            grid.DefaultCellStyle.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold);
            var realmRegular = new Font("Segoe UI", 10.5f, FontStyle.Regular);
            var realmBold = new Font("Segoe UI", 10.5f, FontStyle.Bold);
            grid.Columns["realm"].DefaultCellStyle.Font = realmRegular;
            grid.CellPainting += delegate(object sender, DataGridViewCellPaintingEventArgs e) {
                if (e.RowIndex < 0 || e.ColumnIndex != grid.Columns["realm"].Index) return;
                e.Paint(e.ClipBounds, DataGridViewPaintParts.All & ~DataGridViewPaintParts.ContentForeground);
                string value = Convert.ToString(e.FormattedValue) ?? "";
                var flags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.PreserveGraphicsClipping;
                Color color = (e.State & DataGridViewElementStates.Selected) != 0 ? e.CellStyle.SelectionForeColor : e.CellStyle.ForeColor;
                var saved = e.Graphics.Save();
                try {
                    e.Graphics.SetClip(Rectangle.Inflate(e.CellBounds, -1, -1), System.Drawing.Drawing2D.CombineMode.Intersect);
                    int x = e.CellBounds.Left + 3 + e.CellStyle.Padding.Left;
                    foreach (Match part in Regex.Matches(value, @"\d+|\D+")) {
                        var font = char.IsDigit(part.Value[0]) ? realmBold : realmRegular;
                        int width = TextRenderer.MeasureText(e.Graphics, part.Value, font, new Size(int.MaxValue, int.MaxValue), flags).Width;
                        TextRenderer.DrawText(e.Graphics, part.Value, font, new Rectangle(x, e.CellBounds.Top, width, e.CellBounds.Height), color, flags);
                        x += width;
                    }
                } finally { e.Graphics.Restore(saved); }
                e.Handled = true;
            };
            Disposed += delegate { realmRegular.Dispose(); realmBold.Dispose(); };
            grid.RowTemplate.Height = 30;
            grid.Columns["number"].FillWeight = 45; grid.Columns["profile"].FillWeight = 75; grid.Columns["online"].FillWeight = 90; grid.Columns["name"].FillWeight = 135; grid.Columns["stoneBalance"].FillWeight = 95; grid.Columns["stoneEarnedToday"].FillWeight = 105;
            grid.Columns["password"].FillWeight = 135; grid.Columns["realm"].FillWeight = 135;
            grid.Columns["vbp"].FillWeight = 55; grid.Columns["sale"].FillWeight = 55; grid.Columns["dateDone"].FillWeight = 85;
            foreach (DataGridViewColumn column in grid.Columns) {
                column.HeaderText = column.HeaderText.ToUpperInvariant();
                column.ReadOnly = column.Name != "password" && column.Name != "vbp" && column.Name != "sale" && column.Name != "dateDone";
                column.SortMode = DataGridViewColumnSortMode.NotSortable;
            }
            grid.EditMode = DataGridViewEditMode.EditOnKeystrokeOrF2;
            var copyMenu = new ContextMenuStrip();
            copyMenu.Items.Add("Sao chép tên nhân vật", null, delegate { CopyCurrentCell("name"); });
            copyMenu.Items.Add("Sao chép mật khẩu", null, delegate { CopyCurrentCell("password"); });
            grid.ContextMenuStrip = copyMenu;
            grid.CellMouseDown += delegate(object sender, DataGridViewCellMouseEventArgs e) {
                if (e.Button == MouseButtons.Right && e.RowIndex >= 0 && e.ColumnIndex >= 0) grid.CurrentCell = grid.Rows[e.RowIndex].Cells[e.ColumnIndex];
            };
            grid.CellEndEdit += PasswordEdited;
            grid.CurrentCellDirtyStateChanged += delegate { if (grid.IsCurrentCellDirty && grid.CurrentCell is DataGridViewCheckBoxCell) grid.CommitEdit(DataGridViewDataErrorContexts.Commit); };
            grid.CellValueChanged += FlagEdited;
            layout.Controls.Add(grid, 0, 4);
            try {
                if (File.Exists(passwordFile)) {
                    byte[] protectedData = File.ReadAllBytes(passwordFile);
                    string json = Encoding.UTF8.GetString(ProtectedData.Unprotect(protectedData, null, DataProtectionScope.CurrentUser));
                    var loaded = serializer.Deserialize<Dictionary<string, string>>(json);
                    if (loaded != null) foreach (var pair in loaded) if (Valid(pair.Key)) passwords[pair.Key] = pair.Value;
                }
            } catch (Exception error) { passwordError = error.Message; }
            try {
                if (File.Exists(file)) {
                    var data = serializer.Deserialize<List<CharacterRecord>>(File.ReadAllText(file, Encoding.UTF8));
                    if (data != null) foreach (var row in data) if (row != null && Valid(row.Name)) records[row.Name] = row;
                }
                Render();
                if (passwordError != null) status.Text = "Không đọc được mật khẩu: " + passwordError;
            } catch (Exception error) { canSave = false; status.Text = "Không đọc được thống kê; dữ liệu cũ được giữ lại: " + error.Message; }
        }

        private static bool Valid(string s) { return !string.IsNullOrWhiteSpace(s) && s.Trim() != "—"; }
        private static string Keep(string previous, string next) { return Valid(next) ? next.Trim() : previous; }

        private static int RealmRank(string realm)
        {
            if (!Valid(realm)) return -1;
            realm = realm.Trim();
            if (realm.StartsWith("Phàm Nhân", StringComparison.OrdinalIgnoreCase)) return 0;
            if (realm.StartsWith("Luyện Khí", StringComparison.OrdinalIgnoreCase)) {
                var match = Regex.Match(realm, @"\d+"); int level;
                return match.Success && int.TryParse(match.Value, out level) && level >= 1 && level <= 13 ? 100 + level : -1;
            }
            if (realm.StartsWith("Trúc Cơ", StringComparison.OrdinalIgnoreCase)) {
                if (realm.IndexOf("Sơ Kỳ", StringComparison.OrdinalIgnoreCase) >= 0) return 201;
                if (realm.IndexOf("Trung Kỳ", StringComparison.OrdinalIgnoreCase) >= 0) return 202;
                if (realm.IndexOf("Hậu Kỳ", StringComparison.OrdinalIgnoreCase) >= 0) return 203;
                return -1;
            }
            if (realm.StartsWith("Giả Đan", StringComparison.OrdinalIgnoreCase)) return 300;
            if (realm.StartsWith("Kết Đan Sơ Kỳ", StringComparison.OrdinalIgnoreCase)) return 401;
            return -1;
        }

        public void Observe(string[][] rows)
        {
            if (rows == null) return;
            bool changed = false;
            foreach (var record in records.Values) if (record.Online) { record.Online = false; changed = true; }
            for (int i = 0; i < Math.Min(rows.Length, 20); i++)
            {
                var row = rows[i];
                string name = row != null && row.Length > 8 && Valid(row[8]) ? row[8].Trim() : null;
                if (name == null) { candidates[i] = null; observations[i] = 0; continue; }
                if (!string.Equals(candidates[i], name, StringComparison.OrdinalIgnoreCase)) { candidates[i] = name; observations[i] = 1; continue; }
                if (++observations[i] < 2) continue;
                CharacterRecord record;
                if (!records.TryGetValue(name, out record)) { record = new CharacterRecord { Name = name }; records.Add(name, record); }
                if (record.Deleted) continue;
                if (!record.Online) { record.Online = true; changed = true; }
                record.Name = name; record.Profile = "Profile" + (i + 1).ToString("00");
                record.Realm = Keep(record.Realm, row[0]); record.Hp = Keep(record.Hp, row[1]); record.Stage = Keep(record.Stage, row[2]);
                record.Auto = Keep(record.Auto, row[3]); record.Map = Keep(record.Map, row[5]); record.Position = Keep(record.Position, row[6]);
                if (row.Length > 21 && Valid(row[21])) record.StoneBalance = row[21];
                if (row.Length > 23 && Valid(row[22]) && Valid(row[23])) {
                    record.StoneEarnedToday = row[22];
                    record.StoneEarnedDayKey = row[23];
                }
                record.LastSeenUtc = DateTime.UtcNow.ToString("o"); changed = true;
            }
            if (!changed) return;
            if (!canSave) return;
            try { Save(); if (!grid.IsCurrentCellInEditMode) Render(); }
            catch (Exception error) { status.Text = "Không lưu được thống kê: " + error.Message; }
        }

        private void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            string temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                File.WriteAllText(temp, serializer.Serialize(records.Values.ToArray()), new UTF8Encoding(false));
                if (File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
            } finally { if (File.Exists(temp)) File.Delete(temp); }
        }

        private void CopyCurrentCell(string columnName)
        {
            if (grid.CurrentRow == null || !grid.Columns.Contains(columnName)) return;
            string value = Convert.ToString(grid.CurrentRow.Cells[columnName].Value);
            if (string.IsNullOrWhiteSpace(value)) { status.Text = "Ô đang chọn không có dữ liệu để sao chép."; return; }
            try { Clipboard.SetText(value); status.Text = "Đã sao chép " + (columnName == "name" ? "tên nhân vật." : "mật khẩu."); }
            catch (Exception error) { status.Text = "Không sao chép được: " + error.Message; }
        }

        private void DeleteSelected()
        {
            if (grid.CurrentRow == null) { status.Text = "Chọn nhân vật cần xóa."; return; }
            grid.EndEdit();
            string name = Convert.ToString(grid.CurrentRow.Cells["name"].Value);
            CharacterRecord original;
            if (!Valid(name) || !records.TryGetValue(name, out original) || original.Deleted) { status.Text = "Không tìm thấy nhân vật cần xóa."; return; }
            if (!canSave) { status.Text = "Không đọc được dữ liệu thống kê cũ; không thể xóa."; return; }
            try {
                records[name] = new CharacterRecord { Name = original.Name, Deleted = true };
                Save();
            } catch (Exception error) { records[name] = original; status.Text = "Không xóa được nhân vật: " + error.Message; return; }
            Render();
            status.Text = "Đã xóa " + name + " khỏi thống kê. Mật khẩu lưu riêng vẫn được giữ.";
            if (DateDoneChanged != null) DateDoneChanged();
        }

        private void AllowDeletedCharacters()
        {
            if (!canSave) { status.Text = "Không đọc được dữ liệu thống kê cũ; không thể thay đổi."; return; }
            var removed = records.Where(pair => pair.Value.Deleted).ToArray();
            if (removed.Length == 0) { status.Text = "Không có nhân vật đã xóa cần cho phép ghi lại."; return; }
            try {
                foreach (var pair in removed) records.Remove(pair.Key);
                Save();
            } catch (Exception error) {
                foreach (var pair in removed) records[pair.Key] = pair.Value;
                status.Text = "Không thể thay đổi danh sách: " + error.Message; return;
            }
            Render();
            status.Text = "Đã cho phép ghi lại. Nhân vật đang mở sẽ được ghi lại sau khi cập nhật.";
        }

        private void PasswordEdited(object sender, DataGridViewCellEventArgs e)
        {
            if (e.RowIndex < 0 || grid.Columns[e.ColumnIndex].Name != "password") return;
            var row = grid.Rows[e.RowIndex];
            string name = Convert.ToString(row.Cells["name"].Value);
            if (!Valid(name)) return;
            string previous; bool hadPrevious = passwords.TryGetValue(name, out previous);
            try {
                if (passwordError != null) throw new InvalidOperationException("Không đọc được dữ liệu mật khẩu cũ; không thể ghi đè.");
                string value = Convert.ToString(row.Cells["password"].Value) ?? "";
                if (value.Length == 0) passwords.Remove(name); else passwords[name] = value;
                Directory.CreateDirectory(Path.GetDirectoryName(passwordFile));
                byte[] plain = Encoding.UTF8.GetBytes(serializer.Serialize(passwords));
                byte[] encrypted = ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser);
                string temp = passwordFile + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try { File.WriteAllBytes(temp, encrypted); if (File.Exists(passwordFile)) File.Replace(temp, passwordFile, null); else File.Move(temp, passwordFile); }
                finally { if (File.Exists(temp)) File.Delete(temp); }
                status.Text = "Đã lưu mật khẩu cho " + name + ".";
            } catch (Exception error) {
                if (hadPrevious) passwords[name] = previous; else passwords.Remove(name);
                row.Cells["password"].Value = hadPrevious ? previous : "";
                status.Text = "Không lưu được mật khẩu: " + error.Message;
            }
        }

        private void FlagEdited(object sender, DataGridViewCellEventArgs e)
        {
            if (rendering || e.RowIndex < 0 || e.ColumnIndex < 0) return;
            string column = grid.Columns[e.ColumnIndex].Name;
            if (column != "vbp" && column != "sale" && column != "dateDone") return;
            var row = grid.Rows[e.RowIndex];
            string name = Convert.ToString(row.Cells["name"].Value);
            CharacterRecord record;
            if (!Valid(name) || !records.TryGetValue(name, out record)) return;
            bool previous = column == "vbp" ? record.VBP : column == "sale" ? record.Sale : record.DateDone;
            bool value = row.Cells[column].Value is bool && (bool)row.Cells[column].Value;
            if (previous == value) return;
            try {
                if (!canSave) throw new InvalidOperationException("Không đọc được dữ liệu cũ; không thể ghi đè.");
                if (column == "vbp") record.VBP = value; else if (column == "sale") record.Sale = value; else record.DateDone = value;
                Save(); status.Text = "Đã lưu " + grid.Columns[e.ColumnIndex].HeaderText + " cho " + name + ".";
                if (column == "dateDone" && DateDoneChanged != null) DateDoneChanged();
            } catch (Exception error) {
                if (column == "vbp") record.VBP = previous; else if (column == "sale") record.Sale = previous; else record.DateDone = previous;
                rendering = true; try { row.Cells[column].Value = previous; } finally { rendering = false; }
                status.Text = "Không lưu được lựa chọn: " + error.Message;
            }
        }

        public bool? GetDateDone(string name)
        {
            CharacterRecord record;
            return Valid(name) && records.TryGetValue(name, out record) && !record.Deleted ? (bool?)record.DateDone : null;
        }

        public string LastCharacterForProfile(int number)
        {
            string profile = "Profile" + number.ToString("00");
            var record = records.Values.Where(r => !r.Deleted && string.Equals(r.Profile, profile, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(r => r.LastSeenUtc).FirstOrDefault();
            return record == null ? null : record.Name;
        }

        public bool SetDateDone(string name, bool value, out string message)
        {
            CharacterRecord record;
            if (!Valid(name) || !records.TryGetValue(name, out record) || record.Deleted) { message = "Chưa có nhân vật này trong thống kê; chờ dữ liệu cập nhật."; return false; }
            if (!canSave) { message = "Không đọc được dữ liệu thống kê cũ; không thể lưu."; return false; }
            bool previous = record.DateDone;
            try {
                record.DateDone = value;
                Save();
            } catch (Exception error) {
                record.DateDone = previous;
                message = "Không lưu được Date Done: " + error.Message;
                return false;
            }
            if (!grid.IsCurrentCellInEditMode) Render();
            message = value ? "Đã đánh dấu Date Done cho " + name + "." : "Đã bỏ Date Done cho " + name + ".";
            status.Text = message;
            if (DateDoneChanged != null) DateDoneChanged();
            return true;
        }

        private void Render()
        {
            string selectedName = grid.CurrentRow == null ? null : Convert.ToString(grid.CurrentRow.Cells["name"].Value);
            var visibleRecords = records.Values.Where(r => !r.Deleted).ToList();
            long totalStones = 0, vbpStones = 0, nonVbpStones = 0;
            int withBalance = 0, vbpWithBalance = 0, nonVbpWithBalance = 0;
            foreach (var record in visibleRecords)
            {
                long amount;
                if (!long.TryParse(record.StoneBalance, out amount) || amount < 0) continue;
                totalStones += amount; withBalance++;
                if (record.VBP) { vbpStones += amount; vbpWithBalance++; }
                else { nonVbpStones += amount; nonVbpWithBalance++; }
            }
            stoneSummary.Text = "Linh Thạch đang có — Tổng: " + FormatStoneBalance(totalStones) +
                " · VBP: " + FormatStoneBalance(vbpStones) + " (" + vbpWithBalance + "/" + visibleRecords.Count(r => r.VBP) + ")" +
                " · Chưa VBP: " + FormatStoneBalance(nonVbpStones) + " (" + nonVbpWithBalance + "/" + visibleRecords.Count(r => !r.VBP) + ")" +
                " · Có số liệu: " + withBalance + "/" + visibleRecords.Count;
            rendering = true;
            try {
                grid.Rows.Clear();
                int number = 0;
                foreach (var r in records.Values.Where(r => !r.Deleted).OrderByDescending(r => RealmRank(r.Realm)).ThenByDescending(r => r.LastSeenUtc))
                {
                    string password;
                    string stoneBalance = FormatStoneBalance(r.StoneBalance);
                    string stoneEarnedToday = FormatStoneBalance(r.StoneEarnedToday);
                    int index = grid.Rows.Add(++number, r.Profile, r.Online ? "ĐANG ONLINE" : "OFFLINE", r.Name, stoneBalance, stoneEarnedToday, passwords.TryGetValue(r.Name ?? "", out password) ? password : "", r.Realm, r.VBP, r.Sale, r.DateDone);
                    grid.Rows[index].Cells["online"].Style.ForeColor = r.Online ? Color.DarkGreen : Color.DimGray;
                    if (Valid(selectedName) && string.Equals(r.Name, selectedName, StringComparison.OrdinalIgnoreCase)) grid.CurrentCell = grid.Rows[index].Cells["name"];
                }
            } finally { rendering = false; }
            status.Text = passwordError == null ? "Đã lưu " + visibleRecords.Count + " nhân vật · cập nhật khi đang mở ứng dụng." : "Không đọc được mật khẩu: " + passwordError;
        }

        private static string FormatStoneBalance(string value)
        {
            long amount;
            return long.TryParse(value, out amount) && amount >= 0 ? amount.ToString("N0", System.Globalization.CultureInfo.GetCultureInfo("vi-VN")) : "—";
        }

        private static string FormatStoneBalance(long amount)
        {
            return amount.ToString("N0", System.Globalization.CultureInfo.GetCultureInfo("vi-VN"));
        }
    }
}
