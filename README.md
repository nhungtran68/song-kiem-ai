# Song Kiếm AI

MVP Next.js/TypeScript tối ưu mobile cho quy trình biến ảnh hoặc video thành hội thoại hai nhân vật, chỉnh timeline và dựng MP4.

## Tính năng đã triển khai

- Upload trực tiếp từ trình duyệt lên Vercel Blob (multipart cho tệp lớn), không đẩy video qua giới hạn body của Vercel Function.
- Workflow dài có `runId`, polling trạng thái, retry ở từng step và hỗ trợ hủy.
- Lấy khung hình video bằng FFmpeg, gửi chuỗi khung hình theo timeline cho Vercel AI Gateway và nhận structured output đã kiểm tra bằng Zod.
- Trình biên tập tiếng Việt cho cảnh, nhân vật nam/nữ, cảm xúc, nội dung, thời điểm bắt đầu/kết thúc.
- Hai `voice_id` được giữ trong Local Storage, request job và kết quả workflow; không thay bằng tên giọng OpenAI.
- `GET /api/saydi/samples` gọi đúng base URL, Bearer auth, xử lý lỗi native `{ detail }`, `429`, `Retry-After` và `X-OV-Limit`.
- `POST /api/saydi/speech` cố ý trả `501` cho tới khi có schema payload chính thức. Không có request TTS giả hoặc field tự đoán.
- FFmpeg dựng MP4, burn-in phụ đề SRT và giữ audio gốc của video. Với ảnh, app tạo video tĩnh có phụ đề.
- Lỗi cấu hình được trả rõ bằng HTTP status và mã lỗi; secret chỉ đọc ở server.

## Chạy local

Yêu cầu Node.js 24+ và pnpm 11.25+.

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Các biến cấu hình:

- `BLOB_READ_WRITE_TOKEN`: do Vercel Blob cấp.
- `AI_GATEWAY_API_KEY`: cần cho local/ngoài Vercel. Trên Vercel có thể dùng OIDC tự động.
- `AI_GATEWAY_MODEL`: mặc định `openai/gpt-5.4-mini` (model vision + structured output đã có trong live catalog khi MVP được tạo).
- `SAYDI_API_KEY`: key dạng `sv_live_...`, chỉ ở server.
- `SAYDI_MALE_VOICE_ID`, `SAYDI_FEMALE_VOICE_ID`: ID từ `GET /samples` hoặc `vc_...`.

## Kiểm tra

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Giới hạn đã biết và trung thực

1. Tài liệu SaydiVoice được cung cấp chưa có request body của `POST /v1/audio/speech`, tên field multipart của `POST /v1/voices`, hoặc body của `POST /tts/clone`. Vì vậy MVP chưa tạo/mix audio TTS; endpoint speech trả `501` thay vì đoán payload.
2. Bản MVP chưa có đăng nhập. Blob đang dùng `access: public` để Workflow, FFmpeg và trình duyệt cùng đọc được media. Không tải nội dung nhạy cảm; production cần auth và private Blob/presigned URL.
3. AI Vision và render chỉ chạy live sau khi kết nối Blob + AI Gateway trên Vercel. Build/test local không tiêu tốn AI credits.
4. FFmpeg ở Vercel phụ thuộc binary Linux tải trong lúc install. Build production cần giữ build script của `ffmpeg-static` được phép.

## Luồng API

- `POST /api/upload`: cấp token upload Blob theo content type và giới hạn 2 GB.
- `POST /api/jobs`: tạo Workflow `analyze` hoặc `render`.
- `GET /api/jobs?runId=...`: đọc trạng thái/kết quả.
- `DELETE /api/jobs?runId=...`: hủy job.
- `GET /api/config`: readiness không chứa secret.
- `GET /api/saydi/samples`: proxy an toàn tới SaydiVoice.
- `POST /api/saydi/speech`: khóa an toàn cho tới khi có schema chính thức.
