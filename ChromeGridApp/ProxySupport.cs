using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace ChromeGridApp
{
    internal static class SecretStore
    {
        public static string Root { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TuTienChromeGrid"); } }
        public static void Write(string path, string value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            byte[] data = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { File.WriteAllBytes(temp, data); if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path); }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        public static string Read(string path) { return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), null, DataProtectionScope.CurrentUser)); }
    }

    internal sealed class ProxyEntry
    {
        public string Scheme, Host, User, Password;
        public int Port;
        public bool HasAuth { get { return User != null; } }
        public string Endpoint { get { return Scheme + "://" + Host + ":" + Port; } }
        public string Value { get { return Scheme + "://" + (HasAuth ? User + ":" + Password + "@" : "") + Host + ":" + Port; } }
        public static ProxyEntry Parse(string text)
        {
            var m = Regex.Match((text ?? "").Trim(), @"^(?:(https?|socks5)://)?(?:([^\s:@/]+):([^\s@/]+)@)?(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):([0-9]{1,5})$", RegexOptions.IgnoreCase);
            int port;
            if (!m.Success || !int.TryParse(m.Groups[5].Value, out port) || port < 1 || port > 65535 || Uri.CheckHostName(m.Groups[4].Value.Trim('[', ']')) == UriHostNameType.Unknown)
                throw new InvalidOperationException("Proxy không hợp lệ. Dùng IP:PORT hoặc USER:PASS@IP:PORT.");
            string scheme = m.Groups[1].Success ? m.Groups[1].Value.ToLowerInvariant() : "http";
            if (m.Groups[2].Success && scheme != "http") throw new InvalidOperationException("Proxy có tài khoản hiện chỉ hỗ trợ giao thức HTTP.");
            return new ProxyEntry { Scheme = scheme, User = m.Groups[2].Success ? m.Groups[2].Value : null,
                Password = m.Groups[2].Success ? m.Groups[3].Value : null, Host = m.Groups[4].Value.ToLowerInvariant(), Port = port };
        }
    }

    internal static class ProxySupport
    {
        public static string PoolFile { get { return Path.Combine(SecretStore.Root, "proxy-pool.dat"); } }
        public static string AssignmentsFile { get { return Path.Combine(SecretStore.Root, "proxy-assignments.dat"); } }
        public static string ExtendAssignments(string content, string pool, int targetCount = 12)
        {
            var current = string.IsNullOrWhiteSpace(content) ? new List<string>() : ParseLines(content, true, 1).ToList();
            if (targetCount < 1 || targetCount > 20) throw new InvalidOperationException("Số profile phải từ 1 đến 20.");
            if (current.Count >= targetCount) return content;
            var used = new HashSet<string>(current.Select(ProxyEntry.Parse).Select(p => p.Host + ":" + p.Port), StringComparer.OrdinalIgnoreCase);
            foreach (string candidate in ParseLines(pool, false)) {
                var entry = ProxyEntry.Parse(candidate);
                if (used.Add(entry.Host + ":" + entry.Port)) current.Add(entry.Value);
                if (current.Count == targetCount) break;
            }
            return string.Join(Environment.NewLine, current);
        }
        public static string[] ParseLines(string content, bool requireTen, int minimumCount = 12)
        {
            var lines = (content ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
            int length = lines.Length;
            if (requireTen) {
                while (length > 0 && string.IsNullOrWhiteSpace(lines[length - 1])) length--;
                if (length < minimumCount || length > 20) throw new InvalidOperationException("Cần từ " + minimumCount + " đến 20 dòng proxy, mỗi profile một dòng.");
            }
            var result = new List<string>();
            for (int i = 0; i < length; i++) {
                if (string.IsNullOrWhiteSpace(lines[i])) {
                    if (requireTen) throw new InvalidOperationException("Dòng proxy " + (i + 1) + " đang trống.");
                    continue;
                }
                try { result.Add(ProxyEntry.Parse(lines[i]).Value); }
                catch (InvalidOperationException error) { throw new InvalidOperationException("Dòng " + (i + 1) + ": " + error.Message); }
            }
            if (requireTen && result.Count < minimumCount) throw new InvalidOperationException("Chưa đủ proxy cho các profile đã chọn.");
            return result.ToArray();
        }
        public static string[] RandomTen(string content, int count = 12, IEnumerable<string> reserved = null)
        {
            var excluded = new HashSet<string>((reserved ?? Enumerable.Empty<string>()).Select(ProxyEntry.Parse).Select(p => p.Host + ":" + p.Port), StringComparer.OrdinalIgnoreCase);
            var unique = ParseLines(content, false).Select(ProxyEntry.Parse).Where(p => !excluded.Contains(p.Host + ":" + p.Port)).GroupBy(p => p.Host + ":" + p.Port, StringComparer.OrdinalIgnoreCase).Select(g => g.First().Value).ToList();
            if (count < 1 || count > 20) throw new InvalidOperationException("Số profile phải từ 1 đến 20.");
            if (unique.Count < count) throw new InvalidOperationException("Cần ít nhất " + count + " địa chỉ proxy khác nhau để chọn ngẫu nhiên.");
            using (var rng = RandomNumberGenerator.Create()) {
                byte[] bytes = new byte[4];
                for (int i = unique.Count - 1; i > 0; i--) {
                    uint limit = uint.MaxValue - (uint.MaxValue % (uint)(i + 1)), value;
                    do { rng.GetBytes(bytes); value = BitConverter.ToUInt32(bytes, 0); } while (value >= limit);
                    int j = (int)(value % (uint)(i + 1)); string swap = unique[i]; unique[i] = unique[j]; unique[j] = swap;
                }
            }
            return unique.Take(count).ToArray();
        }
        public static string[] BrowserEndpoints(string[] values, int selectedProfile, bool startRelays)
        {
            var endpoints = new string[values.Length]; var usedPorts = new HashSet<int>();
            for (int i = 0; i < values.Length; i++) {
                ProxyEntry entry = ProxyEntry.Parse(values[i]);
                if (!entry.HasAuth) { endpoints[i] = entry.Endpoint; continue; }
                string id;
                using (var hash = SHA256.Create()) id = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes((i + 1) + "\n" + entry.Value))).Replace("-", "").ToLowerInvariant();
                int port = 20000 + (int)(Convert.ToUInt32(id.Substring(0, 8), 16) % 40000);
                if (!usedPorts.Add(port)) throw new InvalidOperationException("Hai proxy trùng cổng nội bộ; hãy chọn ngẫu nhiên lại.");
                endpoints[i] = "http://127.0.0.1:" + port;
                if (startRelays && (selectedProfile == 0 || selectedProfile == i + 1)) EnsureRelay(i + 1, port, id, entry.Value);
            }
            return endpoints;
        }
        private static string RelayFile(string id) { return Path.Combine(SecretStore.Root, "proxy-relays", id + ".dat"); }
        private static string MutexName(string id) { return @"Local\TuTienProxyRelay_" + id; }
        private static bool Exists(string id) { Mutex m; if (!Mutex.TryOpenExisting(MutexName(id), out m)) return false; m.Dispose(); return true; }
        private static void EnsureRelay(int profile, int port, string id, string value)
        {
            if (Exists(id)) return;
            SecretStore.Write(RelayFile(id), value);
            var info = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "--proxy-relay " + profile + " " + port + " " + id) {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
            using (var process = Process.Start(info)) {
                if (process == null) throw new InvalidOperationException("Không chạy được kết nối proxy của Profile" + profile.ToString("00") + ".");
                for (int i = 0; i < 50; i++) { if (Exists(id)) return; if (process.HasExited) break; Thread.Sleep(100); }
            }
            throw new InvalidOperationException("Không mở được cổng proxy nội bộ cho Profile" + profile.ToString("00") + ".");
        }

        public static int RunRelay(string[] args)
        {
            int profile, port;
            if (args.Length != 4 || !int.TryParse(args[1], out profile) || profile < 1 || profile > 20 || !int.TryParse(args[2], out port) || port < 20000 || port > 59999 || !Regex.IsMatch(args[3], "^[a-f0-9]{64}$")) return 2;
            string id = args[3];
            try {
                var entry = ProxyEntry.Parse(SecretStore.Read(RelayFile(id)));
                if (!entry.HasAuth || entry.Scheme != "http") return 2;
                var listener = new TcpListener(IPAddress.Loopback, port);
                try {
                    listener.Start();
                    bool created;
                    using (var mutex = new Mutex(true, MutexName(id), out created)) {
                        if (!created) return 0;
                        DateTime lastPresent = DateTime.UtcNow;
                        while (true) {
                            if (listener.Pending()) { var client = listener.AcceptTcpClient(); Task.Run(() => Handle(client, entry)); }
                            else Thread.Sleep(100);
                            if ((DateTime.UtcNow - lastPresent).TotalMinutes >= 3) {
                                if (!ChromeRunning(profile, port)) return 0;
                                lastPresent = DateTime.UtcNow;
                            }
                        }
                    }
                } finally { listener.Stop(); }
            } catch { return 1; }
        }
        private static bool ChromeRunning(int profile, int port)
        {
            string target = @"D:\Auto\ChromeProxy\Profile" + profile.ToString("00");
            try {
                using (var query = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE Name='chrome.exe'"))
                using (var rows = query.Get()) foreach (ManagementObject row in rows) {
                    string line = Convert.ToString(row["CommandLine"]);
                    if (string.IsNullOrEmpty(line) || Regex.IsMatch(line, @"(?:^|\s)--type=", RegexOptions.IgnoreCase)) continue;
                    var m = Regex.Match(line, "--user-data-dir=(?:\"([^\"]+)\"|(\\S+))", RegexOptions.IgnoreCase);
                    if (m.Success && string.Equals((m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value).TrimEnd('\\'), target, StringComparison.OrdinalIgnoreCase) &&
                        Regex.IsMatch(line, @"(?:^|\s)--proxy-server=(?:""?http://)?127\.0\.0\.1:" + port + @"(?:""|\s|$)", RegexOptions.IgnoreCase)) return true;
                }
                return false;
            } catch { return true; }
        }
        private static async Task Handle(TcpClient client, ProxyEntry entry)
        {
            using (client) using (var upstream = new TcpClient()) {
                try {
                    client.ReceiveTimeout = 15000;
                    var input = client.GetStream(); var header = new MemoryStream();
                    int match = 0; byte[] end = { 13, 10, 13, 10 };
                    while (match < 4) {
                        int b = input.ReadByte(); if (b < 0 || header.Length >= 32768) return;
                        header.WriteByte((byte)b); match = b == end[match] ? match + 1 : b == end[0] ? 1 : 0;
                    }
                    string raw = Encoding.ASCII.GetString(header.ToArray());
                    var lines = raw.Split(new[] { "\r\n" }, StringSplitOptions.None);
                    if (lines.Length < 2 || !Regex.IsMatch(lines[0], @"^[A-Z]+ [^\s]+ HTTP/1\.[01]$")) return;
                    bool tunnel = lines[0].StartsWith("CONNECT ", StringComparison.OrdinalIgnoreCase);
                    var request = new StringBuilder(lines[0] + "\r\n");
                    foreach (string line in lines.Skip(1)) {
                        if (line.Length == 0) continue;
                        if (line.StartsWith("Proxy-Authorization:", StringComparison.OrdinalIgnoreCase)) continue;
                        if (!tunnel && (line.StartsWith("Connection:", StringComparison.OrdinalIgnoreCase) || line.StartsWith("Proxy-Connection:", StringComparison.OrdinalIgnoreCase))) continue;
                        request.Append(line).Append("\r\n");
                    }
                    if (!tunnel) request.Append("Connection: close\r\nProxy-Connection: close\r\n");
                    request.Append("Proxy-Authorization: Basic ").Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(entry.User + ":" + entry.Password))).Append("\r\n\r\n");
                    var connecting = upstream.ConnectAsync(entry.Host.Trim('[', ']'), entry.Port);
                    if (await Task.WhenAny(connecting, Task.Delay(10000)) != connecting) return;
                    await connecting;
                    var remote = upstream.GetStream(); byte[] bytes = Encoding.ASCII.GetBytes(request.ToString());
                    await remote.WriteAsync(bytes, 0, bytes.Length);
                    Task a = input.CopyToAsync(remote), b2 = remote.CopyToAsync(input);
                    Task first = await Task.WhenAny(a, b2);
                    try { if (first == a) upstream.Client.Shutdown(SocketShutdown.Send); else client.Client.Shutdown(SocketShutdown.Send); } catch (SocketException) { }
                    await Task.WhenAny(first == a ? b2 : a, Task.Delay(30000));
                } catch (Exception) { }
            }
        }
    }
}
