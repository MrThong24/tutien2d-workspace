# Sửa nhặt Dược Mộc — 0.2.2

Lỗi quan sát được: nhiệm vụ Dược Mộc đứng ở 2/5, log báo ba lần PATH_FAILED khi đi tới cành rơi ở tọa độ lẻ `(1058.856,777.059)`.

Nguyên nhân: bộ điều phối tìm tâm ô trong vòng 8 pixel quanh cành. Tọa độ cành không trùng tâm ô nên có thể không tìm được ứng viên nào, mặc dù cành ở vị trí có thể nhặt.

Đã đối chiếu `loot.1efedc3da3ba.js`: `Loot.PICK_R=40`. Bộ tự làm sẵn có của game tiếp cận cành với khoảng cách `PICK_R-12`. Bản mới đọc bán kính runtime và dùng cùng khoảng tiếp cận, lọc vật liệu đúng nhiệm vụ và ưu tiên cành gần hơn. Không sửa inventory hoặc tiến độ nhiệm vụ.

Đã thêm thông tin chỉ đọc `materialDrops`, `pickupRadius`, trạng thái chặt/câu vào diagnostic để chẩn đoán. Đã thêm kiểm thử hồi quy cho cành rơi ở tọa độ lẻ; tổng 30 kiểm thử Node đã qua.

Đã sao lưu script 0.2.1, cài 0.2.2 và tiếp tục nhiệm vụ đang giữ. Log `evidence/duoc-moc-retry.json` xác nhận tiến độ tăng từ 2/5 lên 5/5, sau đó quay về Đại Phu. Kết quả giao việc nằm trong `evidence/duoc-moc-after.json` nếu lượt đã được game xác nhận.
