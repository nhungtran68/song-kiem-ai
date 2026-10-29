# Song Kiếm AI

Ứng dụng Next.js/TypeScript để chọn ảnh hoặc video trên thiết bị, phân tích các khung hình bằng OpenAI, tạo và sửa kịch bản hai nhân vật A/B, chọn giới tính và giọng Saydi độc lập, ghép audio WAV và xuất kịch bản/phụ đề để dựng video bên ngoài.

## Nhân vật và quản trị giọng

- Mỗi nhân vật A/B chọn **Nam/Nữ** và giọng từ danh sách xổ xuống. Có thể dùng hai nam, hai nữ hoặc nam–nữ, với hai mã giọng độc lập.
- Quản trị tại `/admin/voices`: đăng nhập bằng mật khẩu `VOICE_ADMIN_PASSWORD` từ 12 ký tự. Cookie phiên HttpOnly, SameSite Strict, hết hạn sau 8 giờ; các thay đổi cần cùng origin. Giới hạn đăng nhập 15 lượt/5 phút dùng kho lưu chung, kể cả khi chạy nhiều máy chủ.
- Thư viện đọc giọng hệ thống từ `GET /samples`, giọng clone của tài khoản từ `GET /v1/voices`. Chỉ lấy metadata cần hiển thị; không trả transcript tham chiếu. Clone chưa ready không được thêm mới. Clone chưa có giới tính cần chọn Nam/Nữ trước khi đưa lên danh sách.
- Chọn nhiều giọng rồi bấm **Lưu danh sách dùng chung**. Chỉ những giọng đã chọn xuất hiện trong studio. Bỏ chọn không xóa giọng tại Saydi. Hai mã giọng cũ được giữ nguyên khi mở bản nháp v1/v2; các slot nam/nữ cũ chuyển thành A/B.
- Cấu hình dùng chung lưu trong Vercel Blob **Private**, tệp `settings/voice-library.json`; dùng ETag chống ghi đè thay đổi ở phiên khác. Kho chỉ lưu cấu hình và hạn mức đăng nhập, không lưu ảnh/video/audio.
- Kết nối kho Private vào dự án Vercel để tự thêm `BLOB_STORE_ID` và dùng OIDC. Khi chạy local có thể cấp `BLOB_READ_WRITE_TOKEN` của cùng kho. Thiếu kho/mật khẩu thì quản trị khóa lại, không lưu giả trong bộ nhớ tạm.
- Mẫu nghe từ API Saydi (`/samples/{id}/audio` hoặc `/v1/voices/{id}/preview`), không tạo TTS mới. Tạo audio lời thoại vẫn tính credits theo ký tự.

## Cách dùng

Nếu đã có kịch bản: dán tối đa 20.000 ký tự vào **Ý tưởng hoặc kịch bản có sẵn**, rồi bấm **Dùng kịch bản đã nhập**. Không cần ảnh/video hoặc OpenAI. Mỗi lượt thoại nên bắt đầu bằng `NAM:` hoặc `NỮ:`; nhận cả `nu:`, `Giọng nam:`, `[NỮ]`, nhãn đứng riêng và cảm xúc như `NAM (trầm):`. Ví dụ:

```text
A (trầm): Xin chào.
B (vui): Chào bạn!
```

Có thể ghi mốc `[00:00 - 00:05] A: Lời thoại...`. Khi không có mốc, hệ thống ước tính theo độ dài câu, cho sửa lại trước khi tạo giọng. Đoạn dài được chia nhỏ, giữ toàn bộ lời thoại. Dòng tiếp theo dùng cùng nhân vật; văn bản không có nhãn dùng nhân vật mặc định theo chế độ giọng hiện tại. Nhãn NAM/NỮ vẫn nhận theo giới tính đã chọn; nếu hai nhân vật cùng giới tính, dùng A:/B: để phân biệt.

Khi OpenAI trả lỗi hết credits/hạn mức, giới hạn tốc độ, lỗi truy cập hoặc tạm ngừng, ứng dụng tự tách phần chữ đã nhập và ghi rõ **Kịch bản đã nhập**, không báo đã phân tích hình ảnh. Nếu chưa có chữ hoặc định dạng sai, nội dung biên tập trước đó được giữ. Không tự gọi AI lại sau lỗi quota; có nút thử lại khi bạn muốn. Tách chữ không dùng credits OpenAI; tạo giọng vẫn tính credits SaydiVoice.

Nếu cần AI phân tích hình ảnh:

