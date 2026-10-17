import type {
  Conversation,
  ConversationSummary,
  Message,
  PhoneNumberType,
  PhoneProvisioningStatus,
} from "@nearby/shared";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export type PhoneStatus = {
  phoneNumber: string | null;
  phoneNumberType: PhoneNumberType | null;
  phoneVerified: boolean;
  phoneProvisioningStatus: PhoneProvisioningStatus;
  phoneCreatedAt: number | null;
};

export type PhoneQuote = {
  currency: "USD";
  monthly: number;
  estimateOnly: boolean;
  note: string;
  purchasesEnabled: boolean;
};

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

export function getPhone(token: string) {
  return api<{ phone: PhoneStatus; quote: PhoneQuote }>(token, "/v1/phone");
}

export function startPhoneVerification(token: string, phoneNumber: string) {
  return api(token, "/v1/phone/verify/start", {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
}

export function checkPhoneVerification(token: string, code: string) {
  return api<{ phone: PhoneStatus }>(token, "/v1/phone/verify/check", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function provisionPhone(token: string) {
  return api<{ phone: PhoneStatus }>(token, "/v1/phone/provision", {
    method: "POST",
    body: JSON.stringify({ confirmMonthlyCharge: true }),
  });
}

export function getConversations(token: string) {
  return api<{ conversations: ConversationSummary[] }>(token, "/v1/conversations");
}

export function createConversation(token: string, recipientId: string) {
  return api<{ conversation: Conversation }>(token, "/v1/conversations", {
    method: "POST",
    body: JSON.stringify({ recipientId }),
  });
}

export function getMessages(token: string, conversationId: string) {
  return api<{ messages: Message[] }>(
    token,
    `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
}

export function postMessage(token: string, conversationId: string, content: string) {
  return api<{ message: Message }>(
    token,
    `/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: "POST", body: JSON.stringify({ content }) },
  );
}

export function blockConversation(token: string, conversationId: string) {
  return api<{ ok: true }>(
    token,
    `/v1/conversations/${encodeURIComponent(conversationId)}/block`,
    { method: "POST" },
  );
}

export function createInvite(token: string) {
  return api<{ code: string }>(token, "/v1/invites", { method: "POST" });
}

export function acceptInvite(token: string, code: string) {
  return api<{ otherId: string }>(token, `/v1/invites/${encodeURIComponent(code)}/accept`, {
    method: "POST",
  });
}

export function reportConversation(token: string, conversationId: string, reason: string) {
  return api<{ ok: true }>(
    token,
    `/v1/conversations/${encodeURIComponent(conversationId)}/report`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
