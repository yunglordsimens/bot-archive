import type { Dict } from "./types.js";

export const vi: Dict = {
  code: "vi",
  langName: "Tiếng Việt",
  flag: "🇻🇳",
  locale: "vi-VN",
  geminiLanguage: "Vietnamese",

  types: { tip: "mẹo", recipe: "công thức", idea: "ý tưởng", funny: "hài hước", reference: "tham khảo", other: "khác" },
  sources: {
    tiktok: "🎵 tiktok", youtube: "▶️ youtube", instagram: "📸 reels", link: "🔗 liên kết", text: "📝 văn bản", forwarded: "↪️ chuyển tiếp",
    screenshot: "🖼 ảnh chụp", voice: "🎙 tin nhắn thoại", audio: "🎧 âm thanh", video: "🎬 video", video_note: "⭕️ video tròn", document: "📄 tệp", profile: "👤 hồ sơ",
  },
  stance: {
    like: "❤️ thích", dislike: "👎 không thích", anti_example: "🚫 ví dụ ngược", replicate: "🎯 muốn làm theo",
    format_idea: "🧪 ý tưởng định dạng", seen_before: "👀 đã thấy rồi", example: "🔖 ví dụ", interesting: "🤔 thú vị",
  },
  value: { info: "📚 thông tin", visual: "🖼 hình ảnh", audio: "🎧 âm thanh", format: "🎬 định dạng", meta: "🧠 meta" },
  defaultThemes: ["kiểu chữ & phông chữ", "tham khảo thiết kế", "hook & marketing", "tiền & ý tưởng kinh doanh", "code & công cụ", "học tập", "công thức nấu ăn", "hài hước", "khác"],
  defaultProjects: ["công việc", "học tập", "ý tưởng kinh doanh", "sáng tạo", "sức khỏe & gia đình", "khác"],

  forms: {
    points: { one: "ý", other: "ý" },
    steps: { one: "bước", other: "bước" },
    screens: { one: "ảnh chụp", other: "ảnh chụp" },
    items: { one: "mục", other: "mục" },
  },

  btn: { recent: "🕘 Gần đây", projects: "🧭 Lĩnh vực", themes: "🗂 Chủ đề", types: "🏷 Loại", status: "📊 Trạng thái", help: "❓ Trợ giúp" },
  accepted: "đã nhận",
  tooBig: "quá lớn (>20 MB) — không xử lý được",
  tooBigN: (n) => `${n} quá lớn (>20 MB)`,
  dbDown: (hint) => `❌ chưa lưu: cơ sở dữ liệu không truy cập được (${hint})`,
  dbBadKey: "SUPABASE_SERVICE_ROLE_KEY trong .env không đúng",

  stage: {
    download: "⬇️ đang tải…", read: "🔎 đang đọc…", think: "🧠 đang phân tích…", thinkVideo: "🧠 đang phân tích video…", thinkImages: "🧠 đang phân tích ảnh…",
    noVideo: "🧠 không tải được video, đang phân tích chú thích…", format: "🎬 đang phân tích định dạng…",
    retryIn: (reason, min) => `⏳ ${reason} — sẽ thử lại sau ${min} phút`,
  },
  pendingNote: "⏳ không tải được video — đã lưu liên kết và chú thích, sẽ thử lại sau một ngày",
  inArchive: "🗄 trong kho",
  dup: (date, times) => `♻️ <b>lặp lại</b> — đã lưu ngày ${date}${times && times > 2 ? ` · đây là lần thứ ${times}` : ""}`,
  stillProcessing: "vẫn đang xử lý…",
  errors: {
    overloaded: "Gemini đang quá tải", quota: "giới hạn yêu cầu Gemini", key: "khóa Gemini không hợp lệ", channel: "kênh lưu trữ không truy cập được",
    json: "mô hình trả về câu trả lời khó hiểu", network: "mất kết nối", unknown: "lỗi không xác định", other: (e) => `lỗi: ${e}`,
  },
  failed: (reason) => `⚠️ không phân tích được — ${reason}\nđã lưu liên kết · bấm 🔁 hoặc /retry`,
  batch: { already: (n) => `${n} đã có`, notParsed: (n) => `${n} chưa phân tích được`, saved: "đã lưu", failedList: (r) => `⚠️ chưa phân tích được: ${r} · /retry` },

  card: {
    more: "📖 Chi tiết", less: "🔼 Thu gọn", transcript: "📜 Bản ghi", retry: "🔁 Thử lại", edit: "✏️ Sửa",
    formatShow: "🎬 Định dạng", formatRun: "🎬 Phân tích định dạng", back: "← Quay lại",
    points: "Ý chính", ingredients: "Nguyên liệu", steps: "Các bước", why: "Có ích gì cho tôi", inFrame: "Trong khung hình", move: "Thủ thuật",
    comments: "Trong bình luận", similar: "giống với", moreItems: (n) => `… còn ${n}`, tooLong: "(toàn văn — trong “Bản ghi”)",
    notFound: "không tìm thấy mục", translating: "đang dịch…", noTranscript: "không có bản ghi", transcriptTitle: "📜 Bản ghi",
    saved: "đã lưu", formatRunning: "đang phân tích định dạng… khoảng một phút", formatFailed: (e) => `⚠️ không phân tích được định dạng: ${e}`,
    videoUnavailable: "video không có sẵn", editTitle: "✏️ Sửa", stanceLbl: "Thái độ", valueLbl: "Giá trị", formatTitle: "🎬 Phân tích định dạng",
    hook: {
      first_seconds: "Những giây đầu", looks_accidental: "Trông như ngẫu nhiên", probably_deliberate: "Có lẽ là cố ý", how_hidden: "Được che giấu thế nào",
      mismatch: "Điều không khớp", visual: "Hình ảnh", audio: "Âm thanh", text_on_screen: "Chữ trên màn hình", emotion: "Phản ứng mong muốn", format: "Định dạng",
      edit: "Dựng phim", why_it_works: "Vì sao hiệu quả", reusable_move: "Thủ thuật để áp dụng",
    },
  },
  post: { source: "nguồn", why: "Có ích gì cho tôi", followers: (n) => `${n} người theo dõi`, company: "🏢 công ty", person: "🙂 cá nhân", description: "Mô tả gốc dưới video" },

  ui: {
    start: "Chào bạn! Gửi cho mình liên kết, ảnh chụp màn hình, tin nhắn thoại, văn bản — mình sẽ phân tích và lưu lại.\nCác nút ở dưới 👇",
    startNoChannel: "Để lưu bản gốc, hãy tạo một kênh riêng tư và thêm mình làm quản trị viên có quyền đăng bài.",
    help: (b) => `<b>Gửi gì</b>
🎵 tiktok, ▶️ youtube, 📸 reels, 🔗 bất kỳ liên kết nào, 👤 hồ sơ
🖼 ảnh chụp — từng ảnh hoặc album tối đa 10
🎙 tin nhắn thoại, ⭕️ video tròn, 📝 văn bản, ↪️ tin chuyển tiếp

<b>Gợi ý trong chú thích</b> (ưu tiên hơn phỏng đoán của bot)
“vì âm thanh”, “định dạng”, “ví dụ ngược”, “muốn làm theo”, “hồ sơ”

<b>Điều gì xảy ra</b>
Bot trả lời “đã nhận”, rồi dòng đó thay đổi: ⬇️ đang tải → 🧠 đang phân tích → kết quả.
Nếu Gemini quá tải, bot tự thử lại sau vài phút. Vẫn lỗi — bấm 🔁 hoặc /retry.

<b>Các nút ở dưới</b>
${b.recent} — 10 mục gần nhất
${b.projects} — theo lĩnh vực
${b.themes} / ${b.types} — theo chủ đề (về gì) hoặc loại (là gì)
${b.status} — bot, kênh, hàng đợi, lỗi

/retry — thử lại lỗi · /reprocess — cập nhật mục cũ
/projects — lĩnh vực của bạn · /lang — ngôn ngữ`,
    chooseThemes: "🗂 Chủ đề — chọn:", chooseTypes: "🏷 Loại — chọn:", chooseProjects: "🧭 Lĩnh vực — chọn:",
    backThemes: "← Chủ đề", backTypes: "← Loại", backProjects: "← Lĩnh vực",
    empty: "chưa có gì", recentTitle: "🕘 Gần đây", statusTitle: "📊 Trạng thái",
    running: (time, h, m) => `🟢 bot đang chạy từ ${time} (${h ? `${h} giờ ` : ""}${m} phút)`,
    channelOk: (t) => `🗄 kênh lưu trữ: ${t} ✓`, channelBad: (p) => `⚠️ kênh lưu trữ ${p}`, model: "🧠 mô hình",
    saved: "📦 đã lưu", queue: (q, p) => `⏳ đang chờ: ${q} · đang xử lý: ${p}`, queueEmpty: "⏳ hàng đợi trống",
    pending: "🎞 chưa có video (thử lại mỗi ngày)", failedN: (n) => `❌ bị lỗi: ${n} — lý do trong thẻ, thử lại: /retry`,
    last: "🕘 mới nhất", refresh: "🔄 Làm mới", retryN: (n) => `🔁 Thử lại (${n})`, updated: "đã cập nhật",
    retrying: "🔁 đang thử lại…", retryingShort: "đang thử lại", notFailed: "không còn lỗi",
    requeued: (n) => `🔁 ${n} đã vào lại hàng đợi`, nothingToRetry: "không có gì để thử lại — không có lỗi",
  },
  channel: {
    connected: (t) => `🗄 đã kết nối kênh lưu trữ: ${t}`,
    pressStart: "Hãy gửi /start cho bot trong cuộc trò chuyện riêng — câu trả lời sẽ đến đó.",
    disconnected: (t) => `⚠️ bot không còn là quản trị viên trong “${t}” — đã ngắt kênh lưu trữ`,
    notConnected: "chưa kết nối: hãy thêm bot làm quản trị viên vào một kênh riêng tư",
    notAdmin: "— bot không phải quản trị viên ở đó hoặc không thể đăng bài",
    unavailable: "không truy cập được — hãy gỡ bot khỏi quản trị viên kênh rồi thêm lại",
  },
  lang: { choose: "Chọn ngôn ngữ:", set: "Ngôn ngữ: Tiếng Việt 🇻🇳" },
  projects: {
    current: (l) => `🧭 Lĩnh vực của bạn:\n${l}\n\nThay đổi: /projects công việc, học tập, sở thích, khác`,
    set: (l) => `✅ Đã cập nhật lĩnh vực:\n${l}\n\nMục mới sẽ được xếp theo đó; mục cũ sau /reprocess all.`,
  },
  admin: {
    usage: "/adduser <telegram_id> [ru|cs|en|vi]",
    added: (id, l) => `✅ đã thêm người dùng ${id} (ngôn ngữ ${l}). Họ cần mở bot, bấm /start, rồi thêm bot làm quản trị viên vào kênh riêng của mình.`,
    exists: "người dùng này đã tồn tại",
    list: "👥 Người dùng",
  },
  reprocess: {
    running: "đang chạy — hãy chờ báo cáo",
    allDone: "tất cả mục đã ở định dạng mới. Bắt buộc: /reprocess all",
    start: (n) => `🔄 đang xử lý lại ${n}… mất vài phút, báo cáo sẽ gửi ở đây`,
    progress: (i, n) => `🔄 đang xử lý lại ${i}/${n}…`,
    done: (ok, n) => `✅ <b>đã xử lý lại: ${ok}/${n}</b>`,
    edited: (n) => `✏️ bài trong kênh đã được viết lại: ${n}`,
    reposted: (n) => `📤 <b>đăng lại</b> (không sửa được bài cũ hoặc chưa có bài): ${n}`,
    failed: (n) => `⚠️ <b>thất bại</b>: ${n}`,
  },
  commands: {
    start: "hiện các nút", status: "trạng thái bot, kênh và hàng đợi", recent: "10 mục gần nhất",
    project: "mục theo lĩnh vực", theme: "mục theo chủ đề", type: "mục theo loại", retry: "thử lại lỗi và mục chưa có video",
    reprocess: "cập nhật mục cũ sang định dạng mới", projects: "lĩnh vực của tôi", lang: "ngôn ngữ", help: "cách dùng",
  },
};
