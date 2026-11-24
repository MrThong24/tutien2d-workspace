# Vườn Cá Nhân — bản 0.3.0

Người dùng yêu cầu kiểm tra và tự động hóa vòng đánh quái → về đúng đài đá tọa thiền tăng Đạo Hạnh, đồng thời trồng nguyên liệu và luyện đan theo cảnh giới.

## Đã xác minh trực tiếp

- Map `vuon_ca_nhan`, phạm vi cá nhân, hai mục tiêu `dlt_1` và `dlt_2`.
- Đài đá `dai_da_duoc` nằm trong `flatProps`, tọa độ runtime `(272,256)`, điểm tương tác `(272,240)`. Đi tới đây và tương tác E để game bật tọa thiền có thưởng EXP. Không chỉ gửi Q ở vị trí bất kỳ.
- Nhân vật đã tự chiến đấu, tắt Auto sau khi quái chết, về đài đá và chuyển sang `sit` với `meditateBonusExp: true`.
- Log đã ghi nhận các lần MEDITATE → COMBAT → RETURN_TO_STONE → MEDITATE.
- Đã luyện được một Phá Cảnh Đan: túi tăng 0 → 1, nguyên liệu Bích Vân Diệp giảm 6 → 3, Long Huyết Thảo giảm 4 → 1.
- Đã gieo và tưới Long Huyết Thảo ở `plot_1`, `plot_2`. Hai luống có seed đúng và thời gian còn lại giảm theo máy chủ. Chưa chờ tới thu hoạch trong lần kiểm chứng này.

Các bằng chứng: `evidence/garden-before.json`, `garden-live.json`, `garden-seeds.json`, `garden-debug.json`.

## Luồng đã triển khai

1. Tự đi vào vườn qua cổng thật.
2. Có quái: đóng hội thoại chăm cây, đứng dậy nếu đang ngồi, bật Auto chiến đấu bằng T sau khi kiểm tra `SceneWorld.autoOn`.
3. Hết quái: xóa đường đuổi trước và sau khi tắt Auto, ưu tiên thu hoạch cây chín/tưới cây, luyện đan nếu đủ nguyên liệu, gieo hạt có sẵn theo lượng còn thiếu.
4. Khi không có việc chăm cây cần làm: về đài đá và tương tác để tọa thiền tăng EXP. Quái hồi sinh sẽ ngắt việc tọa thiền và chuyển sang đánh.
5. Công thức đan và số viên mục tiêu lấy từ điều kiện đột phá của cảnh giới hiện tại; không tự tiêu thụ đan để đột phá.
6. Thiếu hạt: lập kế hoạch đổi gói phù hợp ở Đại Phu, kiểm tra cảnh giới/Dược Công, giới hạn tổng 30 Dược Công mỗi phiên. Chỉ tính đổi thành công khi thấy hạt vào túi; không xác nhận trong bảy giây thì ngừng tự đổi và trở về vườn.

## Giới hạn hiện tại

- Lần tự đổi Gói Hạt Phá Cảnh Đan chưa được xác nhận: sau thao tác, hạt chưa tăng và Dược Công vẫn 33. Bộ điều phối đã trở về vườn, không tiếp tục gửi lệnh đổi liên tục. Chưa xác định nguyên nhân từ giao diện/phản hồi máy chủ; không được coi phần tự đổi hạt đã kiểm chứng thành công.
- Thu hoạch cây chín và lượt luyện đan tiếp theo có code nhưng chưa kiểm chứng tới cuối chu kỳ cây.
- Nếu hai lần gieo không thấy trạng thái luống cập nhật, dừng tự gieo trong phiên đó; chiến đấu/tọa thiền vẫn tiếp tục. Không ghi nhận click gieo là gieo thành công.
- Phiên tự động tối đa một giờ, dừng khi HP thấp, nhân vật gục, rời vườn hoặc người chơi lấy quyền điều khiển. Phi hành tắt trong vườn để chăm cây và tọa thiền.
- Module mới dùng chung bộ điều phối, không bật hai script Farm cũ trong Tampermonkey BETA.

## Kiểm thử

38 kiểm thử Node đã qua, bao gồm không bật/tắt Auto liên tục, đứng dậy khi quái hồi sinh, xóa đường đuổi quái, Stop nhả quyền điều khiển, không chạy đồng thời với Auto Quest, không mặc định quái vắng khi thiếu dữ liệu, tiếp cận đan lô qua tile lân cận và chọn đúng gói hạt cho nguyên liệu thiếu.

Chế độ vườn đang chạy trên Chrome sau khi kiểm chứng. Nút **Stop** dừng chế độ; thao tác tay hoặc ẩn tab cũng dừng.
