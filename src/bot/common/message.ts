/**
 * bot.common.message — 4 SDK 共享消息类型(per D13 拍板:字段名 + 类型 100% 一致)
 *
 * 字段定义严格对齐 wau-go-sdk/bot/common/message.go +
 * wau-python-sdk/src/wau_sdk/bot/common/message.py。
 */

export interface Attachment {
  /** "image" / "file" / "audio" / "video"(per D13) */
  type: string;
  url: string;
  name: string;
}

export interface IncomingMessage {
  platformMsgId: string;
  channelId: string;
  userId: string;
  username: string;
  text: string;
  attachments: Attachment[];
  replyTo: string;
  timestamp: Date;
}

export interface OutgoingMessage {
  text: string;
  attachments: Attachment[];
  replyTo: string;
}

/** 默认 factory(避免每个 adapter 都写空对象) */
export function newIncomingMessage(): IncomingMessage {
  return {
    platformMsgId: "",
    channelId: "",
    userId: "",
    username: "",
    text: "",
    attachments: [],
    replyTo: "",
    timestamp: new Date(),
  };
}

export function newOutgoingMessage(): OutgoingMessage {
  return { text: "", attachments: [], replyTo: "" };
}
