using System;
using System.Collections.Generic;

namespace ChromeGridApp
{
    internal sealed class CultivationEstimate
    {
        private sealed class Sample { public DateTime Time; public double Value; }
        private readonly List<Sample> samples = new List<Sample>();
        private string identity;
        private double lastTarget;

        public void Reset() { samples.Clear(); identity = null; lastTarget = 0; }

        public string Observe(string name, string realm, double current, double target, bool full, DateTime now)
        {
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(realm) || double.IsNaN(current) || double.IsInfinity(current) || double.IsNaN(target) || double.IsInfinity(target) || current < 0 || target <= 0) {
                Reset(); return "Chưa đủ dữ liệu để tính.";
            }
            string key = name + "\n" + realm;
            if (identity != key || lastTarget != target || (samples.Count > 0 && (now <= samples[samples.Count - 1].Time || (now - samples[samples.Count - 1].Time).TotalSeconds > 30 || current < samples[samples.Count - 1].Value))) {
                samples.Clear(); identity = key; lastTarget = target;
            }
            if (full || current >= target) { samples.Clear(); return "Đạo Hạnh đã đủ; còn cần kiểm tra các điều kiện đột phá khác."; }
            samples.Add(new Sample { Time = now, Value = current });
            while (samples.Count > 1 && (now - samples[0].Time).TotalMinutes > 5) samples.RemoveAt(0);
            double seconds = (now - samples[0].Time).TotalSeconds;
            if (seconds < 30) return "Đang đo tốc độ tăng Đạo Hạnh (cần ít nhất 30 giây).";
            double gain = current - samples[0].Value;
            if (gain < 0.01) return "Chưa thấy Đạo Hạnh tăng trong thời gian theo dõi; chưa ước tính được.";
            double remainingSeconds = (target - current) * seconds / gain;
            if (double.IsInfinity(remainingSeconds) || remainingSeconds > TimeSpan.FromDays(30).TotalSeconds) return "Trên 30 ngày nếu giữ tốc độ gần đây.";
            TimeSpan remaining = TimeSpan.FromSeconds(Math.Max(0, Math.Ceiling(remainingSeconds)));
            string time = remaining.TotalDays >= 1 ? ((int)remaining.TotalDays) + " ngày " + remaining.Hours + " giờ" :
                remaining.TotalHours >= 1 ? ((int)remaining.TotalHours) + " giờ " + remaining.Minutes + " phút" :
                remaining.TotalMinutes >= 1 ? ((int)remaining.TotalMinutes) + " phút " + remaining.Seconds + " giây" : remaining.Seconds + " giây";
            return "Khoảng " + time + " để đủ Đạo Hạnh, theo tốc độ gần đây; còn cần điều kiện đột phá khác.";
        }
    }
}
