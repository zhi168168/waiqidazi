import { createWebStore } from "../server/web-store.mjs";
import { createClient } from "@supabase/supabase-js";
const store = createWebStore();
try {
  await store.initialize();
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bucket = process.env.SUPABASE_AUDIO_BUCKET || "buddy-audio";
  const { data, error } = await client.storage.getBucket(bucket);
  if (!data) {
    const result = await client.storage.createBucket(bucket, {
      public: false,
      allowedMimeTypes: ["audio/mpeg", "audio/wav"],
      fileSizeLimit: 52428800,
    });
    if (result.error) throw Error("创建音频存储桶失败。");
  } else if (error || data.public) throw Error("音频存储桶必须为私有。");
  console.log("网页版数据库和私有音频存储已初始化。");
} finally {
  await store.close();
}
