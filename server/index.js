import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const STORAGE_FILE = path.join(DATA_DIR, "scheduled-jobs.json");
const HISTORY_FILE = path.join(DATA_DIR, "delivery-history.json");
const OAUTH_TOKENS_FILE = path.join(DATA_DIR, "gmail-oauth-tokens.json");
const PORT = Number(process.env.SCHEDULER_PORT || 3001);
const MAX_TIMEOUT_MS = 2147483000;
const MAX_HISTORY_ITEMS = 500;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:3000";
const GOOGLE_OAUTH_REDIRECT_URI =
  process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${PORT}/api/gmail/oauth/callback`;
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const jobs = new Map();
const timers = new Map();
const deliveryHistory = [];
const gmailOauthTokens = new Map();

function findOauthRecordByEmail(email) {
  const normalized = normalizeEmail(email || "");
  if (!normalized) {
    return null;
  }

  if (gmailOauthTokens.has(normalized)) {
    return gmailOauthTokens.get(normalized);
  }

  for (const record of gmailOauthTokens.values()) {
    if (normalizeEmail(record.gmailEmail) === normalized) {
      return record;
    }
  }

  return null;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function ensureFutureTimestamp(value) {
  return Number.isFinite(value) && value > Date.now() + 5000;
}

function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, GOOGLE_OAUTH_REDIRECT_URI);
}

function encodeState(stateObj) {
  return Buffer.from(JSON.stringify(stateObj), "utf8").toString("base64url");
}

function decodeState(state) {
  try {
    const raw = Buffer.from(String(state || ""), "base64url").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function decodeBase64Url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function extractPlainTextFromPayload(payload) {
  if (!payload) {
    return "";
  }

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).trim();
  }

  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const plain = extractPlainTextFromPayload(part);
      if (plain) {
        return plain;
      }
    }
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data).trim();
  }

  return "";
}

function formatGoogleApiError(error) {
  const responseData = error?.response?.data;
  const apiError = responseData?.error || {};
  const reasons = Array.isArray(apiError.errors)
    ? apiError.errors
        .map((item) => item?.reason)
        .filter(Boolean)
        .join(", ")
    : "";

  const parts = [];
  if (apiError.message) {
    parts.push(apiError.message);
  }
  if (reasons) {
    parts.push(`Reason: ${reasons}`);
  }
  if (error?.message && error.message !== apiError.message) {
    parts.push(error.message);
  }

  return parts.filter(Boolean).join(" | ") || "Unknown Gmail API error.";
}

function parseOauthScopes(scopeValue) {
  return String(scopeValue || "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function hasGmailSendScope(tokens) {
  const scopes = parseOauthScopes(tokens?.scope || "");
  return scopes.includes("https://www.googleapis.com/auth/gmail.send");
}

function hasGmailModifyScope(tokens) {
  const scopes = parseOauthScopes(tokens?.scope || "");
  return scopes.includes("https://www.googleapis.com/auth/gmail.modify");
}

function hasGmailReadScope(tokens) {
  const scopes = parseOauthScopes(tokens?.scope || "");
  return (
    scopes.includes("https://www.googleapis.com/auth/gmail.readonly") ||
    scopes.includes("https://www.googleapis.com/auth/gmail.modify") ||
    scopes.includes("https://mail.google.com/")
  );
}

function encodeSubjectHeader(subject) {
  const value = String(subject || "").replace(/[\r\n]+/g, " ").trim();
  if (!value) {
    return "(No subject)";
  }

  // Use RFC 2047 encoded-word format for UTF-8 safety in subject headers.
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildRawGmailMessage({ fromEmail, toEmail, subject, body }) {
  const safeFrom = normalizeEmail(fromEmail);
  const safeTo = normalizeEmail(toEmail);
  const safeBody = String(body || "").replace(/\r\n/g, "\n");
  const lines = [
    `From: <${safeFrom}>`,
    `To: <${safeTo}>`,
    `Subject: ${encodeSubjectHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    safeBody,
  ];

  return Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAuthorizedGmailClient(ownerEmail) {
  const safeOwner = normalizeEmail(ownerEmail || "");
  const oauthRecord = findOauthRecordByEmail(safeOwner);

  if (!safeOwner) {
    throw new Error("ownerEmail is required to send with connected Gmail OAuth account.");
  }
  if (!oauthRecord?.tokens) {
    throw new Error("Gmail OAuth is not connected for this account.");
  }
  if (!hasGmailSendScope(oauthRecord.tokens)) {
    throw new Error(
      "Connected Gmail account does not have send permission. Reconnect Gmail OAuth to grant https://www.googleapis.com/auth/gmail.send."
    );
  }

  const oauthClient = getGoogleOAuthClient();
  oauthClient.setCredentials(oauthRecord.tokens);
  const gmail = google.gmail({ version: "v1", auth: oauthClient });

  // Trigger token refresh if needed before send.
  await oauthClient.getAccessToken();

  const refreshedTokens = oauthClient.credentials;
  if (JSON.stringify(refreshedTokens) !== JSON.stringify(oauthRecord.tokens)) {
    gmailOauthTokens.set(normalizeEmail(oauthRecord.ownerEmail || safeOwner), {
      ...oauthRecord,
      tokens: refreshedTokens,
      updatedAt: new Date().toISOString(),
    });
    await persistOauthTokens();
  }

  return {
    gmail,
    fromEmail: normalizeEmail(oauthRecord.gmailEmail || oauthRecord.ownerEmail || safeOwner),
  };
}

