# Auto Dược Công 0.2.0 — đang kiểm chứng

Phạm vi người dùng yêu cầu: toàn bộ việc Dược Công tại Đại Phu, không bao gồm nhiệm vụ chính hoặc nhiệm vụ tông môn.

## Đã triển khai

- Đọc đủ tám loại việc bằng `Quest.seedTaskList()` đã đối chiếu mã nguồn.
- Phân biệt việc sẵn sàng, hết lượt, khóa và hoạt động chưa có bộ thực thi.
- Bộ điều phối cho Linh Chi, câu cá, đưa người về làng, Trúc Tâm và Dược Mộc. Những bộ xử lý này vẫn cần kiểm chứng thực tế từng loại.
- Nhận/giao bằng nút hội thoại của game; di chuyển bằng Pathfinder; chọn đúng đối tượng bằng cơ chế đổi mục tiêu và gửi E.
- Đọc `autoSeedStep()` để xác định nơi làm việc. Đây là hàm lập bước chỉ đọc; không gọi tính năng tự làm Dược Công đang khóa theo cảnh giới.
- Không gọi trực tiếp các hàm nhận thưởng, sửa flags, inventory, tiền hoặc điều kiện cảnh giới.
- Một module giữ quyền di chuyển; Stop/Esc/thao tác tay/tab ẩn dừng công cụ. Nhiệm vụ đã nhận được giữ nguyên.
- Giới hạn ba lần giao lại đường, 65 giây/đích, ba phút không có tiến độ, mười phút/nhiệm vụ và một giờ/phiên.

## Kết quả trực tiếp ban đầu

Log `evidence/quest-live-first.json`: tự nhận Linh Chi Dưới Chân Núi, giao nguyên liệu có sẵn trong túi, vòng tăng 33 → 34, nhận thêm 1 Dược Công. Lần này không chứng minh đã tự hái Linh Chi.

Lần tiếp theo kiểm tra đi thu thập được ghi trong `evidence/quest-live-gather.json`. Chỉ tính hoàn thành nếu có bản ghi `QUEST_COMPLETED` với vòng nhiệm vụ mới.

Cập nhật: lần thu thập ban đầu dừng do sai số tới waypoint; đã sửa khoảng dung sai và thêm kiểm thử hồi quy. `evidence/quest-live-gather-retry.json` xác nhận tiếp tục nhiệm vụ đang giữ, tự hái thêm Linh Chi, đi về qua các cổng tới Đại Phu, giao nguyên liệu và nhận thêm 1 Dược Công, vòng 34 → 35. Có tổng cộng hai lượt giao thành công trong phiên kiểm tra (lượt đầu dùng nguyên liệu có sẵn).

Phiên chạy tiếp nhận lượt Linh Chi cuối rồi bị dừng bởi thao tác chuột trong game. `evidence/quest-live-batch.json` ghi nhận STOPPED tại Rừng Trúc, vẫn giữ nhiệm vụ Linh Chi ở tiến độ 0/3, vòng 35. Không tự bật lại sau thao tác tay. Các việc còn lại chưa được kiểm chứng.

Kiểm thử hiện tại: 23 bài kiểm thử Node đã qua, gồm lỗi dung sai waypoint, không tự nhận nhầm hội thoại, không báo hoàn thành khi chưa có vòng nhiệm vụ mới và không tự hủy hoạt động chưa hỗ trợ.

## Phần chưa hoàn thành

- Chưa có bộ thực thi Chiến Bảng, Đại Hội và Vận Tiêu. Hai hoạt động chiến đấu cần xác minh đăng ký, chọn đối thủ và kết quả; Vận Tiêu còn phụ thuộc cảnh giới/giờ hoạt động.
- Tất cả bộ xử lý thu thập/câu cá/hộ tống chưa được coi là chạy ổn chỉ vì kiểm thử mô phỏng đã qua.
- Chưa tích hợp Auto Farm cũ vào bộ điều phối.

Vì vậy bản 0.2.0 chưa đáp ứng trọn vẹn yêu cầu tự làm toàn bộ việc Dược Công.

## Điều khiển

Sau khi tắt các Auto khác và đứng dậy, chọn xác nhận trên bảng rồi bấm **Chạy việc Dược Công**. Mặc định lặp các việc thường còn lượt; **Dừng sau một lượt hoàn thành** giới hạn phiên ở một lượt. Các hoạt động chưa hỗ trợ được báo `PENDING_ACTIVITIES`, không báo hoàn thành toàn bộ.

Các API điều khiển bổ sung:

```javascript
TuTienAuto.startQuests({ otherScriptsStopped: true });
TuTienAuto.startQuests({ otherScriptsStopped: true, maxRuns: 1, only: ['cau_ca'] });
TuTienAuto.stop();
TuTienAuto.report(); // gồm quests và duocCong
```

Tùy chọn `only` chỉ lọc việc mới nhận, không tự hủy nhiệm vụ đang giữ.
