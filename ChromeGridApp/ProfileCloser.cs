using System;
using System.Collections.Generic;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace ChromeGridApp
{
    internal static class ProfileCloser
    {
        private delegate bool WindowCallback(IntPtr handle, IntPtr state);
        [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr state);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, StringBuilder name, int count);
        [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

        private static int ProfileNumber(string commandLine)
        {
            if (string.IsNullOrEmpty(commandLine) || Regex.IsMatch(commandLine, @"(?:^|\s)--type=", RegexOptions.IgnoreCase)) return 0;
            Match match = Regex.Match(commandLine, "(?:^|\\s)--user-data-dir=(?:\"([^\"]+)\"|(\\S+))", RegexOptions.IgnoreCase);
            if (!match.Success) return 0;
            string dir = (match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value).TrimEnd('\\', '/');
            for (int i = 1; i <= 20; i++)
                if (string.Equals(dir, @"D:\Auto\ChromeProxy\Profile" + i.ToString("00"), StringComparison.OrdinalIgnoreCase)) return i;
            return 0;
        }

        private static Dictionary<uint, int> FindProfiles()
        {
            var profiles = new Dictionary<uint, int>();
            using (var query = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='chrome.exe'"))
            using (var processes = query.Get())
            foreach (ManagementObject process in processes)
            {
                int number = ProfileNumber(Convert.ToString(process["CommandLine"]));
                if (number != 0) profiles[Convert.ToUInt32(process["ProcessId"])] = number;
            }
            return profiles;
        }

        public static string Close(int profileNumber = 0, int profileCount = 20)
        {
            if (profileCount < 1 || profileCount > 20 || profileNumber < 0 || profileNumber > profileCount) throw new ArgumentOutOfRangeException("profileNumber");
            string label = profileNumber == 0 ? "Profile01–Profile" + profileCount.ToString("00") : "Profile" + profileNumber.ToString("00");
            var profiles = FindProfiles().Where(p => p.Value <= profileCount && (profileNumber == 0 || p.Value == profileNumber)).ToDictionary(p => p.Key, p => p.Value);
            if (profiles.Count == 0) return "Không có Chrome " + label + " đang mở.";
            int windows = 0;
            EnumWindows(delegate(IntPtr handle, IntPtr ignored) {
                uint id; GetWindowThreadProcessId(handle, out id);
                if (!profiles.ContainsKey(id)) return true;
                var name = new StringBuilder(128); GetClassName(handle, name, name.Capacity);
                if (name.ToString() == "Chrome_WidgetWin_1" && PostMessage(handle, 0x0010, IntPtr.Zero, IntPtr.Zero)) windows++;
                return true;
            }, IntPtr.Zero);
            Thread.Sleep(3000);
            var remaining = FindProfiles().Values.Where(i => i <= profileCount && (profileNumber == 0 || i == profileNumber)).Distinct().OrderBy(i => i).Select(i => "Profile" + i.ToString("00")).ToArray();
            if (remaining.Length != 0)
                return "Đã gửi lệnh đóng " + windows + " cửa sổ. Còn tiến trình: " + string.Join(", ", remaining) + ". Hãy kiểm tra hộp thoại Chrome hoặc ứng dụng chạy nền.";
            return "Đã đóng Chrome " + label + " (" + windows + " cửa sổ).";
        }    }
}