async function getAuthorizedGmailReadClient(ownerEmail) {
  const safeOwner = normalizeEmail(ownerEmail || "");
  const oauthRecord = findOauthRecordByEmail(safeOwner);

  if (!safeOwner) {
    throw new Error("ownerEmail is required to read Gmail content.");
  }
  if (!oauthRecord?.tokens) {
    throw new Error("Gmail OAuth is not connected for this account.");
  }
  if (!hasGmailReadScope(oauthRecord.tokens)) {
    throw new Error(
      "Connected Gmail account does not have mailbox read permission. Reconnect Gmail OAuth to grant https://www.googleapis.com/auth/gmail.readonly."
    );
  }

  const oauthClient = getGoogleOAuthClient();
  oauthClient.setCredentials(oauthRecord.tokens);
  const gmail = google.gmail({ version: "v1", auth: oauthClient });

  await oauthClient.getAccessToken();

  const refreshedTokens = oauthClient.credentials;
  if (JSON.stringify(refreshedTokens) !== JSON.stringify(oauthRecord.tokens)) {
    gmailOauthTokens.set(normalizeEmail(oauthRecord.ownerEmail || safeOwner), {
      ...oauthRecord,
      tokens: refreshedTokens,
      updatedAt: new Date().toISOString(),
    });
    await persistOauthTokens();
  }

  return {
    gmail,
  };
}

function formatGmailSentQuery({ recipientEmail, subject, eventTimeMs }) {
  const filters = ["in:sent"];
  const date = Number(eventTimeMs || 0);

  if (recipientEmail) {
    filters.push(`to:${normalizeEmail(recipientEmail)}`);
  }

  if (subject) {
    const safeSubject = String(subject).replace(/"/g, "").trim();
    if (safeSubject) {
      filters.push(`subject:"${safeSubject}"`);
    }
  }

  if (Number.isFinite(date) && date > 0) {
    const before = new Date(date + 2 * 24 * 60 * 60 * 1000);
    const after = new Date(date - 2 * 24 * 60 * 60 * 1000);
    const toDateToken = (dt) => {
      const year = dt.getFullYear();
      const month = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      return `${year}/${month}/${day}`;
    };

    filters.push(`after:${toDateToken(after)}`);
    filters.push(`before:${toDateToken(before)}`);
  }

  return filters.join(" ");
}

function extractHeaderValue(headers, name) {
  const lower = String(name || "").toLowerCase();
  return headers.find((h) => String(h.name || "").toLowerCase() === lower)?.value || "";
}

function extractPrimaryEmailAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const angleMatch = raw.match(/<([^>]+)>/);
  if (angleMatch?.[1]) {
    return normalizeEmail(angleMatch[1]);
  }

  const plainMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (plainMatch?.[0]) {
    return normalizeEmail(plainMatch[0]);
  }

  return normalizeEmail(raw);
}

function normalizeSubjectForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^(re|fw|fwd)\s*:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function findSentGmailMessageContent({ ownerEmail, gmailMessageId, recipientEmail, subject, eventTimeMs }) {
  const { gmail } = await getAuthorizedGmailReadClient(ownerEmail);

  const tryExtract = (message) => {
    if (!message?.data) {
      return null;
    }

    const headers = message.data.payload?.headers || [];
    const messageSubject = extractHeaderValue(headers, "subject") || message.data.snippet || "(No subject)";
    const messageTo = extractHeaderValue(headers, "to") || recipientEmail || "";
    const messageFrom = extractHeaderValue(headers, "from") || "";
    const messageDateHeader = extractHeaderValue(headers, "date") || "";
    const messageDate = messageDateHeader ? new Date(messageDateHeader).toISOString() : new Date().toISOString();
    const body = extractPlainTextFromPayload(message.data.payload) || message.data.snippet || "";

    return {
      gmailMessageId: message.data.id || gmailMessageId || null,
      subject: messageSubject,
      recipientEmail: messageTo,
      fromEmail: messageFrom,
      date: messageDate,
      body: String(body).trim(),
    };
  };

  if (gmailMessageId) {
    try {
      const direct = await gmail.users.messages.get({
        userId: "me",
        id: gmailMessageId,
        format: "full",
      });
      const extracted = tryExtract(direct);
      if (extracted) {
        return extracted;
      }
    } catch {
      // Fall back to sent-folder search.
    }
  }

  const response = await gmail.users.messages.list({
    userId: "me",
    q: formatGmailSentQuery({ recipientEmail, subject, eventTimeMs }),
    maxResults: 30,
  });

  const normalizedRecipient = extractPrimaryEmailAddress(recipientEmail || "");
  const normalizedSubject = normalizeSubjectForMatch(subject || "");
  const targetTime = Number(eventTimeMs || 0);

  const entries = response.data.messages || [];
  let bestCandidate = null;
  let bestScore = -1;

  for (const entry of entries) {
    try {
      const message = await gmail.users.messages.get({
        userId: "me",
        id: entry.id,
        format: "full",
      });
      const extracted = tryExtract(message);
      if (!extracted) {
        continue;
      }

      const extractedRecipient = extractPrimaryEmailAddress(extracted.recipientEmail || "");
      const extractedSubject = normalizeSubjectForMatch(extracted.subject || "");
      const extractedTime = Date.parse(extracted.date || "") || 0;

      let score = 0;
      if (normalizedRecipient && extractedRecipient && normalizedRecipient === extractedRecipient) {
        score += 4;
      }
      if (normalizedSubject && extractedSubject && normalizedSubject === extractedSubject) {
        score += 4;
      } else if (
        normalizedSubject &&
        extractedSubject &&
        (extractedSubject.includes(normalizedSubject) || normalizedSubject.includes(extractedSubject))
      ) {
        score += 2;
      }
      if (targetTime > 0 && extractedTime > 0) {
        const gapMs = Math.abs(extractedTime - targetTime);
        if (gapMs <= 10 * 60 * 1000) {
          score += 3;
        } else if (gapMs <= 2 * 60 * 60 * 1000) {
          score += 2;
        } else if (gapMs <= 24 * 60 * 60 * 1000) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = extracted;
      }

      if (score >= 7) {
        return extracted;
      }
    } catch {
      continue;
    }
  }

  return bestCandidate;
}

async function sendMailWithGmailOAuth({ ownerEmail, recipientEmail, subject, body }) {
  const { gmail, fromEmail } = await getAuthorizedGmailClient(ownerEmail);
  const raw = buildRawGmailMessage({
    fromEmail,
    toEmail: recipientEmail,
    subject,
    body,
  });

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return {
    fromEmail,
    gmailMessageId: response?.data?.id || null,
  };
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORAGE_FILE);
  } catch {
    await fs.writeFile(STORAGE_FILE, "[]", "utf8");
  }

  try {
    await fs.access(HISTORY_FILE);
  } catch {
    await fs.writeFile(HISTORY_FILE, "[]", "utf8");
  }

  try {
    await fs.access(OAUTH_TOKENS_FILE);
  } catch {
    await fs.writeFile(OAUTH_TOKENS_FILE, "{}", "utf8");
  }
}

async function persistJobs() {
  const allJobs = Array.from(jobs.values());
  await fs.writeFile(STORAGE_FILE, JSON.stringify(allJobs, null, 2), "utf8");
}

async function persistHistory() {
  await fs.writeFile(HISTORY_FILE, JSON.stringify(deliveryHistory, null, 2), "utf8");
}

async function persistOauthTokens() {
  const tokenObj = Object.fromEntries(gmailOauthTokens.entries());
  await fs.writeFile(OAUTH_TOKENS_FILE, JSON.stringify(tokenObj, null, 2), "utf8");
}

function sanitizeDeliveryDetail(status, details) {
  return "";
}

async function recordDeliveryEvent(event) {
  deliveryHistory.unshift({
    ...event,
    details: sanitizeDeliveryDetail(event?.status, event?.details),
    eventTimeMs: Date.now(),
  });

  if (deliveryHistory.length > MAX_HISTORY_ITEMS) {
    deliveryHistory.length = MAX_HISTORY_ITEMS;
  }

  await persistHistory();
}

function clearJobTimer(ticketKey) {
  const timer = timers.get(ticketKey);
  if (timer) {
    clearTimeout(timer);
    timers.delete(ticketKey);
  }
}

