# Phi hành trong bản 0.2.1

Đã thêm chế độ tự dùng phi hành cho di chuyển nhiệm vụ và đi tới Đại Phu. Không cần bật F thủ công trước khi Start.

- Chặng dài từ 180 pixel: kiểm tra `Player.canFly()` và vùng cấm, rồi gửi F một lần.
- Chờ `player.flying` xác nhận trước khi giao lại đường đi; không gửi phím bật/tắt liên tục.
- Gần đích dưới 100 pixel: hạ xuống, đợi xác nhận rồi lập lại đường đi bộ tới cổng/NPC/nguyên liệu.
- Giữ đường đi bộ hợp lệ; khi bay còn kiểm tra `rectFlyBlocked()` dọc đường. Nếu đường có vật cản bay, hạ xuống và đi bộ.
- Không dùng bay cho hộ tống hoặc áp tải xe tiêu; giữ các điều kiện cảnh giới, pháp khí, hàng hóa và vùng cấm của game.
- Bật bay bị từ chối: đi bộ và chờ ít nhất 60 giây trước khi thử lại. Hạ xuống không thành công: dừng trước khi tương tác.
- Stop dừng đường đi và trả quyền điều khiển; không tự bật/tắt phi hành sau khi người chơi đã lấy lại quyền điều khiển.

Nguồn đối chiếu: `world.d8cfef61c463.js` xử lý phím F; `player.a0e54b2ce7c0.js` định nghĩa canFly, flyMount, flySpeed, inNoFlyZone và landFly. Không gọi trực tiếp hàm sửa trạng thái flying hoặc sửa hệ số tốc độ.

Kiểm thử: 29 kiểm thử Node đã qua, gồm sáu kiểm thử riêng cho xác nhận trạng thái bay/hạ, từ chối cất cánh, vùng cấm, hộ tống/áp tải, vật cản và hạ không thành công.

Log `evidence/flight-live.json` ghi nhận lần thử trên nhân vật thật từ Rừng Trúc về Đại Phu, gồm FLIGHT_REQUEST và FLIGHT_CONFIRMED. Chế độ phi hành mới không bổ sung bộ thực thi cho Đại Hội, Chiến Bảng hoặc Vận Tiêu; những phần đó vẫn chưa hoàn tất.
