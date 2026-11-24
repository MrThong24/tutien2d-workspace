using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace ChromeGridApp
{
    internal sealed class MobileServer : IDisposable
    {
        private readonly Func<object> state;
        private readonly Func<int, object> detail;
        private readonly Func<Dictionary<string, object>, Task<object>> action;
        private readonly byte[] secret;
        private TcpListener listener;
        private volatile bool running;
        private string host;
        public string Code { get; private set; }
        public string Address { get; private set; }

        public MobileServer(Func<object> state, Func<int, object> detail, Func<Dictionary<string, object>, Task<object>> action)
        {
            this.state = state; this.detail = detail; this.action = action;
            secret = new byte[16]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(secret);
            Code = Convert.ToBase64String(secret).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        public static IPAddress FindTailscaleAddress()
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces()) {
                if (nic.OperationalStatus != OperationalStatus.Up || (nic.Name.IndexOf("tailscale", StringComparison.OrdinalIgnoreCase) < 0 && nic.Description.IndexOf("tailscale", StringComparison.OrdinalIgnoreCase) < 0)) continue;
                foreach (var item in nic.GetIPProperties().UnicastAddresses) {
                    var bytes = item.Address.GetAddressBytes();
                    if (item.Address.AddressFamily == AddressFamily.InterNetwork && bytes[0] == 100 && bytes[1] >= 64 && bytes[1] <= 127) return item.Address;
                }
            }
            return null;
        }

        public void Start(IPAddress address)
        {
            if (running) throw new InvalidOperationException("Giao diện điện thoại đang chạy.");
            listener = new TcpListener(address, 0); listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            host = address + ":" + port; Address = "http://" + host + "/"; running = true;
            Task.Run((Action)AcceptLoop);
        }

        private void AcceptLoop()
        {
            while (running) {
                try { var client = listener.AcceptTcpClient(); Task.Run(() => Serve(client)); }
                catch (SocketException) { if (!running) return; }
                catch (ObjectDisposedException) { return; }
            }
        }

        private static string ReadHeader(NetworkStream stream)
        {
            var bytes = new MemoryStream(); byte[] end = { 13, 10, 13, 10 }; int match = 0;
            while (match < 4) {
                int b = stream.ReadByte(); if (b < 0 || bytes.Length >= 16384) throw new InvalidDataException();
                bytes.WriteByte((byte)b); match = b == end[match] ? match + 1 : b == end[0] ? 1 : 0;
            }
            return Encoding.ASCII.GetString(bytes.ToArray());
        }
        private bool Authenticated(string supplied)
        {
            if (supplied == null || !supplied.StartsWith("Bearer ", StringComparison.Ordinal)) return false;
            byte[] given = Encoding.ASCII.GetBytes(supplied.Substring(7)); byte[] expected = Encoding.ASCII.GetBytes(Code);
            int diff = given.Length ^ expected.Length;
            for (int i = 0; i < expected.Length; i++) diff |= expected[i] ^ (i < given.Length ? given[i] : 0);
            return diff == 0;
        }
        private void Serve(TcpClient client)
        {
            using (client) {
                try {
                    client.ReceiveTimeout = 7000; client.SendTimeout = 7000;
                    var stream = client.GetStream(); var lines = ReadHeader(stream).Split(new[] { "\r\n" }, StringSplitOptions.None);
                    var first = lines[0].Split(' '); if (first.Length != 3 || (first[0] != "GET" && first[0] != "POST")) { Reply(stream, 400, "text/plain", "Yêu cầu không hợp lệ"); return; }
                    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var line in lines.Skip(1)) { int i = line.IndexOf(':'); if (i > 0) { string key = line.Substring(0, i).Trim(); if (headers.ContainsKey(key)) { Reply(stream, 400, "text/plain", "Yêu cầu không hợp lệ"); return; } headers[key] = line.Substring(i + 1).Trim(); } }
                    string hostHeader; if (!headers.TryGetValue("Host", out hostHeader) || !string.Equals(hostHeader, host, StringComparison.OrdinalIgnoreCase)) { Reply(stream, 403, "text/plain", "Không hợp lệ"); return; }
                    string method = first[0], path = first[1];
                    if (method == "GET" && path == "/") { Reply(stream, 200, "text/html; charset=utf-8", ReadPage()); return; }
                    string auth; if (!headers.TryGetValue("Authorization", out auth) || !Authenticated(auth)) { Reply(stream, 401, "application/json", "{\"error\":\"Mã truy cập không đúng\"}"); return; }
                    if (!running) { Reply(stream, 503, "application/json", "{\"error\":\"Giao diện điện thoại đã tắt\"}"); return; }
                    if (method == "GET" && path == "/api/state") { Json(stream, state()); return; }
                    if (method == "GET" && path.StartsWith("/api/profile?number=", StringComparison.Ordinal)) {
                        int n; if (!int.TryParse(path.Substring("/api/profile?number=".Length), out n) || n < 1 || n > 20) { Reply(stream, 400, "application/json", "{\"error\":\"Profile không hợp lệ\"}"); return; }
                        Json(stream, detail(n)); return;
                    }
                    if (method == "POST" && path == "/api/action") {
                        string origin, type, size, transfer; int length;
                        if (!headers.TryGetValue("Origin", out origin) || !string.Equals(origin, "http://" + host, StringComparison.OrdinalIgnoreCase) ||
                            !headers.TryGetValue("Content-Type", out type) || !type.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) ||
                            !headers.TryGetValue("Content-Length", out size) || !int.TryParse(size, out length) || length < 2 || length > 4096 || headers.TryGetValue("Transfer-Encoding", out transfer)) {
                            Reply(stream, 403, "application/json", "{\"error\":\"Yêu cầu không hợp lệ\"}"); return;
                        }
                        byte[] body = new byte[length]; int offset = 0;
                        while (offset < length) { int read = stream.Read(body, offset, length - offset); if (read <= 0) throw new EndOfStreamException(); offset += read; }
                        var payload = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
                        if (payload == null) { Reply(stream, 400, "application/json", "{\"error\":\"Thiếu dữ liệu\"}"); return; }
                        if (!running) { Reply(stream, 503, "application/json", "{\"error\":\"Giao diện điện thoại đã tắt\"}"); return; }
                        var task = action(payload);
                        if (!task.Wait(TimeSpan.FromSeconds(70))) { Reply(stream, 503, "application/json", "{\"error\":\"Thao tác đang xử lý; kiểm tra lại trạng thái\"}"); return; }
                        Json(stream, task.GetAwaiter().GetResult()); return;
                    }
                    Reply(stream, 404, "text/plain", "Không tìm thấy");
                } catch (Exception) { }
            }
        }
        private static string ReadPage()
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("mobile.html")) {
                if (stream == null) throw new InvalidOperationException();
                using (var reader = new StreamReader(stream, Encoding.UTF8)) return reader.ReadToEnd();
            }
        }
        private static void Json(NetworkStream stream, object value) { Reply(stream, 200, "application/json; charset=utf-8", new JavaScriptSerializer().Serialize(value)); }
        private static void Reply(NetworkStream stream, int code, string contentType, string body)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(body);
            string reason = code == 200 ? "OK" : code == 400 ? "Bad Request" : code == 401 ? "Unauthorized" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : "Service Unavailable";
            string header = "HTTP/1.1 " + code + " " + reason + "\r\nContent-Type: " + contentType + "\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'\r\n\r\n";
            byte[] head = Encoding.ASCII.GetBytes(header); stream.Write(head, 0, head.Length); stream.Write(bytes, 0, bytes.Length);
        }
        public void Dispose() { running = false; if (listener != null) listener.Stop(); }
    }
}