async function fetchRecentGmailMessagesOAuth({ ownerEmail, maxCount, unseenOnly, pageToken }) {
  const safeOwner = normalizeEmail(ownerEmail || "");
  const stored = gmailOauthTokens.get(safeOwner);
  if (!stored?.tokens) {
    throw new Error("Gmail OAuth is not connected for this user.");
  }

  const oauthClient = getGoogleOAuthClient();
  oauthClient.setCredentials(stored.tokens);

  const gmail = google.gmail({ version: "v1", auth: oauthClient });
  const listResponse = await gmail.users.messages.list({
    userId: "me",
    maxResults: maxCount,
    q: unseenOnly ? "is:unread" : undefined,
    pageToken: pageToken || undefined,
  });

  const messageIds = listResponse.data.messages || [];
  const messages = [];

  for (const entry of messageIds) {
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: entry.id,
      format: "full",
    });

    const headers = msg.data.payload?.headers || [];
    const subject = headers.find((h) => String(h.name).toLowerCase() === "subject")?.value || "(No subject)";
    const from = headers.find((h) => String(h.name).toLowerCase() === "from")?.value || "unknown@unknown";
    const dateHeader = headers.find((h) => String(h.name).toLowerCase() === "date")?.value || "";
    const date = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();
    const text = extractPlainTextFromPayload(msg.data.payload) || msg.data.snippet || "";

    messages.push({
      uid: msg.data.id,
      subject,
      from,
      date,
      text: String(text).trim(),
    });
  }

  const nextTokens = oauthClient.credentials;
  if (nextTokens && JSON.stringify(nextTokens) !== JSON.stringify(stored.tokens)) {
    gmailOauthTokens.set(safeOwner, {
      ...stored,
      tokens: nextTokens,
      updatedAt: new Date().toISOString(),
    });
    await persistOauthTokens();
  }

  return {
    messages,
    nextPageToken: listResponse.data.nextPageToken || null,
  };
}

async function executeJob(ticketKey) {
  const job = jobs.get(ticketKey);
  if (!job) {
    return;
  }

  try {
    const { fromEmail, gmailMessageId } = await sendMailWithGmailOAuth({
      ownerEmail: job.ownerEmail,
      recipientEmail: job.recipientEmail,
      subject: job.subject,
      body: job.body,
    });

    jobs.delete(ticketKey);
    clearJobTimer(ticketKey);
    await persistJobs();
    await recordDeliveryEvent({
      ticketKey: job.ticketKey,
      ownerEmail: job.ownerEmail,
      recipientEmail: job.recipientEmail,
      subject: job.subject,
      body: job.body,
      gmailMessageId,
      scheduledAtMs: job.scheduledAtMs,
      deliverySource: "scheduled",
      status: "sent",
      details: "Email sent successfully.",
    });
    console.log(`[scheduler] sent job ${ticketKey} at ${new Date().toISOString()}`);
  } catch (error) {
    jobs.delete(ticketKey);
    clearJobTimer(ticketKey);
    await persistJobs();
    await recordDeliveryEvent({
      ticketKey: job.ticketKey,
      ownerEmail: job.ownerEmail,
      recipientEmail: job.recipientEmail,
      subject: job.subject,
      body: job.body,
      scheduledAtMs: job.scheduledAtMs,
      deliverySource: "scheduled",
      status: "failed",
      details: formatGoogleApiError(error) || error.message || "Gmail OAuth send failed.",
    });
    console.error(`[scheduler] failed job ${ticketKey}:`, formatGoogleApiError(error));
  }
}

function armJobTimer(ticketKey) {
  clearJobTimer(ticketKey);
  const job = jobs.get(ticketKey);
  if (!job) {
    return;
  }

  const remaining = job.scheduledAtMs - Date.now();
  if (remaining <= 0) {
    void executeJob(ticketKey);
    return;
  }

  const waitMs = Math.min(remaining, MAX_TIMEOUT_MS);
  const timer = setTimeout(() => {
    const latest = jobs.get(ticketKey);
    if (!latest) {
      return;
    }

    if (latest.scheduledAtMs - Date.now() > MAX_TIMEOUT_MS) {
      armJobTimer(ticketKey);
      return;
    }

    void executeJob(ticketKey);
  }, waitMs);

  timers.set(ticketKey, timer);
}

