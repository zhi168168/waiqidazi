// Publish four short starter examples only when the corresponding example is absent.
import assert from "node:assert/strict";
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const base = process.env.SELFHOST_BASE_URL || "http://127.0.0.1:8838";
let token;
async function api(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${path}: ${data.error || response.status}`);
  return data;
}
token = (
  await api("/api/admin/login", "POST", {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  })
).token;
const examples = [
  [
    "root-0",
    "先说重点，再汇报进展",
    "Let me give you a quick update.",
    "我来简要汇报一下最新进展。",
    "开始工作汇报时，自然地引出重点。",
  ],
  [
    "root-1",
    "礼貌确认交付时间",
    "Could we agree on a deadline?",
    "我们可以确定一下截止时间吗？",
    "与同事协调任务时，明确时间安排。",
  ],
  [
    "root-2",
    "向客户确认需求",
    "Could you tell me a little more about what you need?",
    "您能再详细说说您的需求吗？",
    "客户需求还不清楚时，礼貌地继续了解。",
  ],
  [
    "root-3",
    "简洁介绍工作经历",
    "I have experience working with different teams.",
    "我有与不同团队合作的经验。",
    "面试时概括跨团队合作经历；请结合自己的真实经历使用。",
  ],
];
for (const [categoryId, title, english, chinese, situation] of examples) {
  let corpus = (await api("/api/admin/corpus")).find(
    (c) => c.draft?.english === english,
  );
  if (!corpus) {
    const result = await api("/api/admin/corpus", "POST", {
      categoryId,
      title,
      english,
      chinese,
      situation,
      channel: "口头",
      formality: "自然",
      notes: "起步示例，可在后台编辑或下架。",
      tags: ["示例"],
    });
    corpus = { id: result.corpusId };
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    corpus = (await api("/api/admin/corpus")).find((c) => c.id === corpus.id);
    if (corpus.audio?.status === "done") break;
    if (corpus.audio?.status === "failed")
      throw Error("语音生成失败，请在后台检查任务后手动重试。");
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(corpus.audio.status, "done");
  const audio = await fetch(base + "/audio/" + corpus.audio.id + ".wav", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(audio.status, 200);
  const bytes = Buffer.from(await audio.arrayBuffer());
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.ok(bytes.length > 24000, "Audio should contain actual speech samples");
  let offset = 12,
    dataSize = 0,
    rate = 0;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4);
    if (kind === "fmt ") rate = bytes.readUInt32LE(offset + 16);
    if (kind === "data") {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  assert.ok(
    rate > 0 && dataSize / rate > 0.5,
    "Audio should have a valid duration",
  );
  if (!corpus.enabled)
    await api(`/api/admin/corpus/${corpus.id}/publish`, "POST", {
      reviewed: true,
    });
  console.log(
    "Published starter example:",
    categoryId,
    "audio seconds:",
    (dataSize / rate).toFixed(2),
  );
}
await api("/api/admin/logout", "POST", {});
