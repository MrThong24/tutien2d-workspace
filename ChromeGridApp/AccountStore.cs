using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

namespace ChromeGridApp
{
    internal sealed class AccountEntry
    {
        public int Profile { get; set; }
        public string Username { get; set; }
        public string Password { get; set; }
        public string Proxy { get; set; }
        public bool AutoSubmitLogin { get; set; }
    }

    internal static class AccountStore
    {
        public static string FilePath { get { return Path.Combine(SecretStore.Root, "accounts.dat"); } }

        public static List<AccountEntry> Load()
        {
            if (!File.Exists(FilePath)) return new List<AccountEntry>();
            AccountEntry[] rows = new JavaScriptSerializer().Deserialize<AccountEntry[]>(SecretStore.Read(FilePath));
            return (rows ?? new AccountEntry[0]).Where(x => x != null && x.Profile >= 1 && x.Profile <= 20).OrderBy(x => x.Profile).ToList();
        }

        public static void Save(IEnumerable<AccountEntry> entries)
        {
            var rows = (entries ?? Enumerable.Empty<AccountEntry>()).OrderBy(x => x.Profile).ToArray();
            if (rows.Length > 20 || rows.Any(x => x.Profile < 1 || x.Profile > 20) || rows.Select(x => x.Profile).Distinct().Count() != rows.Length)
                throw new InvalidOperationException("Danh sách acc/profile không hợp lệ.");
            SecretStore.Write(FilePath, new JavaScriptSerializer().Serialize(rows));
        }

        public static int NextProfile(IEnumerable<AccountEntry> entries)
        {
            var used = new HashSet<int>((entries ?? Enumerable.Empty<AccountEntry>()).Select(x => x.Profile));
            for (int i = 1; i <= 20; i++) if (!used.Contains(i)) return i;
            throw new InvalidOperationException("Đã đủ 20 profile; hãy xóa hoặc gộp acc trước.");
        }
    }
}