async function loadJobsFromDisk() {
  await ensureStorage();
  const raw = await fs.readFile(STORAGE_FILE, "utf8");
  const historyRaw = await fs.readFile(HISTORY_FILE, "utf8");
  const oauthRaw = await fs.readFile(OAUTH_TOKENS_FILE, "utf8");
  let parsed = [];
  let parsedHistory = [];
  let parsedOauth = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = [];
  }

  try {
    parsedHistory = JSON.parse(historyRaw);
  } catch {
    parsedHistory = [];
  }

  try {
    parsedOauth = JSON.parse(oauthRaw);
  } catch {
    parsedOauth = {};
  }

  for (const event of Array.isArray(parsedHistory) ? parsedHistory : []) {
    if (!event || !event.ticketKey || !event.status) {
      continue;
    }
    deliveryHistory.push({
      ...event,
      details: sanitizeDeliveryDetail(event.status, event.details),
    });
  }

  for (const job of Array.isArray(parsed) ? parsed : []) {
    if (!job || !job.ticketKey) {
      continue;
    }

    if (!ensureFutureTimestamp(job.scheduledAtMs)) {
      continue;
    }

    jobs.set(job.ticketKey, job);
  }

  for (const [ownerEmail, tokenRecord] of Object.entries(parsedOauth || {})) {
    if (!tokenRecord || !tokenRecord.tokens) {
      continue;
    }
    gmailOauthTokens.set(normalizeEmail(ownerEmail), tokenRecord);
  }

  await persistJobs();
  await persistHistory();
  await persistOauthTokens();

  for (const ticketKey of jobs.keys()) {
    armJobTimer(ticketKey);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    pendingJobs: jobs.size,
    historyItems: deliveryHistory.length,
    oauthConnectedAccounts: gmailOauthTokens.size,
  });
});

app.get("/api/scheduled-emails/history", (req, res) => {
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");
  const requestedLimit = Number(req.query.limit || 30);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 30;

  const pendingJobs = Array.from(jobs.values())
    .filter((job) => !ownerEmail || normalizeEmail(job.ownerEmail) === ownerEmail)
    .sort((a, b) => a.scheduledAtMs - b.scheduledAtMs)
    .slice(0, limit);

  const history = deliveryHistory
    .filter((event) => !ownerEmail || normalizeEmail(event.ownerEmail) === ownerEmail)
    .sort((a, b) => (b.eventTimeMs || 0) - (a.eventTimeMs || 0))
    .map((event) => ({
      ...event,
      details: sanitizeDeliveryDetail(event.status, event.details),
    }))
    .slice(0, limit);

  res.json({
    pendingJobs,
    history,
  });
});

app.delete("/api/scheduled-emails/history/:ticketKey", async (req, res) => {
  const ticketKey = String(req.params.ticketKey || "").trim();
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");
  const eventTimeMs = Number(req.query.eventTimeMs || 0);

  if (!ticketKey) {
    res.status(400).json({ error: "ticketKey is required." });
    return;
  }

  if (!Number.isFinite(eventTimeMs) || eventTimeMs <= 0) {
    res.status(400).json({ error: "eventTimeMs is required." });
    return;
  }

  const index = deliveryHistory.findIndex((event) => {
    if (!event || String(event.ticketKey || "") !== ticketKey) {
      return false;
    }

    if (ownerEmail && normalizeEmail(event.ownerEmail || "") !== ownerEmail) {
      return false;
    }

    return Number(event.eventTimeMs || 0) === eventTimeMs;
  });

  if (index === -1) {
    res.status(404).json({ error: "History item not found." });
    return;
  }

  deliveryHistory.splice(index, 1);
  await persistHistory();

  res.json({ ok: true });
});

app.get("/api/gmail/sent-message", async (req, res) => {
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");
  const ticketKey = String(req.query.ticketKey || "").trim();
  const gmailMessageId = String(req.query.gmailMessageId || "").trim();
  const recipientEmail = String(req.query.recipientEmail || "").trim();
  const subject = String(req.query.subject || "").trim();
  const eventTimeMs = Number(req.query.eventTimeMs || 0);

  if (!ownerEmail) {
    res.status(400).json({ error: "ownerEmail is required." });
    return;
  }

  try {
    const historyItem = deliveryHistory.find((event) => {
      if (!event || String(event.ticketKey || "") !== ticketKey) {
        return false;
      }
      if (ownerEmail && normalizeEmail(event.ownerEmail || "") !== ownerEmail) {
        return false;
      }
      if (Number.isFinite(eventTimeMs) && eventTimeMs > 0 && Number(event.eventTimeMs || 0) !== eventTimeMs) {
        return false;
      }
      return true;
    });

    if (historyItem?.body) {
      res.json({
        ok: true,
        source: "history",
        content: {
          gmailMessageId: historyItem.gmailMessageId || gmailMessageId || null,
          subject: historyItem.subject || subject || "(No subject)",
          recipientEmail: historyItem.recipientEmail || recipientEmail || "",
          fromEmail: historyItem.ownerEmail || ownerEmail,
          date: new Date(historyItem.eventTimeMs || Date.now()).toISOString(),
          body: String(historyItem.body || "").trim(),
        },
      });
      return;
    }

    const content = await findSentGmailMessageContent({
      ownerEmail,
      gmailMessageId,
      recipientEmail,
      subject,
      eventTimeMs,
    });

    if (!content) {
      res.status(404).json({ error: "Unable to find the sent email in Gmail." });
      return;
    }

    if (historyItem) {
      historyItem.body = content.body || historyItem.body || "";
      historyItem.gmailMessageId = content.gmailMessageId || historyItem.gmailMessageId || gmailMessageId || null;
      historyItem.subject = historyItem.subject || content.subject || subject || "";
      historyItem.recipientEmail = historyItem.recipientEmail || content.recipientEmail || recipientEmail || "";
      await persistHistory();
    }

    res.json({
      ok: true,
      source: "gmail",
      content,
    });
  } catch (error) {
    const details = formatGoogleApiError(error);
    res.status(500).json({
      error: "Unable to fetch sent email content.",
      details,
    });
  }
});

