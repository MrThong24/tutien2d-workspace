using System;
using System.Diagnostics;
using System.Drawing;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ChromeGridApp
{
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--proxy-relay") return ProxySupport.RunRelay(args);
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
            if (args.Contains("--self-test"))
            {
                using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("StartChrome-10.ps1"))
                {
                    if (input == null || input.Length <= 1000) return 2;
                }
                using (var form = new MainForm()) return form.IsConfigured() && form.TestDynamicCounts() ? 0 : 3;
            }

            bool created;
            using (var mutex = new Mutex(true, @"Local\TuTienChromeGrid", out created))
            {
                if (!created)
                {
                    MessageBox.Show("Ứng dụng sắp xếp Chrome đang mở.", "Mở Chrome", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
            return 0;
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly ComboBox screenChoice = new ComboBox();
        private readonly NumericUpDown profileCountChoice = new NumericUpDown { Minimum = 1, Maximum = 20, Value = 1, Width = 58 };
        private readonly ComboBox launchProfile = new ComboBox();
        private readonly Button startProfile = new Button();
        private readonly Button start = new Button();
        private readonly Button preview = new Button();
        private readonly Button cancel = new Button();
        private readonly Button saveProxies = new Button();
        private readonly Button closeProfiles = new Button();
        private readonly TextBox proxyBox = new TextBox();
        private readonly TextBox proxyPool = new TextBox();
        private readonly Label poolStatus = new Label();
        private readonly Button savePool = new Button();
        private readonly Button randomPool = new Button();
        private readonly TextBox output = new TextBox();
        private readonly Label state = new Label();
        private readonly CheckBox monitorEnabled = new CheckBox();
        private readonly CheckBox autoOnLaunch = new CheckBox();
        private readonly MonitorView monitorView = new MonitorView();
        private readonly ActivityDashboardView activityDashboard = new ActivityDashboardView();
        private List<AccountEntry> savedAccounts = new List<AccountEntry>();
        private MobileServer mobileServer;
        private Process process;
        private string temporaryScript;
        private string temporaryProxies;
        private string launchFailure;
        private readonly HashSet<int> profilesNeedingSync = new HashSet<int>();
        private readonly List<int> profileSyncAfterLaunch = new List<int>();
        private string PendingProfileSyncFile { get { return Path.Combine(SecretStore.Root, "profile-sync-pending.dat"); } }
        private readonly string proxyConfig = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TuTienChromeGrid", "proxies.txt");
        private readonly string autoConfig = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TuTienChromeGrid", "auto-start.txt");
        private static readonly string[] InitialProxies = {
            "45.3.33.71:3129", "65.111.27.161:3129", "216.26.234.18:3129", "209.50.167.170:3129", "65.111.8.168:3129",
            "209.50.183.154:3129", "209.50.186.96:3129", "216.26.248.142:3129", "104.167.19.42:3129", "45.3.36.162:3129"
        };

        public MainForm()
        {
            Text = "Quản lý hoạt động Tu Tiên 2D";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(1000, 760);
            Size = new Size(1450, 940);
            Font = new Font("Segoe UI", 9F);

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 1, RowCount = 8 };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 190));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var tabs = new TabControl { Dock = DockStyle.Fill };
            var activityTab = new TabPage("Hoạt động");
            var launchTab = new TabPage("Mở Chrome");
            var monitorTab = new TabPage("Theo dõi nhân vật");
            var statsTab = new TabPage("Thống kê nhân vật");
            var poolTab = new TabPage("Danh sách proxy");
            var mobileTab = new TabPage("Điện thoại");
            activityDashboard.Dock = DockStyle.Fill; Controls.Add(activityDashboard);
            // This build exposes only the activity dashboard. Always start Chrome
            // with the monitoring endpoint enabled so opened profiles are tracked.
            monitorEnabled.Checked = true;
            try
            {
                savedAccounts = AccountStore.Load();
                LoadPendingProfileSync();
                if (savedAccounts.Any(x => !x.AutoSubmitLogin))
                {
                    foreach (var account in savedAccounts) account.AutoSubmitLogin = true;
                    AccountStore.Save(savedAccounts);
                }
                activityDashboard.SetAccounts(savedAccounts);
            }
            catch (Exception error) { state.Text = "Không đọc được danh sách acc đã lưu: " + error.Message; }
            activityDashboard.AddAccountRequested += AddAccount;
            activityDashboard.DeleteAccountRequested += DeleteAccount;
            activityDashboard.OpenProfileRequested += OpenDashboardProfile;
            activityDashboard.CloseProfileRequested += async delegate(int number) { await CloseProfiles(number); };
            activityDashboard.StartAutoTotalRequested += async delegate(int number) {
                activityDashboard.SetStatus("Profile" + number.ToString("00") + ": đang gửi lệnh bật Auto tổng…");
                string result = await monitorView.StartMainForProfile(number);
                activityDashboard.SetStatus("Profile" + number.ToString("00") + ": " + result);
            };
            activityDashboard.StartAutoFarmRequested += async delegate(int number, string mapId) {
                string mapLabel = string.IsNullOrWhiteSpace(mapId) ? "tự động" : mapId;
                activityDashboard.SetStatus("Profile" + number.ToString("00") + ": đang khởi chạy Auto quái tại " + mapLabel + "…");
                string result = await monitorView.MobileScript(number, "stone", false, mapId);
                activityDashboard.SetStatus("Profile" + number.ToString("00") + ": " + result);
            };
            activityDashboard.StopBotRequested += async delegate(int number) {
                activityDashboard.SetStatus("Profile" + number.ToString("00") + ": dang gui lenh dung bot...");
                string result = await monitorView.StopBotForProfile(number);
                activityDashboard.SetStatus("Profile" + number.ToString("00") + ": " + result);
            };
            activityDashboard.JournalRequested += ShowApplicationJournal;
            BuildProxyPool(poolTab);
            launchTab.Controls.Add(layout);
            monitorView.Dock = DockStyle.Fill; monitorTab.Controls.Add(monitorView);
            var statsView = new CharacterStatsView { Dock = DockStyle.Fill };
            statsTab.Controls.Add(statsView);
            BuildMobileTab(mobileTab, statsView);
            monitorView.SnapshotsUpdated += statsView.Observe;
            monitorView.SnapshotsUpdated += activityDashboard.SetSnapshots;
            monitorView.LastCharacterForProfile = statsView.LastCharacterForProfile;
            monitorView.DateDoneForCharacter = statsView.GetDateDone;
            statsView.DateDoneChanged += monitorView.RefreshDetails;
            monitorView.DateDoneRequested += async delegate(int number, string name, bool done) { await SetDateDone(statsView, number, name, done); };
            monitorView.RefreshDetails();
            monitorView.OpenProfile += delegate(int number) { if (process == null && closeProfiles.Enabled) { monitorEnabled.Checked = true; RunScript(false, number); } };
            monitorView.CloseProfile += async delegate(int number) { await CloseProfiles(number); };

            var title = new Label { Text = "MỞ VÀ SẮP XẾP CHROME", AutoSize = true, Font = new Font("Segoe UI", 14F, FontStyle.Bold), Margin = new Padding(0, 0, 0, 8) };
            var note = new Label { Text = "Lưới Chrome cố định 20 vị trí (5 × 4) trên một màn hình. Mở thêm profile sẽ dùng ô trống mà không đổi bố cục các profile cũ.", AutoSize = true, MaximumSize = new Size(700, 0), Margin = new Padding(0, 0, 0, 8) };
            layout.Controls.Add(title, 0, 0);
            layout.Controls.Add(note, 0, 1);

            var monitorRow = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = false, Margin = new Padding(0, 0, 0, 8) };
            monitorRow.Controls.Add(new Label { Text = "Màn hình:", AutoSize = true, Margin = new Padding(0, 7, 8, 0) });
            screenChoice.DropDownStyle = ComboBoxStyle.DropDownList;
            screenChoice.Width = 400;
            screenChoice.Items.Add("Tự chọn màn hình phụ bên trái");
            var screens = Screen.AllScreens.OrderBy(s => s.Bounds.X).ThenBy(s => s.Bounds.Y).ToArray();
            for (int i = 0; i < screens.Length; i++)
            {
                var screen = screens[i];
                screenChoice.Items.Add(string.Format("Màn hình {0}: {1} × {2}, vị trí ({3}, {4}){5}", i + 1,
                    screen.Bounds.Width, screen.Bounds.Height, screen.Bounds.X, screen.Bounds.Y, screen.Primary ? " — chính" : ""));
            }
            screenChoice.SelectedIndex = 0;
            monitorRow.Controls.Add(screenChoice);
            monitorRow.Controls.Add(new Label { Text = "Số Chrome:", AutoSize = true, Margin = new Padding(10, 7, 4, 0) });
            monitorRow.Controls.Add(profileCountChoice);
            layout.Controls.Add(monitorRow, 0, 2);

            var proxyLabel = new Label { Text = "Proxy theo thứ tự profile: dòng 1 cho Profile01, dòng 2 cho Profile02…", AutoSize = true,
                MaximumSize = new Size(720, 0), Margin = new Padding(0, 0, 0, 5) };
            layout.Controls.Add(proxyLabel, 0, 3);
            proxyBox.Multiline = true; proxyBox.ScrollBars = ScrollBars.Vertical; proxyBox.WordWrap = false;
            proxyBox.Dock = DockStyle.Fill; proxyBox.Font = new Font("Consolas", 10F); proxyBox.Margin = new Padding(0, 0, 0, 8);
            try { proxyBox.Text = File.Exists(ProxySupport.AssignmentsFile) ? SecretStore.Read(ProxySupport.AssignmentsFile) : File.Exists(proxyConfig) ? File.ReadAllText(proxyConfig, Encoding.UTF8) : string.Join(Environment.NewLine, InitialProxies); }
            catch (IOException) { proxyBox.Text = string.Join(Environment.NewLine, InitialProxies); }
            catch (UnauthorizedAccessException) { proxyBox.Text = string.Join(Environment.NewLine, InitialProxies); }
            catch (System.Security.Cryptography.CryptographicException) { proxyBox.Text = ""; }
            try { if (File.Exists(ProxySupport.PoolFile)) proxyBox.Text = ProxySupport.ExtendAssignments(proxyBox.Text, SecretStore.Read(ProxySupport.PoolFile), (int)profileCountChoice.Value); }
            catch (IOException) { } catch (UnauthorizedAccessException) { } catch (System.Security.Cryptography.CryptographicException) { } catch (InvalidOperationException) { }
            layout.Controls.Add(proxyBox, 0, 4);

            var controls = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 8) };
            start.Text = "Mở / sắp xếp 10 Chrome"; start.AutoSize = true; start.Padding = new Padding(5);
            preview.Text = "Xem trước vị trí"; preview.AutoSize = true; preview.Padding = new Padding(5);
            saveProxies.Text = "Lưu proxy"; saveProxies.AutoSize = true; saveProxies.Padding = new Padding(5);
            cancel.Text = "Dừng"; cancel.AutoSize = true; cancel.Padding = new Padding(5); cancel.Enabled = false;
            closeProfiles.Text = "Đóng 10 Chrome"; closeProfiles.AutoSize = true; closeProfiles.Padding = new Padding(5);
            startProfile.Text = "Mở profile đã chọn"; startProfile.AutoSize = true; startProfile.Padding = new Padding(5);
            launchProfile.DropDownStyle = ComboBoxStyle.DropDownList; launchProfile.Width = 110;
            for (int i = 1; i <= 10; i++) launchProfile.Items.Add("Profile" + i.ToString("00"));
            launchProfile.SelectedIndex = 0;
            start.Click += delegate { RunScript(false, 0); };
            startProfile.Click += delegate { RunScript(false, launchProfile.SelectedIndex + 1); };
            preview.Click += delegate { RunScript(true, 0); };
            saveProxies.Click += delegate { SaveProxies(); };
            cancel.Click += delegate { CancelWork(); };
            closeProfiles.Click += async delegate { await CloseProfiles(0); };
            controls.Controls.Add(start); controls.Controls.Add(preview); controls.Controls.Add(saveProxies); controls.Controls.Add(cancel); controls.Controls.Add(closeProfiles);
            controls.Controls.Add(launchProfile); controls.Controls.Add(startProfile);
            monitorEnabled.Text = "Cho phép theo dõi (cần mở lại Chrome)"; monitorEnabled.AutoSize = true; monitorEnabled.Margin = new Padding(3, 12, 3, 0);
            controls.Controls.Add(monitorEnabled);
            autoOnLaunch.Text = "Tự bật Auto tổng khi mở game"; autoOnLaunch.AutoSize = true; autoOnLaunch.Margin = new Padding(3, 12, 3, 0);
            try { autoOnLaunch.Checked = File.Exists(autoConfig) && File.ReadAllText(autoConfig).Trim() == "1"; }
            catch (IOException) { } catch (UnauthorizedAccessException) { }
            if (autoOnLaunch.Checked) { monitorEnabled.Checked = true; monitorView.SetAutoEnabled(true); }
            autoOnLaunch.CheckedChanged += delegate {
                if (autoOnLaunch.Checked) monitorEnabled.Checked = true;
                monitorView.SetAutoEnabled(autoOnLaunch.Checked);
                try { Directory.CreateDirectory(Path.GetDirectoryName(autoConfig)); File.WriteAllText(autoConfig, autoOnLaunch.Checked ? "1" : "0"); }
                catch (IOException) { state.Text = "Không lưu được lựa chọn tự bật auto."; }
                catch (UnauthorizedAccessException) { state.Text = "Không có quyền lưu lựa chọn tự bật auto."; }
            };
            monitorEnabled.CheckedChanged += delegate { if (!monitorEnabled.Checked) autoOnLaunch.Checked = false; };
            controls.Controls.Add(autoOnLaunch);
            profileCountChoice.ValueChanged += delegate { UpdateProfileCount(); };
            layout.Controls.Add(controls, 0, 5);
            state.Text = "Sẵn sàng."; state.AutoSize = true; state.Margin = new Padding(0, 0, 0, 8);
            layout.Controls.Add(state, 0, 6);
            output.Multiline = true; output.ReadOnly = true; output.ScrollBars = ScrollBars.Both;
            output.WordWrap = false; output.Dock = DockStyle.Fill; output.Font = new Font("Consolas", 9F);
            layout.Controls.Add(output, 0, 7);
            FormClosing += OnClosing;
            if (savedAccounts.Count > 0)
            {
                int savedProfileCount = savedAccounts.Max(x => x.Profile);
                if (savedProfileCount > 1) profileCountChoice.Value = savedProfileCount;
            }
            UpdateProfileCount();
            activityDashboard.SetProfileCount(savedAccounts.Count == 0 ? 0 : savedAccounts.Max(x => x.Profile));
        }

        public bool IsConfigured()
        {
            return screenChoice.Items.Count >= 2 && screenChoice.SelectedIndex == 0 && start.Enabled && preview.Enabled && ReadProxies().Length >= (int)profileCountChoice.Value;
        }

        internal bool TestDynamicCounts()
        {
            proxyPool.Text = string.Join(Environment.NewLine, Enumerable.Range(1, 20).Select(i => "http://proxy" + i + ".example:3129"));
            proxyBox.Text = string.Join(Environment.NewLine, Enumerable.Range(1, 10).Select(i => "http://proxy" + i + ".example:3129"));
            profileCountChoice.Value = 1;
            if (monitorView.ConfiguredProfileCount != 1 || launchProfile.Items.Count != 1 || ReadProxies().Length != 10) return false;
            profileCountChoice.Value = 12;
            if (monitorView.ConfiguredProfileCount != 12 || launchProfile.Items.Count != 12 || ReadProxies().Length != 12) return false;
            profileCountChoice.Value = 20;
            if (monitorView.ConfiguredProfileCount != 20 || launchProfile.Items.Count != 20 || ReadProxies().Length != 20) return false;
            profileCountChoice.Value = 10;
            return monitorView.ConfiguredProfileCount == 10 && launchProfile.Items.Count == 10 && ReadProxies().Length == 20;
        }

        private void UpdateProfileCount()
        {
            int count = (int)profileCountChoice.Value;
            int previous = launchProfile.SelectedIndex;
            launchProfile.BeginUpdate();
            try { launchProfile.Items.Clear(); for (int i = 1; i <= count; i++) launchProfile.Items.Add("Profile" + i.ToString("00")); launchProfile.SelectedIndex = Math.Max(0, Math.Min(previous, count - 1)); }
            finally { launchProfile.EndUpdate(); }
            monitorView.SetProfileCount(count);
            activityDashboard.SetProfileCount(count);
            start.Text = "Mở / sắp xếp " + count + " Chrome";
            closeProfiles.Text = "Đóng " + count + " Chrome";
            try {
                if (!string.IsNullOrWhiteSpace(proxyPool.Text)) proxyBox.Text = ProxySupport.ExtendAssignments(proxyBox.Text, proxyPool.Text, count);
                int available = ProxySupport.ParseLines(proxyBox.Text, false).Length;
                state.Text = available >= count ? "Đã chọn " + count + " profile; các proxy cũ được giữ nguyên." : "Cần thêm " + (count - available) + " proxy cho số profile đã chọn.";
            } catch (Exception error) { state.Text = "Kiểm tra danh sách proxy: " + error.Message; }
        }

        private void BuildProxyPool(TabPage tab)
        {
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(14) };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); tab.Controls.Add(layout);
            var note = new Label { AutoSize = true, MaximumSize = new Size(720, 0), Text = "Dán danh sách proxy, mỗi dòng USER:PASS@IP:PORT hoặc IP:PORT. Chọn ngẫu nhiên sẽ gán proxy cho số profile đã chọn.\nDanh sách và mật khẩu proxy được lưu mã hóa theo tài khoản Windows." };
            layout.Controls.Add(note, 0, 0);
            proxyPool.Multiline = true; proxyPool.ScrollBars = ScrollBars.Both; proxyPool.WordWrap = false; proxyPool.Dock = DockStyle.Fill;
            proxyPool.Font = new Font("Consolas", 10F); proxyPool.Margin = new Padding(0, 8, 0, 8);
            try { if (File.Exists(ProxySupport.PoolFile)) proxyPool.Text = SecretStore.Read(ProxySupport.PoolFile); }
            catch (Exception) { poolStatus.Text = "Không đọc được danh sách proxy đã mã hóa."; }
            layout.Controls.Add(proxyPool, 0, 1);
            var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
            savePool.Text = "Lưu danh sách"; savePool.AutoSize = true; savePool.Padding = new Padding(5);
            randomPool.Text = "Chọn proxy ngẫu nhiên"; randomPool.AutoSize = true; randomPool.Padding = new Padding(5);
            savePool.Click += delegate {
                try { var entries = ProxySupport.ParseLines(proxyPool.Text, false); if (entries.Length == 0) throw new InvalidOperationException("Danh sách proxy đang trống.");
                    SecretStore.Write(ProxySupport.PoolFile, string.Join(Environment.NewLine, entries)); poolStatus.Text = "Đã lưu " + entries.Length + " proxy."; }
                catch (Exception error) { poolStatus.Text = error.Message; }
            };
            randomPool.Click += delegate {
                try {
                    int count = (int)profileCountChoice.Value;
                    var existing = ProxySupport.ParseLines(proxyBox.Text, false);
                    var selected = ProxySupport.RandomTen(proxyPool.Text, count, existing.Skip(count));
                    if (existing.Length > count) selected = selected.Concat(existing.Skip(count)).ToArray();
                    SecretStore.Write(ProxySupport.PoolFile, string.Join(Environment.NewLine, ProxySupport.ParseLines(proxyPool.Text, false)));
                    WriteProxyConfig(selected);
                    proxyBox.Text = string.Join(Environment.NewLine, selected);
                    poolStatus.Text = "Đã chọn và lưu proxy cho " + count + " profile. Đóng các profile đang chạy bằng proxy khác trước khi mở lại.";
                } catch (Exception error) { poolStatus.Text = error.Message; }
            };
            actions.Controls.Add(savePool); actions.Controls.Add(randomPool); layout.Controls.Add(actions, 0, 2);
            poolStatus.AutoSize = true; poolStatus.MaximumSize = new Size(720, 0); layout.Controls.Add(poolStatus, 0, 3);
        }

        private void BuildMobileTab(TabPage tab, CharacterStatsView statsView)
        {
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 8, Padding = new Padding(18) };
            for (int i = 0; i < 7; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); tab.Controls.Add(layout);
            var title = new Label { Text = "ĐIỀU KHIỂN TỪ ĐIỆN THOẠI", AutoSize = true, Font = new Font("Segoe UI", 14F, FontStyle.Bold) };
            var note = new Label { AutoSize = true, MaximumSize = new Size(700, 0), Margin = new Padding(0, 10, 0, 10), Text = "Cài và đăng nhập Tailscale trên máy tính và điện thoại cùng một mạng Tailscale. Giữ ứng dụng này và máy tính đang chạy. Giao diện điện thoại không hiển thị mật khẩu tài khoản hoặc proxy." };
            var link = new LinkLabel { Text = "Tải Tailscale", AutoSize = true, Margin = new Padding(0, 0, 0, 10) };
            link.LinkClicked += delegate { try { Process.Start(new ProcessStartInfo("https://tailscale.com/download") { UseShellExecute = true }); } catch (Exception) { } };
            var buttons = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
            var startMobile = new Button { Text = "Bật giao diện điện thoại", AutoSize = true, Padding = new Padding(5) };
            var stopMobile = new Button { Text = "Tắt giao diện", AutoSize = true, Padding = new Padding(5), Enabled = false };
            buttons.Controls.Add(startMobile); buttons.Controls.Add(stopMobile);
            var message = new Label { AutoSize = true, MaximumSize = new Size(700, 0), Text = "Chưa bật giao diện điện thoại.", Margin = new Padding(0, 10, 0, 6) };
            var address = new TextBox { ReadOnly = true, Width = 580 };
            var code = new TextBox { ReadOnly = true, Width = 580 };
            var addressRow = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
            addressRow.Controls.Add(new Label { Text = "Địa chỉ:", AutoSize = true, Margin = new Padding(0, 7, 5, 0) }); addressRow.Controls.Add(address);
            var codeRow = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill };
            codeRow.Controls.Add(new Label { Text = "Mã truy cập:", AutoSize = true, Margin = new Padding(0, 7, 5, 0) }); codeRow.Controls.Add(code);
            layout.Controls.Add(title, 0, 0); layout.Controls.Add(note, 0, 1); layout.Controls.Add(link, 0, 2); layout.Controls.Add(buttons, 0, 3);
            layout.Controls.Add(message, 0, 4); layout.Controls.Add(addressRow, 0, 5); layout.Controls.Add(codeRow, 0, 6);
            startMobile.Click += delegate {
                try {
                    var ip = MobileServer.FindTailscaleAddress();
                    if (ip == null) { message.Text = "Chưa tìm thấy Tailscale đang kết nối. Cài và đăng nhập Tailscale trên máy tính trước."; return; }
                    var server = new MobileServer(
                        () => InvokeMobileUi(() => Task.FromResult<object>(new { profiles = monitorView.MobileProfiles(), profileCount = (int)profileCountChoice.Value, operation = state.Text })).GetAwaiter().GetResult(),
                        number => MonitorView.MobileDetail(number),
                        payload => InvokeMobileUi(() => MobileAction(statsView, payload)));
                    try { server.Start(ip); } catch { server.Dispose(); throw; }
                    mobileServer = server; address.Text = server.Address; code.Text = server.Code;
                    message.Text = "Đã bật. Trên điện thoại, kết nối Tailscale, mở địa chỉ trên rồi nhập mã truy cập.";
                    startMobile.Enabled = false; stopMobile.Enabled = true;
                } catch (Exception error) { message.Text = "Không bật được giao diện: " + error.Message; }
            };
            stopMobile.Click += delegate {
                if (mobileServer != null) { mobileServer.Dispose(); mobileServer = null; }
                address.Clear(); code.Clear(); message.Text = "Đã tắt giao diện điện thoại."; startMobile.Enabled = true; stopMobile.Enabled = false;
            };
        }

        private Task<object> InvokeMobileUi(Func<Task<object>> work)
        {
            var completion = new TaskCompletionSource<object>();
            if (IsDisposed || Disposing || !IsHandleCreated) { completion.SetResult(new { error = "Ứng dụng chưa sẵn sàng." }); return completion.Task; }
            try {
                BeginInvoke(new Action(async delegate {
                    try { completion.TrySetResult(await work()); }
                    catch (Exception) { completion.TrySetResult(new { error = "Không thực hiện được thao tác." }); }
                }));
            } catch (InvalidOperationException) { completion.TrySetResult(new { error = "Ứng dụng đã đóng." }); }
            return completion.Task;
        }

        private async Task<object> MobileAction(CharacterStatsView statsView, System.Collections.Generic.Dictionary<string, object> payload)
        {
            object raw, kindValue, scriptValue, nameValue, mapValue, zoneValue, countValue;
            int number;
            if (!payload.TryGetValue("action", out kindValue)) return new { message = "Yêu cầu không hợp lệ." };
            string kind = Convert.ToString(kindValue);
            if (kind == "setCount") {
                int count;
                if (!payload.TryGetValue("count", out countValue) || !int.TryParse(Convert.ToString(countValue), out count) || count < 1 || count > 20) return new { message = "Số Chrome phải từ 1 đến 20." };
                if (process != null || !profileCountChoice.Enabled) return new { message = "Ứng dụng đang xử lý Chrome; hãy thử lại sau." };
                if ((int)profileCountChoice.Value == count) return new { message = "Đang chọn " + count + " profile." };
                profileCountChoice.Value = count;
                return new { message = state.Text + " Chrome đang mở không tự đóng." };
            }
            if (!payload.TryGetValue("profile", out raw) || !int.TryParse(Convert.ToString(raw), out number) || number < 0 || number > (int)profileCountChoice.Value) return new { message = "Profile không hợp lệ." };
            if (kind == "graphicsLow" || kind == "graphicsRestore") return new { message = await monitorView.MobileGraphics(number, kind == "graphicsRestore") };
            if (number < 1) return new { message = "Profile không hợp lệ." };
            string script = payload.TryGetValue("script", out scriptValue) ? Convert.ToString(scriptValue) : "";
            string requestedName = payload.TryGetValue("character", out nameValue) ? Convert.ToString(nameValue) : "";
            if (kind == "start" || kind == "stop") {
                if (script != "main" && script != "books" && script != "stone") return new { message = "Script không hợp lệ." };
                string mapId = payload.TryGetValue("map", out mapValue) ? Convert.ToString(mapValue) : "";
                int zoneId = 0;
                if (payload.TryGetValue("zone", out zoneValue) && !int.TryParse(Convert.ToString(zoneValue), out zoneId)) return new { message = "Khu farm khong hop le." };
                return new { message = await monitorView.MobileScript(number, script, kind == "stop", mapId, zoneId) };
            }
            if (kind == "open") {
                if (process != null || !closeProfiles.Enabled) return new { message = "Ứng dụng đang xử lý; hãy thử lại sau." };
                monitorEnabled.Checked = true; RunScript(false, number); return new { message = state.Text };
            }
            if (kind == "close") {
                if (process != null || !closeProfiles.Enabled) return new { message = "Ứng dụng đang xử lý; hãy thử lại sau." };
                await CloseProfiles(number); return new { message = state.Text };
            }
            if (kind == "done" || kind == "undone") {
                if (process != null || !closeProfiles.Enabled) return new { message = "Ứng dụng đang xử lý; hãy thử lại sau." };
                bool live; string actual = monitorView.MobileCharacterForProfile(number, out live);
                if (string.IsNullOrWhiteSpace(actual) || !string.Equals(actual, requestedName, StringComparison.OrdinalIgnoreCase))
                    return new { message = "Nhân vật đã thay đổi hoặc chưa xác định; tải lại rồi thử lại." };
                if (kind == "done" && !live) return new { message = "Nhân vật chưa kết nối; không thể đánh dấu và đóng Chrome." };
                if (kind == "done") {
                    string verified = await Task.Run(() => MonitorView.VerifiedMobileCharacter(number));
                    if (!string.Equals(actual, verified, StringComparison.OrdinalIgnoreCase)) return new { message = "Không xác minh được đúng nhân vật; chưa đánh dấu và chưa đóng Chrome." };
                    if (process != null || !closeProfiles.Enabled) return new { message = "Ứng dụng đang xử lý; hãy thử lại sau." };
                }
                await SetDateDone(statsView, number, actual, kind == "done");
                return new { message = kind == "undone" ? (statsView.GetDateDone(actual) == false ? "Đã bỏ Date Done." : "Chưa thể cập nhật Date Done.") : state.Text };
            }
            return new { message = "Thao tác không hợp lệ." };
        }

        private string[] ReadProxies()
        {
            return ProxySupport.ParseLines(proxyBox.Text, true, (int)profileCountChoice.Value);
        }

        private void AddAccount()
        {
            try
            {
                savedAccounts = AccountStore.Load();
                int profile = AccountStore.NextProfile(savedAccounts);
                using (var dialog = new AddAccountDialog(profile))
                {
                    if (dialog.ShowDialog(this) != DialogResult.OK || dialog.Account == null) return;
                    savedAccounts.Add(dialog.Account);
                    AccountStore.Save(savedAccounts);
                    profilesNeedingSync.Add(profile);
                    SavePendingProfileSync();

                    var proxies = ProxySupport.ParseLines(proxyBox.Text, false).ToList();
                    while (proxies.Count < profile) proxies.Add(InitialProxies[proxies.Count % InitialProxies.Length]);
                    proxies[profile - 1] = dialog.Account.Proxy;
                    proxyBox.Text = string.Join(Environment.NewLine, proxies);
                    if (profileCountChoice.Value < profile) profileCountChoice.Value = profile;
                    UpdateProfileCount();
                    WriteProxyConfig(proxies.Take((int)profileCountChoice.Value).ToArray());
                    activityDashboard.SetAccounts(savedAccounts);
                    activityDashboard.SetStatus("Đã lưu acc cho Profile" + profile.ToString("00") + ". Tài khoản và proxy được mã hóa cục bộ trên Windows.");

                    if (dialog.OpenAfterSave)
                    {
                        monitorEnabled.Checked = true;
                        RunScript(false, profile);
                    }
                }
            }
            catch (Exception error)
            {
                activityDashboard.SetStatus("Không thể thêm acc: " + error.Message);
                MessageBox.Show(this, error.Message, "Thêm acc", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void DeleteAccount(int profile)
        {
            try
            {
                savedAccounts = AccountStore.Load();
                AccountEntry entry = savedAccounts.FirstOrDefault(x => x.Profile == profile);
                if (entry == null)
                {
                    activityDashboard.SetStatus("Profile" + profile.ToString("00") + " chưa có acc đã lưu.");
                    return;
                }
                DialogResult answer = MessageBox.Show(this,
                    "Xóa acc " + entry.Username + " khỏi Profile" + profile.ToString("00") + "?\r\n\r\nThông tin đăng nhập đã lưu sẽ bị xóa. Dữ liệu Chrome và proxy trong cấu hình mở Chrome được giữ lại.",
                    "Xóa acc", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
                if (answer != DialogResult.Yes) return;
                savedAccounts.Remove(entry);
                AccountStore.Save(savedAccounts);
                profilesNeedingSync.Remove(profile);
                SavePendingProfileSync();
                activityDashboard.SetAccounts(savedAccounts);
                int remainingProfiles = savedAccounts.Count == 0 ? 0 : savedAccounts.Max(x => x.Profile);
                int launcherCount = Math.Max(1, remainingProfiles);
                if (profileCountChoice.Value != launcherCount) profileCountChoice.Value = launcherCount;
                UpdateProfileCount();
                activityDashboard.SetProfileCount(remainingProfiles);
                activityDashboard.SetStatus("Đã xóa acc khỏi Profile" + profile.ToString("00") + ". Dữ liệu Chrome và proxy cấu hình vẫn được giữ.");
            }
            catch (Exception error)
            {
                activityDashboard.SetStatus("Không thể xóa acc: " + error.Message);
                MessageBox.Show(this, error.Message, "Xóa acc", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenDashboardProfile(int profile)
        {
            if (profile < 1 || profile > 20)
            {
                activityDashboard.SetStatus("Profile không hợp lệ.");
                return;
            }
            if (process != null || !closeProfiles.Enabled)
            {
                activityDashboard.SetStatus("Ứng dụng đang xử lý thao tác Chrome; thử lại sau.");
                return;
            }
            if (profileCountChoice.Value < profile) profileCountChoice.Value = profile;
            monitorEnabled.Checked = true;
            activityDashboard.SetStatus("Đang mở Profile" + profile.ToString("00") + "…");
            RunScript(false, profile);
        }

        private void ShowApplicationJournal()
        {
            using (var dialog = new Form { Text = "Nh\u1eadt k\u00fd \u1ee9ng d\u1ee5ng", StartPosition = FormStartPosition.CenterParent,
                Size = new Size(900, 600), MinimumSize = new Size(520, 360), Font = Font, ShowInTaskbar = false })
            using (var logText = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both,
                WordWrap = false, Dock = DockStyle.Fill, Font = new Font("Consolas", 9F), Text = output.Text })
            {
                var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 42, FlowDirection = FlowDirection.RightToLeft };
                var close = new Button { Text = "\u0110\u00f3ng", Width = 90, DialogResult = DialogResult.Cancel };
                var copy = new Button { Text = "Sao ch\u00e9p", Width = 100 };
                copy.Click += delegate { if (!string.IsNullOrEmpty(logText.Text)) Clipboard.SetText(logText.Text); };
                buttons.Controls.Add(close); buttons.Controls.Add(copy);
                dialog.Controls.Add(logText); dialog.Controls.Add(buttons); dialog.CancelButton = close;
                dialog.ShowDialog(this);
            }
        }
        private void WriteProxyConfig(string[] values)
        {
            SecretStore.Write(ProxySupport.AssignmentsFile, string.Join(Environment.NewLine, values));
        }

        private void SaveProxies()
        {
            try { WriteProxyConfig(ReadProxies()); state.Text = "Đã lưu proxy theo thứ tự profile."; }
            catch (Exception error) { state.Text = error.Message; }
        }

        private void ScheduleAccountAutofill(int profileNumber)
        {
            List<AccountEntry> targets = savedAccounts
                .Where(x => (profileNumber == 0 ? x.Profile <= (int)profileCountChoice.Value : x.Profile == profileNumber) &&
                    !string.IsNullOrWhiteSpace(x.Username) && !string.IsNullOrWhiteSpace(x.Password))
                .Select(x => new AccountEntry { Profile = x.Profile, Username = x.Username, Password = x.Password, AutoSubmitLogin = x.AutoSubmitLogin })
                .ToList();
            if (targets.Count == 0) return;
            Task.Run(() =>
            {
                foreach (var account in targets)
                {
                    string result = FillLoginWhenReady(account);
                    if (!IsDisposed && !Disposing)
                    {
                        try { BeginInvoke(new Action(delegate {
                            activityDashboard.SetStatus("Profile" + account.Profile.ToString("00") + ": " + result);
                            state.Text = "Profile" + account.Profile.ToString("00") + ": " + result;
                        })); } catch (InvalidOperationException) { }
                    }
                }
            });
        }

        private static string FillLoginWhenReady(AccountEntry account)
        {
            int port = 19300 + account.Profile;
            DateTime until = DateTime.UtcNow.AddSeconds(120);
            while (DateTime.UtcNow < until)
            {
                try
                {
                    var serializer = new JavaScriptSerializer();
                    var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/json/list");
                    request.Proxy = null; request.Timeout = 1500; request.ReadWriteTimeout = 1500;
                    object decoded;
                    using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream())) decoded = serializer.DeserializeObject(reader.ReadToEnd());
                    var targets = decoded as object[];
                    var target = targets == null ? null : targets.OfType<Dictionary<string, object>>().FirstOrDefault(x => {
                        object raw; Uri uri;
                        return x.TryGetValue("url", out raw) && Uri.TryCreate(Convert.ToString(raw), UriKind.Absolute, out uri) &&
                            IsGameHost(uri.Host);
                    });
                    if (target != null && target.ContainsKey("webSocketDebuggerUrl"))
                    {
                        string expression = LoginFillExpression(account, serializer);
                        string result = EvaluateInChrome(Convert.ToString(target["webSocketDebuggerUrl"]), expression, serializer);
                        if (result == "WAIT") { Thread.Sleep(1500); continue; }
                        if (result == "ALREADY_IN_GAME") return "Đã đăng nhập; giữ nguyên phiên hiện tại.";
                        if (result == "LOGIN_FORM_NOT_FOUND") { Thread.Sleep(1500); continue; }
                        if (result == "FILLED") return "Đã điền tài khoản; kiểm tra lại rồi bấm Đăng nhập.";
                        if (result == "SUBMITTED") return "Đã gửi đăng nhập theo lựa chọn trong hộp Thêm acc.";
                        if (result == "NEED_CONSENT") return "Đã điền tài khoản; cần bạn xác nhận điều khoản trực tiếp trong game.";
                        if (result == "BUTTON_NOT_FOUND") return "Đã điền tài khoản; không tìm thấy nút Đăng nhập để gửi.";
                        return "Không tự gửi đăng nhập được (" + result + "); xử lý trực tiếp trong Chrome.";
                    }
                }
                catch (WebException) { }
                catch (InvalidOperationException) { }
                catch (System.Net.Sockets.SocketException) { }
                Thread.Sleep(1500);
            }
            return "Chưa thấy trang đăng nhập trong 2 phút; mở game và thử lại.";
        }

        private static string LoginFillExpression(AccountEntry account, JavaScriptSerializer serializer)
        {
            string username = serializer.Serialize(account.Username);
            string password = serializer.Serialize(account.Password);
            string submit = account.AutoSubmitLogin ? "true" : "false";
            return "(()=>{const vis=e=>!!e&&!e.disabled&&!!e.getClientRects().length;" +
                "if(document.querySelector('#hud-name'))return 'ALREADY_IN_GAME';" +
                "const xs=[...document.querySelectorAll('input')].filter(vis);" +
                "const u=xs.find(e=>/nhập đạo hiệu/i.test(e.placeholder||''))||xs.find(e=>e.type==='text'||e.type==='email');" +
                "const p=xs.find(e=>e.type==='password');if(!u||!p)return 'LOGIN_FORM_NOT_FOUND';" +
                "const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};" +
                "set(u," + username + ");set(p," + password + ");if(!" + submit + ")return 'FILLED';" +
                "const labs=[...document.querySelectorAll('label')];const lab=labs.find(e=>/tôi đồng ý/i.test(e.innerText||e.textContent||''));" +
                "let c=lab&&(lab.control||lab.querySelector('input[type=checkbox]'));if(!c)c=xs.find(e=>e.type==='checkbox'&&/đồng ý/i.test(e.parentElement?.innerText||''));" +
                "if(c&&!c.checked)return 'NEED_CONSENT';" +
                "const bs=[...document.querySelectorAll('button,[role=button]')].filter(vis);const b=bs.find(e=>(e.innerText||e.textContent||'').trim()==='Đăng nhập');" +
                "if(!b)return 'BUTTON_NOT_FOUND';b.click();return 'SUBMITTED';})()";
        }

        private static string EvaluateInChrome(string webSocketUrl, string expression, JavaScriptSerializer serializer)
        {
            Uri ws = new Uri(webSocketUrl);
            if (ws.Host != "127.0.0.1" && ws.Host != "localhost") throw new InvalidOperationException("Địa chỉ CDP không hợp lệ.");
            using (var socket = new ClientWebSocket()) using (var timeout = new CancellationTokenSource(5000))
            {
                socket.ConnectAsync(ws, timeout.Token).GetAwaiter().GetResult();
                string command = serializer.Serialize(new { id = 7, method = "Runtime.evaluate", @params = new { expression = expression, returnByValue = true } });
                byte[] bytes = Encoding.UTF8.GetBytes(command);
                socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, timeout.Token).GetAwaiter().GetResult();
                using (var stream = new MemoryStream())
                {
                    var buffer = new byte[4096]; WebSocketReceiveResult part;
                    do { part = socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token).GetAwaiter().GetResult(); stream.Write(buffer, 0, part.Count); if (stream.Length > 65536) throw new InvalidOperationException("Phản hồi CDP quá lớn."); } while (!part.EndOfMessage);
                    var packet = serializer.DeserializeObject(Encoding.UTF8.GetString(stream.ToArray())) as Dictionary<string, object>;
                    var result = packet == null ? null : packet["result"] as Dictionary<string, object>;
                    var value = result == null ? null : result["result"] as Dictionary<string, object>;
                    return value != null && value.ContainsKey("value") ? Convert.ToString(value["value"]) : "EVALUATION_FAILED";
                }
            }
        }

        private static bool IsGameHost(string host)
        {
            return host.Equals("tutien2d.com", StringComparison.OrdinalIgnoreCase) ||
                host.EndsWith(".tutien2d.com", StringComparison.OrdinalIgnoreCase) ||
                host.Equals("tutienpixel.online", StringComparison.OrdinalIgnoreCase) ||
                host.EndsWith(".tutienpixel.online", StringComparison.OrdinalIgnoreCase);
        }

        private void LoadPendingProfileSync()
        {
            profilesNeedingSync.Clear();
            if (!File.Exists(PendingProfileSyncFile)) return;
            try
            {
                int[] profiles = new JavaScriptSerializer().Deserialize<int[]>(SecretStore.Read(PendingProfileSyncFile)) ?? new int[0];
                foreach (int profile in profiles.Where(x => x >= 1 && x <= 20)) profilesNeedingSync.Add(profile);
            }
            catch
            {
                // A corrupt pending marker must not prevent the launcher from opening.
                profilesNeedingSync.Clear();
            }
        }

        private void SavePendingProfileSync()
        {
            SecretStore.Write(PendingProfileSyncFile, new JavaScriptSerializer().Serialize(profilesNeedingSync.OrderBy(x => x).ToArray()));
        }

        private void RunScript(bool previewOnly, int profileNumber)
        {
            if (process != null) return;
            try
            {
                savedAccounts = AccountStore.Load();
                profileSyncAfterLaunch.Clear();
                if (!previewOnly)
                {
                    IEnumerable<int> requestedSync = profileNumber > 0
                        ? profilesNeedingSync.Where(x => x == profileNumber)
                        : profilesNeedingSync.Where(x => x <= (int)profileCountChoice.Value);
                    profileSyncAfterLaunch.AddRange(requestedSync.OrderBy(x => x));
                }
                bool syncProfileAfterLaunch = profileSyncAfterLaunch.Count > 0;
                bool hasAccountToFill = savedAccounts.Any(x =>
                    (profileNumber == 0 ? x.Profile <= (int)profileCountChoice.Value : x.Profile == profileNumber) &&
                    !string.IsNullOrWhiteSpace(x.Username) && !string.IsNullOrWhiteSpace(x.Password));
                if (!previewOnly && hasAccountToFill) monitorEnabled.Checked = true;
                string[] proxies = ReadProxies();
                int count = (int)profileCountChoice.Value;
                string[] browserProxies = ProxySupport.BrowserEndpoints(proxies.Take(count).ToArray(), profileNumber, !previewOnly);
                if (!previewOnly) WriteProxyConfig(proxies);
                if (!previewOnly && autoOnLaunch.Checked) monitorView.SetAutoEnabled(true);
                string script;
                using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("StartChrome-10.ps1"))
                {
                    if (input == null) throw new InvalidOperationException("Không tìm thấy cấu hình trong ứng dụng.");
                    using (var reader = new StreamReader(input, Encoding.UTF8)) script = reader.ReadToEnd();
                }
                string folder = Path.Combine(Path.GetTempPath(), "TuTienChromeGrid");
                Directory.CreateDirectory(folder);
                temporaryScript = Path.Combine(folder, "grid-" + Guid.NewGuid().ToString("N") + ".ps1");
                File.WriteAllText(temporaryScript, script, new UTF8Encoding(true));
                temporaryProxies = Path.Combine(folder, "proxies-" + Guid.NewGuid().ToString("N") + ".txt");
                File.WriteAllLines(temporaryProxies, browserProxies, new UTF8Encoding(true));
                int index = screenChoice.SelectedIndex - 1;
                var info = new ProcessStartInfo();
                info.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
                info.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + temporaryScript + "\" -ScreenIndex " + index + " -ProfileCount " + count + " -ProfileNumber " + profileNumber + " -ProxyFile \"" + temporaryProxies + "\"" + (previewOnly ? " -Preview" : "") + (monitorEnabled.Checked ? " -Monitor" : "");
                info.UseShellExecute = false; info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden;
                info.RedirectStandardOutput = true; info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
                var child = new Process { StartInfo = info, EnableRaisingEvents = true };
                child.OutputDataReceived += OnOutput;
                child.ErrorDataReceived += OnOutput;
                child.Exited += delegate { OnExited(child); };
                output.Clear();
                launchFailure = null;
                start.Enabled = false; startProfile.Enabled = false; launchProfile.Enabled = false; preview.Enabled = false; closeProfiles.Enabled = false; screenChoice.Enabled = false; profileCountChoice.Enabled = false; proxyBox.Enabled = false; saveProxies.Enabled = false; cancel.Enabled = true;
                savePool.Enabled = false; randomPool.Enabled = false; proxyPool.Enabled = false; monitorEnabled.Enabled = false; autoOnLaunch.Enabled = false;
                monitorView.SetActionsEnabled(false);
                state.Text = previewOnly ? "Đang tính vị trí…" : profileNumber > 0 ? "Đang mở Profile" + profileNumber.ToString("00") + "…" : "Đang mở và sắp xếp…";
                activityDashboard.SetStatus(state.Text);
                monitorView.SetOperationStatus(state.Text);
                process = child;
                if (!child.Start()) throw new InvalidOperationException("Không khởi động được PowerShell.");
                child.BeginOutputReadLine(); child.BeginErrorReadLine();
                if (!previewOnly && hasAccountToFill && !syncProfileAfterLaunch) ScheduleAccountAutofill(profileNumber);
                else if (!previewOnly && profileNumber == 0 && syncProfileAfterLaunch)
                {
                    foreach (int profile in savedAccounts
                        .Where(x => x.Profile <= count && !profilesNeedingSync.Contains(x.Profile) &&
                            !string.IsNullOrWhiteSpace(x.Username) && !string.IsNullOrWhiteSpace(x.Password))
                        .Select(x => x.Profile).Distinct())
                        ScheduleAccountAutofill(profile);
                }
            }
            catch (Exception error)
            {
                if (process != null) { process.Dispose(); process = null; }
                DeleteTemporaryScript();
                SetIdle("Không thể chạy: " + error.Message);
            }
        }

        private void ScheduleProfileScriptSync(int profileNumber)
        {
            string syncScript = @"D:\Auto\tutien2d-automation\scripts\sync-new-profile.ps1";
            if (!File.Exists(syncScript))
            {
                string missing = "Profile" + profileNumber.ToString("00") + ": thiếu script đồng bộ.";
                activityDashboard.SetStatus(missing); state.Text = missing;
                return;
            }
            string starting = "Profile" + profileNumber.ToString("00") + ": đang đồng bộ script và kiểm tra kết nối…";
            activityDashboard.SetStatus(starting); state.Text = starting;
            Task.Run(() =>
            {
                string resultText;
                int exitCode;
                try
                {
                    var info = new ProcessStartInfo
                    {
                        FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                        Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + syncScript + "\" -ProfileNumber " + profileNumber,
                        UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = true, RedirectStandardError = true,
                        StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
                    };
                    using (var child = Process.Start(info))
                    {
                        if (child == null) throw new InvalidOperationException("Không khởi chạy được tiến trình đồng bộ.");
                        Task<string> stdout = child.StandardOutput.ReadToEndAsync();
                        Task<string> stderr = child.StandardError.ReadToEndAsync();
                        child.WaitForExit(); Task.WaitAll(stdout, stderr);
                        exitCode = child.ExitCode;
                        resultText = (stdout.Result + Environment.NewLine + stderr.Result).Trim();
                    }
                }
                catch (Exception error) { exitCode = -1; resultText = error.Message; }

                if (IsDisposed || Disposing) return;
                try
                {
                    BeginInvoke(new Action(delegate
                    {
                        string message = exitCode == 0
                            ? "Profile" + profileNumber.ToString("00") + ": script đã đồng bộ; kết nối nhân vật sẵn sàng."
                            : "Profile" + profileNumber.ToString("00") + ": đồng bộ/kết nối chưa xong. Xem Nhật ký hoặc lỗi bên dưới.";
                        if (!string.IsNullOrWhiteSpace(resultText)) output.AppendText(resultText + Environment.NewLine);
                        activityDashboard.SetStatus(message); state.Text = message;
                        if (exitCode == 0)
                        {
                            profilesNeedingSync.Remove(profileNumber);
                            SavePendingProfileSync();
                            ScheduleAccountAutofill(profileNumber);
                            int next = profileSyncAfterLaunch.Count == 0 ? 0 : profileSyncAfterLaunch[0];
                            if (profileSyncAfterLaunch.Count > 0) profileSyncAfterLaunch.RemoveAt(0);
                            if (next > 0) ScheduleProfileScriptSync(next);
                        }
                    }));
                }
                catch (InvalidOperationException) { }
            });
        }

        private void OnOutput(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null || IsDisposed || Disposing) return;
            try { BeginInvoke(new Action(delegate {
                if (IsDisposed) return;
                output.AppendText(e.Data + Environment.NewLine);
                if (e.Data.Contains("Proxy changed or cannot be verified")) launchFailure = "Proxy khác hoặc không xác minh được. Đóng profile đó trước rồi mở lại.";
                else if (e.Data.Contains("Close these Chrome profiles and reopen them for monitoring")) launchFailure = "Profile đang mở chưa bật theo dõi. Đóng profile đó rồi mở lại.";
            })); }
            catch (InvalidOperationException) { }
        }

        private void OnExited(Process child)
        {
            int code;
            try { child.WaitForExit(); code = child.ExitCode; } catch { code = -1; }
            if (IsDisposed || Disposing) { DeleteTemporaryScript(); return; }
            try
            {
                BeginInvoke(new Action(delegate {
                    if (process != child) return;
                    List<int> syncProfiles = code == 0 ? profileSyncAfterLaunch.ToList() : new List<int>();
                    profileSyncAfterLaunch.Clear();
                    process.Dispose(); process = null;
                    DeleteTemporaryScript();
                    SetIdle(code == 0 ? "Đã hoàn tất. Xem chi tiết bên dưới." : (launchFailure ?? "Chưa hoàn tất. Xem thông báo ở tab Mở Chrome."));
                    if (syncProfiles.Count > 0)
                    {
                        int first = syncProfiles[0];
                        syncProfiles.RemoveAt(0);
                        profileSyncAfterLaunch.AddRange(syncProfiles);
                        ScheduleProfileScriptSync(first);
                    }
                }));
            }
            catch (InvalidOperationException) { DeleteTemporaryScript(); }
        }

        private void SetIdle(string message)
        {
            state.Text = message; start.Enabled = true; startProfile.Enabled = true; launchProfile.Enabled = true; preview.Enabled = true; closeProfiles.Enabled = true; screenChoice.Enabled = true; profileCountChoice.Enabled = true; proxyBox.Enabled = true; saveProxies.Enabled = true; cancel.Enabled = false;
            savePool.Enabled = true; randomPool.Enabled = true; proxyPool.Enabled = true; monitorEnabled.Enabled = true; autoOnLaunch.Enabled = true;
            activityDashboard.SetStatus(message);
            monitorView.SetActionsEnabled(true); monitorView.SetOperationStatus(message);
        }

        private async Task SetDateDone(CharacterStatsView statsView, int profileNumber, string name, bool done)
        {
            if (process != null || !closeProfiles.Enabled) return;
            string message;
            if (!done) {
                statsView.SetDateDone(name, false, out message);
                monitorView.SetOperationStatus(message);
                return;
            }
            start.Enabled = false; startProfile.Enabled = false; launchProfile.Enabled = false; preview.Enabled = false; closeProfiles.Enabled = false; profileCountChoice.Enabled = false;
            monitorView.SetActionsEnabled(false);
            monitorView.SetOperationStatus("Đang xác minh nhân vật trước khi đánh dấu và đóng Chrome…");
            bool shouldClose = false;
            try {
                string current = await Task.Run(() => MonitorView.ReadCurrentCharacter(profileNumber));
                if (string.IsNullOrEmpty(current) || !string.Equals(current, name, StringComparison.OrdinalIgnoreCase))
                    message = "Nhân vật đã đổi hoặc không kết nối được; chưa đánh dấu và chưa đóng Chrome.";
                else
                    shouldClose = statsView.SetDateDone(name, true, out message);
            } catch (Exception error) { message = "Không xác minh được nhân vật: " + error.Message; }
            if (IsDisposed || Disposing) return;
            SetIdle(message);
            if (shouldClose) await CloseProfiles(profileNumber, true);
        }

        private async Task CloseProfiles(int profileNumber, bool dateDone = false)
        {
            if (process != null || !closeProfiles.Enabled) return;
            start.Enabled = false; startProfile.Enabled = false; launchProfile.Enabled = false; preview.Enabled = false; closeProfiles.Enabled = false; profileCountChoice.Enabled = false;
            monitorView.SetActionsEnabled(false);
            int count = (int)profileCountChoice.Value;
            state.Text = profileNumber == 0 ? "Đang yêu cầu đóng Profile01–Profile" + count.ToString("00") + "…" : "Đang yêu cầu đóng Profile" + profileNumber.ToString("00") + "…";
            monitorView.SetOperationStatus(state.Text);
            try
            {
                string message = await Task.Run(() => ProfileCloser.Close(profileNumber, count));
                if (dateDone) message = "Đã đánh dấu Date Done. " + message;
                if (!IsDisposed && !Disposing) { output.AppendText(message + Environment.NewLine); SetIdle(message); }
            }
            catch (Exception error)
            {
                if (!IsDisposed && !Disposing) SetIdle((dateDone ? "Đã đánh dấu Date Done. " : "") + "Không thể đóng Chrome: " + error.Message);
            }
        }

        private void CancelWork()
        {
            if (process == null) return;
            try { if (!process.HasExited) process.Kill(); state.Text = "Đang dừng sắp xếp…"; }
            catch (InvalidOperationException) { }
        }

        private void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (mobileServer != null) { mobileServer.Dispose(); mobileServer = null; }
            CancelWork();
        }

        private void DeleteTemporaryScript()
        {
            try { if (!string.IsNullOrEmpty(temporaryScript) && File.Exists(temporaryScript)) File.Delete(temporaryScript); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            temporaryScript = null;
            try { if (!string.IsNullOrEmpty(temporaryProxies) && File.Exists(temporaryProxies)) File.Delete(temporaryProxies); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            temporaryProxies = null;
        }
    }
}
