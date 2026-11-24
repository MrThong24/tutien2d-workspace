# Sửa gieo hạt 0.3.2

Đã cài trong Tampermonkey thường và chạy thử trên Chrome ngày 17/11/2026.

Trước khi sửa, một số lần bấm gieo không được dữ liệu game giữ lại, trong khi bộ đếm hai lỗi khiến phiên ngừng gieo. Chưa xác định riêng nguyên nhân phía máy chủ. Bản sửa chờ vị trí tại luống ổn định 1,2 giây, thực hiện nút gieo qua Chrome UI Automation và đợi ít nhất 1,8 giây để xác nhận ô đất. Một lần gieo thành công đặt lại bộ đếm lỗi liên tiếp. Khi quái xuất hiện, hủy yêu cầu chưa thực hiện và ưu tiên chiến đấu.

Kiểm chứng: hai hạt Long Huyết còn lại đã vào plot_4 và plot_5, túi không còn hạt, cả hai cây được tưới. Trạng thái lưu trong `evidence/plant-fix-settled.json`: hai cây Bích Vân, ba cây Long Huyết, 23 Dược Công, hai Phá Cảnh Đan. Có sẵn một Bích Vân trong túi nên không cần gieo thêm cây thứ ba. Phiên vẫn đang chiến đấu/chăm vườn. 49 kiểm thử tự động đạt.

## Trợ lý Chrome

`scripts/garden-native-ui.ps1` chạy tối đa một giờ. Chỉ xử lý yêu cầu từ bảng điều khiển ở tab `tutien2d.com/?choi`, với ba nhóm nút: Gieo Hạt, Vẫn đổi Gói Hạt, Bắt Đầu Phá Quan. Không đọc thông tin đăng nhập, không gửi lệnh mạng. Nếu trợ lý không hoạt động, yêu cầu quá năm giây làm phiên dừng và báo lỗi.

Để khởi động lại sau phiên hiện tại, chạy một tiến trình (tránh mở nhiều bản):

```powershell
Start-Process powershell.exe -ArgumentList '-NoProfile','-File','D:\Auto\tutien2d-automation\scripts\garden-native-ui.ps1' -WindowStyle Hidden
```

Sau đó mở game, tắt các Auto khác, đứng dậy/đóng menu và bấm nút vào vườn trên bảng điều khiển. Thao tác tay, ẩn tab hoặc Stop sẽ ngừng phiên. Không tự chạy lại sau khi bạn dừng.

## Phạm vi kiểm chứng khác

Đã kiểm chứng thủ công đổi gói Phá Cảnh Đan tại Đại Phu bằng 10 Dược Công, nhận ba hạt mỗi loại; chu kỳ trước đã thu hoạch và luyện được viên đan thứ hai. Chưa kiểm chứng trọn chu kỳ thu hoạch các cây vừa gieo với bản 0.3.2.

Tự đột phá chỉ bấm khi `Breakthrough.check` xác nhận đầy đủ điều kiện và không bị chặn. Luyện Khí 12 lên 13 được hỗ trợ nhưng chưa thực hiện thật vì chưa đủ Đạo Hạnh và ba viên đan. Quy trình đặc biệt từ Luyện Khí 13 lên Trúc Cơ chưa tự động hóa.
