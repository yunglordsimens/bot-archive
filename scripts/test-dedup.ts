import assert from "node:assert/strict";
import { urlKey } from "../src/dedup.ts";

const same = async (a: string, b: string) => assert.equal(await urlKey(a), await urlKey(b), `${a} vs ${b}`);
await same("https://www.tiktok.com/@user/video/7412345678901234567?_t=abc&_r=1", "https://m.tiktok.com/@other/video/7412345678901234567");
await same("https://youtu.be/dQw4w9WgXcQ?si=xyz", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share");
await same("https://youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ");
await same("https://www.instagram.com/reel/C8abcDEF123/?igsh=MWx", "https://instagram.com/reels/C8abcDEF123");
await same("https://example.com/post/1?utm_source=tg#top", "https://www.example.com/post/1/");
assert.notEqual(await urlKey("https://example.com/post/1"), await urlKey("https://example.com/post/2"));
assert.notEqual(await urlKey("https://youtu.be/aaa"), await urlKey("https://youtu.be/bbb"));
console.log("✓ dedup keys:", await urlKey("https://youtu.be/dQw4w9WgXcQ?si=xyz"), await urlKey("https://www.tiktok.com/@u/video/7412345678901234567"));