app.get("/api/scheduled-emails", (req, res) => {
  const ticketKey = String(req.query.ticketKey || "").trim();
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");

  if (!ticketKey) {
    res.status(400).json({ error: "ticketKey is required." });
    return;
  }

  const job = jobs.get(ticketKey) || null;
  if (!job) {
    res.json({ job: null });
    return;
  }

  if (ownerEmail && normalizeEmail(job.ownerEmail) !== ownerEmail) {
    res.status(403).json({ error: "You cannot access this scheduled job." });
    return;
  }

  res.json({ job });
});

app.post("/api/scheduled-emails", async (req, res) => {
  const ticketKey = String(req.body.ticketKey || "").trim();
  const ownerEmail = normalizeEmail(req.body.ownerEmail || "");
  const recipientEmail = normalizeEmail(req.body.recipientEmail || "");
  const subject = String(req.body.subject || "").trim();
  const body = String(req.body.body || "");
  const scheduledAtMs = Number(req.body.scheduledAtMs);

  if (!ticketKey) {
    res.status(400).json({ error: "ticketKey is required." });
    return;
  }
  if (!ownerEmail || !isValidEmail(ownerEmail)) {
    res.status(400).json({ error: "A valid ownerEmail is required." });
    return;
  }
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    res.status(400).json({ error: "A valid recipient email is required." });
    return;
  }
  if (!subject) {
    res.status(400).json({ error: "Subject is required." });
    return;
  }
  if (!body.trim()) {
    res.status(400).json({ error: "Email body is required." });
    return;
  }
  if (!ensureFutureTimestamp(scheduledAtMs)) {
    res.status(400).json({ error: "Scheduled time must be in the future." });
    return;
  }

  const job = {
    ticketKey,
    ownerEmail,
    recipientEmail,
    subject,
    body,
    scheduledAtMs,
    createdAt: new Date().toISOString(),
  };

  jobs.set(ticketKey, job);
  armJobTimer(ticketKey);
  await persistJobs();

  res.status(201).json({ job });
});

app.delete("/api/scheduled-emails/:ticketKey", async (req, res) => {
  const ticketKey = String(req.params.ticketKey || "").trim();
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");

  if (!ticketKey) {
    res.status(400).json({ error: "ticketKey is required." });
    return;
  }

  const existing = jobs.get(ticketKey);
  if (!existing) {
    res.status(404).json({ error: "Scheduled job not found." });
    return;
  }

  if (ownerEmail && normalizeEmail(existing.ownerEmail) !== ownerEmail) {
    res.status(403).json({ error: "You cannot cancel this scheduled job." });
    return;
  }

  jobs.delete(ticketKey);
  clearJobTimer(ticketKey);
  await persistJobs();
  await recordDeliveryEvent({
    ticketKey: existing.ticketKey,
    ownerEmail: existing.ownerEmail,
    recipientEmail: existing.recipientEmail,
    subject: existing.subject,
    scheduledAtMs: existing.scheduledAtMs,
    deliverySource: "scheduled",
    status: "canceled",
    details: "Schedule canceled by user.",
  });

  res.json({ ok: true });
});