1. Chọn ảnh hoặc video. Tệp gốc chỉ được mở trong trình duyệt, không tải lên máy chủ hay kho lưu trữ.
2. Chọn phong cách, nhập ý tưởng tùy chọn rồi nhấn **Phân tích bằng OpenAI**. Trình duyệt lấy tối đa 8 khung hình JPEG thu nhỏ và gửi chúng qua `/api/analyze` tới OpenAI. Video gốc và âm thanh không được gửi. Vì AI chỉ thấy các khung hình mẫu, cần xem lại các chi tiết nằm giữa chúng.
3. Sửa tóm tắt, lời thoại, nhân vật, cảm xúc và mốc thời gian. Hai Voice ID SaydiVoice được giữ riêng. Kịch bản tự lưu trong `localStorage` của trình duyệt hiện tại; ảnh/video không được lưu.
4. Trong **Tạo âm thanh**, chọn **Theo từng nhân vật A / B**, **Chỉ dùng giọng nhân vật A** hoặc **Chỉ dùng giọng nhân vật B**. Khi dùng một giọng, mọi câu thoại đều được đọc bằng Voice ID đã chọn; toàn bộ nội dung và hai Voice ID vẫn được giữ để đổi lại sau. Lựa chọn này áp dụng cả nghe thử, lưu theo bản nháp và được ghi trong TXT.
5. Bấm **Tạo âm thanh toàn bộ** để ghép và tự tải **một file WAV hoàn chỉnh**. Chọn nối liên tục hoặc giữ khoảng nghỉ theo timeline. Nếu một câu đọc dài hơn dự kiến, câu sau lùi lại để giữ đủ lời. Có tiến trình và nút dừng; các đoạn đã tạo được dùng lại trong tab hiện tại khi nghe thử/tạo lại. Giới hạn 500 câu và 30 phút mỗi file; hãy giữ trang mở và tải file trước khi đóng trang.
6. Xuất **TXT** (gồm hai Voice ID, cảnh, lời thoại, thời gian) và **SRT** để ghép bằng công cụ ngoài. Ứng dụng không dựng MP4. File âm thanh được ghép trong trình duyệt, không cần kho lưu trữ hoặc tải video lên server.

## Cấu hình

Cần Node.js 24+ và pnpm 11.25+:

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Đặt các biến sau trong `.env.local` khi chạy tại máy hoặc Vercel → Project → Settings → Environment Variables. Thêm vào **Production** và **Preview**, rồi triển khai lại:

| Biến | Công dụng |
| --- | --- |
| `OPENAI_API_KEY` | Khóa OpenAI API để phân tích khung hình, chỉ đọc trên server. Đây là khóa từ OpenAI Platform, khác gói ChatGPT. |
| `OPENAI_MODEL` | Tùy chọn; mặc định `gpt-5.4-mini`. Model cần hỗ trợ ảnh và Structured Outputs. |
| `SAYDI_API_BASE_URL` | Mặc định `https://voice.saydi.ai/api`. |
| `SAYDI_API_KEY` | Khóa SaydiVoice `sv_live_...`, chỉ đọc trên server. |
| `SAYDI_MALE_VOICE_ID` / `SAYDI_FEMALE_VOICE_ID` | Giọng khởi tạo cho nhân vật A/B; các mã giọng cũ vẫn được giữ. |
| `BLOB_STORE_ID` | Kho Blob Private lưu cấu hình giọng dùng chung; dùng xác thực OIDC của Vercel. |
| `VOICE_ADMIN_PASSWORD` | Mật khẩu trang quản trị, ít nhất 12 ký tự, chỉ dùng trên server. |

**Không** thêm tiền tố `NEXT_PUBLIC_` vào khóa hoặc mật khẩu. `AI_GATEWAY_API_KEY` không cần; Vercel Blob chỉ dùng cho cấu hình giọng, không phục vụ lưu video.

## API và giới hạn

- `POST /api/analyze`: nhận tối đa 8 khung hình JPEG đã thu nhỏ, phân tích bằng OpenAI và trả kịch bản JSON đã kiểm tra. Giới hạn body 3,8 MB để nằm dưới giới hạn Vercel Function 4,5 MB.
- `GET /api/config`: trạng thái biến môi trường, không trả khóa.
- `GET /api/saydi/samples` và `POST /api/saydi/speech`: proxy SaydiVoice cùng origin. Speech thành công trả bytes audio; lỗi trả JSON, xử lý `429`, `Retry-After` và `X-OV-Limit`. Nghe thử sẽ tiêu tốn credits SaydiVoice theo `X-OV-Chars`.
- Video dài tối đa 2 giờ, tệp tối đa 2 GB trong trình duyệt. Việc đọc MOV/MP4/WEBM phụ thuộc codec mà trình duyệt hỗ trợ. Ảnh/video không lưu lại sau khi tải lại trang; bản nháp lời thoại thì có.
- Deployment công khai cho phép mọi người gọi AI/TTS bằng credits của chủ dự án, theo lựa chọn của chủ dự án. Trạng thái “sẵn sàng” chỉ cho thấy có biến môi trường, không chứng minh API key còn tiền/quyền truy cập.

Kiểm tra mã nguồn:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
