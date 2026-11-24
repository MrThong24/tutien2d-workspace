using System;
using System.Linq;
namespace ChromeGridApp {
  internal static class TestProfiles {
    private static int Main() {
      var old = Enumerable.Range(1, 10).Select(i => "http://proxy" + i + ".example:3129").ToArray();
      var pool = Enumerable.Range(1, 15).Select(i => "http://proxy" + i + ".example:3129").ToArray();
      string migrated = ProxySupport.ExtendAssignments(string.Join("\n", old), string.Join("\n", pool));
      var actual = ProxySupport.ParseLines(migrated, true);
      if (actual.Length != 12 || !actual.Take(10).SequenceEqual(old) || actual[10] != pool[10] || actual[11] != pool[11]) return 1;
      if (ProxySupport.BrowserEndpoints(actual, 0, false).Length != 12) return 2;
      if (ProxySupport.RandomTen(string.Join("\n", pool)).Length != 12) return 3;
      if (!ProxySupport.ParseLines(ProxySupport.ExtendAssignments(string.Join("\n", old), string.Join("\n", old)), true, 10).SequenceEqual(old)) return 4;
      var pool20 = Enumerable.Range(1, 25).Select(i => "http://proxy" + i + ".example:3129").ToArray();
      var expanded = ProxySupport.ParseLines(ProxySupport.ExtendAssignments(string.Join("\n", old), string.Join("\n", pool20), 20), true, 20);
      if (expanded.Length != 20 || !expanded.Take(10).SequenceEqual(old)) return 5;
      if (ProxySupport.BrowserEndpoints(expanded.Take(10).ToArray(), 0, false).Length != 10) return 6;
      var reserved = pool20.Skip(10).Take(2).ToArray();
      if (ProxySupport.RandomTen(string.Join("\n", pool20), 10, reserved).Intersect(reserved).Any()) return 7;
      try { ProxySupport.ExtendAssignments(old[0] + "\n\n" + old[1], string.Join("\n", pool20), 12); return 8; }
      catch (InvalidOperationException) { }
      Console.WriteLine("12 profiles: migration and proxy endpoints OK");
      return 0;
    }
  }
}