app.post("/api/send-email", async (req, res) => {
  const ticketKey = String(req.body.ticketKey || crypto.randomUUID()).trim();
  const ownerEmail = normalizeEmail(req.body.ownerEmail || "");
  const recipientEmail = normalizeEmail(req.body.recipientEmail || "");
  const subject = String(req.body.subject || "").trim();
  const body = String(req.body.body || "");

  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    res.status(400).json({ error: "A valid recipient email is required." });
    return;
  }
  if (!ownerEmail || !isValidEmail(ownerEmail)) {
    res.status(400).json({ error: "A valid ownerEmail is required." });
    return;
  }
  if (!subject) {
    res.status(400).json({ error: "Subject is required." });
    return;
  }
  if (!body.trim()) {
    res.status(400).json({ error: "Email body is required." });
    return;
  }

  try {
    const { fromEmail, gmailMessageId } = await sendMailWithGmailOAuth({
      ownerEmail,
      recipientEmail,
      subject,
      body,
    });

    await recordDeliveryEvent({
      ticketKey,
      ownerEmail,
      recipientEmail,
      subject,
      body,
      gmailMessageId,
      scheduledAtMs: Date.now(),
      deliverySource: "manual",
      status: "sent",
      details: "Email sent successfully.",
    });

    res.json({ ok: true, ticketKey, fromEmail });
  } catch (error) {
    const details = formatGoogleApiError(error);
    await recordDeliveryEvent({
      ticketKey,
      ownerEmail,
      recipientEmail,
      subject,
      body,
      scheduledAtMs: Date.now(),
      deliverySource: "manual",
      status: "failed",
      details: details || error.message || "Gmail OAuth send failed.",
    });

    res.status(500).json({
      error: "Unable to send email now.",
      details,
      hint:
        "Reconnect Gmail to grant latest scopes if needed (gmail.send + gmail.readonly).",
    });
  }
});

app.post("/api/gmail/fetch", async (req, res) => {
  const ownerEmail = normalizeEmail(req.body.ownerEmail || "");
  const gmailEmail = normalizeEmail(req.body.gmailEmail || "");
  const pageToken = String(req.body.pageToken || "").trim();
  const requestedMaxCount = Number(req.body.maxCount || 5);
  const unseenOnly = Boolean(req.body.unseenOnly);
  const maxCount = Number.isFinite(requestedMaxCount)
    ? Math.min(Math.max(requestedMaxCount, 1), 100)
    : 5;

  try {
    const oauthRecord = findOauthRecordByEmail(ownerEmail) || findOauthRecordByEmail(gmailEmail);

    if (!oauthRecord?.tokens) {
      res.status(400).json({
        error: "Gmail OAuth is not connected for this account.",
      });
      return;
    }

    const result = await fetchRecentGmailMessagesOAuth({
      ownerEmail: oauthRecord.ownerEmail || ownerEmail || gmailEmail,
      maxCount,
      unseenOnly,
      pageToken,
    });

    res.json({
      count: result.messages.length,
      messages: result.messages,
      nextPageToken: result.nextPageToken,
    });
  } catch (error) {
    const details = formatGoogleApiError(error);
    console.error("[gmail] fetch failed:", details, error?.response?.data || error);
    res.status(500).json({
      error: "Unable to fetch Gmail messages.",
      details,
    });
  }
});

app.post("/api/gmail/trash", async (req, res) => {
  const ownerEmail = normalizeEmail(req.body.ownerEmail || "");
  const gmailEmail = normalizeEmail(req.body.gmailEmail || "");
  const rawMessageIds = Array.isArray(req.body.messageIds)
    ? req.body.messageIds
    : [req.body.messageId];
  const messageIds = rawMessageIds
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  if (!messageIds.length) {
    res.status(400).json({ error: "At least one Gmail message id is required." });
    return;
  }

  try {
    const oauthRecord = findOauthRecordByEmail(ownerEmail) || findOauthRecordByEmail(gmailEmail);

    if (!oauthRecord?.tokens) {
      res.status(400).json({ error: "Gmail OAuth is not connected for this account." });
      return;
    }

    if (!hasGmailModifyScope(oauthRecord.tokens)) {
      res.status(403).json({
        error:
          "Connected Gmail account does not have mailbox modify permission. Reconnect Gmail OAuth to grant https://www.googleapis.com/auth/gmail.modify.",
      });
      return;
    }

    const oauthClient = getGoogleOAuthClient();
    oauthClient.setCredentials(oauthRecord.tokens);
    const gmail = google.gmail({ version: "v1", auth: oauthClient });

    await oauthClient.getAccessToken();

    for (const id of messageIds) {
      await gmail.users.messages.trash({
        userId: "me",
        id,
      });
    }

    const refreshedTokens = oauthClient.credentials;
    if (JSON.stringify(refreshedTokens) !== JSON.stringify(oauthRecord.tokens)) {
      gmailOauthTokens.set(normalizeEmail(oauthRecord.ownerEmail || ownerEmail || gmailEmail), {
        ...oauthRecord,
        tokens: refreshedTokens,
        updatedAt: new Date().toISOString(),
      });
      await persistOauthTokens();
    }

    res.json({ ok: true, trashedCount: messageIds.length });
  } catch (error) {
    const details = formatGoogleApiError(error);
    console.error("[gmail] trash failed:", details, error?.response?.data || error);
    res.status(500).json({
      error: "Unable to delete Gmail messages.",
      details,
      hint:
        "Reconnect Gmail to grant latest scopes if needed (gmail.modify + gmail.readonly + gmail.send).",
    });
  }
});

