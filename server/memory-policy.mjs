// Server-owned decisions: capture the mode on each message so later topic changes
// cannot turn fictional statements into personal memories.
export function messagePolicy(text, conversation) {
  const end = /结束(?:模拟|练习|角色扮演)|退出(?:模拟|练习)|回到(?:正常|普通|真实)聊天|\b(?:end|stop|exit) (?:the )?(?:roleplay|role play|simulation|practice)\b/i.test(text);
  const start = /模拟.{0,12}(?:面试|客户|对话|会议)|(?:陪我|帮我|一起).{0,8}练.{0,8}(?:面试|对话|汇报|客户)|(?:你|我们).{0,8}扮演|假设|如果我是|\brole[ -]?play\b|\bpretend\b|\b(?:practice|mock).{0,20}(?:interview|conversation|progress update)\b/i.test(text);
  const roleplay = end ? false : Boolean(conversation.roleplay || start);
  const privateText = /不要记住|别记住|不要.{0,8}(?:记忆|保存)|do not remember|don't remember|合同|机密|联系方式|密码|身份证|银行卡|secret|password|confidential/i.test(text);
  const draft = /(?:帮我|请|麻烦).{0,12}(?:翻译|改写|润色|写一|写个|写封)|\b(?:translate|rewrite|draft)\b/i.test(text);
  return {roleplay, noMemory:roleplay || privateText || draft || end, end};
}
