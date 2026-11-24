using System;
using System.Drawing;
using System.Windows.Forms;

namespace ChromeGridApp
{
    internal sealed class AddAccountDialog : Form
    {
        private readonly TextBox username = new TextBox();
        private readonly TextBox password = new TextBox();
        private readonly TextBox proxy = new TextBox();
        private readonly CheckBox autoSubmit = new CheckBox();
        private readonly Label error = new Label();
        private readonly int profile;

        public AccountEntry Account { get; private set; }
        public bool OpenAfterSave { get; private set; }

        public AddAccountDialog(int profile)
        {
            this.profile = profile;
            Text = "Thêm profile · Profile" + profile.ToString("00");
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false;
            ClientSize = new Size(560, 330);
            Font = new Font("Segoe UI", 9F);

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 7, Padding = new Padding(14) };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            for (int i = 0; i < 5; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(layout);

            var heading = new Label { Text = "Proxy là bắt buộc. Tài khoản và mật khẩu có thể để trống nếu bạn sẽ đăng nhập trong Chrome.", AutoSize = true, MaximumSize = new Size(490, 0), Margin = new Padding(0, 0, 0, 8) };
            layout.Controls.Add(heading, 0, 0); layout.SetColumnSpan(heading, 2);

            username.Dock = DockStyle.Fill;
            password.Dock = DockStyle.Fill; password.UseSystemPasswordChar = true;
            proxy.Dock = DockStyle.Fill;
            AddField(layout, 1, "Tài khoản (tùy chọn):", username);
            AddField(layout, 2, "Mật khẩu (tùy chọn):", password);
            AddField(layout, 3, "Proxy Chrome:", proxy);

            autoSubmit.Text = "Tự gửi đăng nhập khi trang game sẵn sàng";
            autoSubmit.Checked = true;
            autoSubmit.AutoSize = true; autoSubmit.Margin = new Padding(0, 6, 0, 4);
            layout.Controls.Add(autoSubmit, 0, 4); layout.SetColumnSpan(autoSubmit, 2);
            username.TextChanged += delegate { UpdateLoginOptions(); };
            password.TextChanged += delegate { UpdateLoginOptions(); };

            error.AutoSize = true; error.ForeColor = Color.DarkRed; error.Margin = new Padding(0, 4, 0, 4);
            layout.Controls.Add(error, 0, 5); layout.SetColumnSpan(error, 2);

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, AutoSize = true };
            var cancel = new Button { Text = "Hủy", DialogResult = DialogResult.Cancel, AutoSize = true };
            var open = new Button { Text = "Lưu và mở Chrome", AutoSize = true };
            var save = new Button { Text = "Chỉ lưu profile", AutoSize = true };
            open.Click += delegate { if (Save(true)) DialogResult = DialogResult.OK; };
            save.Click += delegate { if (Save(false)) DialogResult = DialogResult.OK; };
            buttons.Controls.Add(cancel); buttons.Controls.Add(open); buttons.Controls.Add(save);
            layout.Controls.Add(buttons, 0, 6); layout.SetColumnSpan(buttons, 2);
            AcceptButton = open; CancelButton = cancel;
        }

        private void UpdateLoginOptions()
        {
            bool hasBoth = !string.IsNullOrWhiteSpace(username.Text) && !string.IsNullOrWhiteSpace(password.Text);
            autoSubmit.Enabled = hasBoth;
        }

        private static void AddField(TableLayoutPanel layout, int row, string title, Control input)
        {
            layout.Controls.Add(new Label { Text = title, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 7, 8, 5) }, 0, row);
            input.Margin = new Padding(0, 3, 0, 3); layout.Controls.Add(input, 1, row);
        }

        private bool Save(bool openAfter)
        {
            try
            {
                string name = username.Text.Trim();
                string secret = password.Text;
                if ((name.Length == 0) != (secret.Length == 0)) throw new InvalidOperationException("Hãy nhập cả tài khoản và mật khẩu, hoặc để trống cả hai để đăng nhập trong Chrome.");
                if (name.Length > 0 && (name.Length < 3 || name.Length > 32)) throw new InvalidOperationException("Tài khoản phải có từ 3 đến 32 ký tự.");
                ProxyEntry parsed = ProxyEntry.Parse(proxy.Text);
                Account = new AccountEntry { Profile = profile, Username = name, Password = secret, Proxy = parsed.Value, AutoSubmitLogin = name.Length > 0 && autoSubmit.Checked };
                OpenAfterSave = openAfter;
                error.Text = "";
                return true;
            }
            catch (Exception ex) { error.Text = ex.Message; return false; }
        }
    }
}