app.get("/api/gmail/oauth/start", (req, res) => {
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");
  const gmailEmail = normalizeEmail(req.query.gmailEmail || ownerEmail || "");

  if (!ownerEmail) {
    res.status(400).json({ error: "ownerEmail is required." });
    return;
  }

  try {
    const oauthClient = getGoogleOAuthClient();
    const state = encodeState({
      ownerEmail,
      nonce: crypto.randomUUID(),
    });
    const authUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent select_account",
      scope: GOOGLE_OAUTH_SCOPES,
      login_hint: gmailEmail || undefined,
      state,
    });

    res.json({ authUrl });
  } catch (error) {
    res.status(500).json({ error: error.message || "Unable to initialize Gmail OAuth." });
  }
});

app.get("/api/gmail/oauth/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const state = decodeState(req.query.state || "");
  const ownerEmail = normalizeEmail(state?.ownerEmail || "");

  if (!code || !ownerEmail) {
    res.status(400).send("Invalid OAuth callback parameters.");
    return;
  }

  try {
    const oauthClient = getGoogleOAuthClient();
    const existing = gmailOauthTokens.get(ownerEmail);
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.refresh_token && existing?.tokens?.refresh_token) {
      // Google may omit refresh_token on subsequent consent flows; preserve previous one.
      tokens.refresh_token = existing.tokens.refresh_token;
    }
    oauthClient.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: oauthClient });
    const profile = await oauth2.userinfo.get();
    const connectedGmail = normalizeEmail(profile.data.email || "");

    gmailOauthTokens.set(ownerEmail, {
      ownerEmail,
      gmailEmail: connectedGmail,
      tokens,
      updatedAt: new Date().toISOString(),
    });
    await persistOauthTokens();

    res.setHeader("Content-Type", "text/html");
    res.send(`<!doctype html><html><body style="font-family:Segoe UI,sans-serif;padding:20px;">
      <h3>Gmail connected successfully</h3>
      <p>You can close this tab and return to the app.</p>
      <p><a href="${FRONTEND_BASE_URL}">Return to app</a></p>
      <script>window.close();</script>
    </body></html>`);
  } catch (error) {
    res.status(500).send(`Gmail OAuth failed: ${error.message || "Unknown error"}`);
  }
});

app.get("/api/gmail/oauth/status", (req, res) => {
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");
  if (!ownerEmail) {
    res.status(400).json({ error: "ownerEmail is required." });
    return;
  }

  const record = gmailOauthTokens.get(ownerEmail);
  const scopes = parseOauthScopes(record?.tokens?.scope || "");
  const canSend = hasGmailSendScope(record?.tokens);
  const canModify = hasGmailModifyScope(record?.tokens);
  res.json({
    connected: Boolean(record?.tokens),
    canSend,
    canModify,
    needsSendScopeReconnect: Boolean(record?.tokens) && !canSend,
    needsModifyScopeReconnect: Boolean(record?.tokens) && !canModify,
    scopes,
    gmailEmail: record?.gmailEmail || "",
    updatedAt: record?.updatedAt || null,
  });
});

app.delete("/api/gmail/oauth", async (req, res) => {
  const ownerEmail = normalizeEmail(req.query.ownerEmail || "");
  if (!ownerEmail) {
    res.status(400).json({ error: "ownerEmail is required." });
    return;
  }

  const existing = gmailOauthTokens.get(ownerEmail);
  if (!existing) {
    res.json({ ok: true });
    return;
  }

  try {
    const oauthClient = getGoogleOAuthClient();
    oauthClient.setCredentials(existing.tokens);
    await oauthClient.revokeCredentials().catch(() => {});
  } catch {
    // Ignore revoke failures and continue local disconnect.
  }

  gmailOauthTokens.delete(ownerEmail);
  await persistOauthTokens();
  res.json({ ok: true });
});

loadJobsFromDisk()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[scheduler] running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("[scheduler] failed to start:", error);
    process.exit(1);
  });
