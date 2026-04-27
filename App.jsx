import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import loginMascotLogo from "./assets/images/login-mascot-logo.svg";
import googleLogo from "./assets/images/Google__G__logo.svg";
import appLogo from "./assets/images/logo.png";

const ANALYSIS_CACHE_STORAGE_KEY = "customer-response-copilot.analysis-cache.v1";
const AUTH_USERS_STORAGE_KEY = "customer-response-copilot.auth-users.v1";
const API_KEY_STORAGE_PREFIX = "customer-response-copilot.groq-api-key.v1";
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

function hasFirebaseConfig() {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.authDomain &&
      FIREBASE_CONFIG.projectId &&
      FIREBASE_CONFIG.appId
  );
}

function getFirebaseAuthInstance() {
  if (!hasFirebaseConfig()) {
    throw new Error(
      "Firebase is not configured. Add VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, and VITE_FIREBASE_APP_ID to your .env file."
    );
  }

  const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
  return getAuth(app);
}

function loadAnalysisCache() {
  if (typeof window === "undefined") {
    return new Map();
  }

  try {
    const raw = window.localStorage.getItem(ANALYSIS_CACHE_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw);
    return new Map(Array.isArray(parsed) ? parsed : Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveAnalysisCache(cache) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      ANALYSIS_CACHE_STORAGE_KEY,
      JSON.stringify(Array.from(cache.entries()))
    );
  } catch {
    // Ignore storage quota and privacy mode failures.
  }
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function loadAuthUsers() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(AUTH_USERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAuthUsers(users) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(AUTH_USERS_STORAGE_KEY, JSON.stringify(users));
  } catch {
    // Ignore storage quota and privacy mode failures.
  }
}

function getApiKeyStorageKey(email) {
  return `${API_KEY_STORAGE_PREFIX}.${normalizeEmail(email)}`;
}

function loadSavedApiKey(email) {
  if (typeof window === "undefined" || !email) {
    return "";
  }

  try {
    return window.localStorage.getItem(getApiKeyStorageKey(email)) || "";
  } catch {
    return "";
  }
}

function saveApiKey(email, apiKey) {
  if (typeof window === "undefined" || !email) {
    return;
  }

  try {
    window.localStorage.setItem(getApiKeyStorageKey(email), apiKey);
  } catch {
    // Ignore storage quota and privacy mode failures.
  }
}

function clearSavedApiKey(email) {
  if (typeof window === "undefined" || !email) {
    return;
  }

  try {
    window.localStorage.removeItem(getApiKeyStorageKey(email));
  } catch {
    // Ignore storage quota and privacy mode failures.
  }
}

function apiUrl(pathname) {
  const safePath = String(pathname || "");
  if (!safePath.startsWith("/")) {
    throw new Error("API path must start with '/'.");
  }

  return `${API_BASE_URL}${safePath}`;
}

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  navy: "#0b1524",
  navyMid: "#132338",
  navyLight: "#1b314a",
  indigo: "#22d3ee",
  indigoDark: "#0891b2",
  indigoLight: "#102a3d",
  white: "#ffffff",
  offWhite: "#111f32",
  border: "#2a3f57",
  textPrimary: "#e4ecf7",
  textSecondary: "#a8b8cb",
  textMuted: "#7f93ab",
  red: "#ef4444",
  redLight: "#3c1e27",
  redBorder: "#d46a7b",
  orange: "#f97316",
  orangeLight: "#3a2a1a",
  orangeBorder: "#d19253",
  green: "#22c55e",
  greenLight: "#17332e",
  yellow: "#eab308",
  yellowLight: "#3a361b",
};

const font = "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif";
const fontMono = "'IBM Plex Mono', 'Courier New', monospace";

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  app: {
    fontFamily: font,
    minHeight: "100vh",
    background: "radial-gradient(circle at 14% 8%, rgba(34,211,238,0.14) 0%, rgba(34,211,238,0) 36%), radial-gradient(circle at 90% 0%, rgba(56,189,248,0.12) 0%, rgba(56,189,248,0) 34%), linear-gradient(150deg, #091323 0%, #102238 58%, #0f1f34 100%)",
    color: C.textPrimary,
  },
  header: {
    background: "linear-gradient(90deg, rgba(12,24,40,0.96) 0%, rgba(16,32,52,0.96) 52%, rgba(18,36,58,0.96) 100%)",
    borderBottom: "1px solid rgba(66,92,120,0.45)",
    padding: "0 24px",
    height: 64,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: "sticky",
    top: 0,
    zIndex: 100,
    boxShadow: "0 10px 26px rgba(8,26,42,0.28)",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  headerIcon: {
    width: 90,
    height: 90,
    objectFit: "contain",
    display: "block",
    marginTop: 14,
  },
  headerLogo: {
    fontSize: 20,
    fontWeight: 700,
    color: C.white,
    letterSpacing: "-0.2px",
  },
  headerBadge: {
    background: "rgba(255,225,126,0.2)",
    border: "1px solid rgba(255,225,126,0.55)",
    color: "#fff8d8",
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 6,
    letterSpacing: "0.4px",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  keyBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(79,110,247,0.18)",
    border: "1px solid rgba(79,110,247,0.35)",
    borderRadius: 8,
    padding: "5px 12px",
    color: "#a5b4fc",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background 0.2s",
  },
  main: {
    maxWidth: 1160,
    margin: "0 auto",
    padding: "24px 16px 56px",
  },
  dashboardFrame: {
    background: "linear-gradient(180deg, rgba(15,29,47,0.97) 0%, rgba(13,26,43,0.97) 100%)",
    border: "1px solid rgba(56,84,112,0.7)",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 18px 42px rgba(2,8,18,0.48)",
  },
  workspaceLayout: {
    display: "grid",
    gridTemplateColumns: "230px minmax(0, 1fr)",
    gap: 14,
    alignItems: "start",
  },
  sideMenu: {
    background: "linear-gradient(180deg, #17283d 0%, #142438 100%)",
    border: "1px solid #2e475f",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 10px 22px rgba(1,8,20,0.4)",
    position: "sticky",
    top: 84,
  },
  sideMenuTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#8ea6bf",
    textTransform: "uppercase",
    letterSpacing: "0.7px",
    marginBottom: 10,
    padding: "2px 6px",
  },
  sideMenuList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  menuButton: {
    width: "100%",
    textAlign: "left",
    background: "linear-gradient(90deg, #1c2e44 0%, #1a2b40 100%)",
    border: "1px solid #2f4963",
    borderRadius: 9,
    padding: "10px 12px",
    fontSize: 13,
    color: C.textPrimary,
    fontWeight: 600,
    fontFamily: font,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    transition: "all 0.18s ease",
  },
  menuButtonActive: {
    background: "linear-gradient(90deg, #113b54 0%, #0f3f5f 52%, #0f5a6b 100%)",
    color: C.white,
    borderColor: "#2db6d6",
    boxShadow: "0 8px 16px rgba(0,0,0,0.34)",
  },
  contentPanel: {
    minWidth: 0,
  },
  loginShell: {
    minHeight: "100dvh",
    width: "100%",
    background: "radial-gradient(circle at 12% 8%, rgba(34,211,238,0.14) 0%, rgba(34,211,238,0) 34%), linear-gradient(150deg, #091323 0%, #102238 58%, #0f1f34 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 10px",
    boxSizing: "border-box",
  },
  loginCard: {
    background: "#182a3f",
    borderRadius: 10,
    padding: "16px 20px 16px",
    width: "100%",
    maxWidth: 300,
    border: "1px solid #314a62",
    boxShadow: "0 12px 30px rgba(0,0,0,0.38)",
  },
  loginBrandWrap: {
    textAlign: "center",
    marginBottom: 10,
  },
  loginLogoArt: {
    width: 188,
    maxWidth: "100%",
    display: "block",
    margin: "0 auto 4px",
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: "#e5edf7",
    marginBottom: 0,
    lineHeight: 1,
    textAlign: "center",
    letterSpacing: "0.5px",
  },
  loginSub: {
    fontSize: 15,
    color: "#a8b8cb",
    marginBottom: 2,
    lineHeight: 1.25,
    textAlign: "center",
    fontWeight: 700,
  },
  loginHint: {
    fontSize: 12,
    color: "#7f93ab",
    marginBottom: 12,
    textAlign: "center",
    letterSpacing: "0.2px",
  },
  loginField: {
    marginTop: 9,
  },
  loginLabel: {
    fontSize: 13,
    color: "#c7d3e2",
    fontWeight: 600,
    marginBottom: 7,
    display: "block",
  },
  loginInput: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #38536e",
    borderRadius: 7,
    fontSize: 14,
    fontFamily: font,
    color: "#d7e1ef",
    background: "#15283d",
    outline: "none",
    boxSizing: "border-box",
  },
  loginPasswordRow: {
    position: "relative",
  },
  loginEyeBtn: {
    position: "absolute",
    right: 10,
    top: 9,
    border: "none",
    background: "transparent",
    color: "#9ca3af",
    cursor: "pointer",
    fontSize: 14,
    padding: 2,
  },
  loginForgot: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 14,
    color: "#90d8eb",
    fontWeight: 600,
    cursor: "pointer",
  },
  loginPrimaryBtn: {
    width: "100%",
    marginTop: 12,
    borderRadius: 7,
    border: "none",
    background: "linear-gradient(90deg, #0ea5c5 0%, #14b8a6 100%)",
    color: C.white,
    padding: "10px 14px",
    fontSize: 16,
    lineHeight: 1,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: font,
  },
  loginGoogleBtn: {
    width: "100%",
    marginTop: 10,
    borderRadius: 7,
    border: "1px solid #36516b",
    background: "#1c2f45",
    color: "#d7e2ef",
    padding: "10px 14px",
    fontSize: 14,
    lineHeight: 1,
    fontWeight: 300,
    cursor: "pointer",
    fontFamily: font,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loginGMark: {
    width: 18,
    height: 18,
    display: "inline-block",
  },
  loginBottomLink: {
    marginTop: 12,
    textAlign: "center",
    fontSize: 12,
    color: "#8ea6bf",
    cursor: "pointer",
    textDecoration: "underline",
  },
  successText: {
    color: "#15803d",
    marginTop: 10,
    fontSize: 13,
    fontWeight: 600,
  },
  apiPanel: {
    background: "linear-gradient(120deg, #17293f 0%, #15263a 72%, #132439 100%)",
    border: "1px solid #2e4a65",
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    boxShadow: "0 10px 24px rgba(4,10,22,0.35)",
  },
  apiPanelRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
  apiStatus: {
    fontSize: 12,
    color: C.textMuted,
    marginLeft: "auto",
  },
  gmailPanel: {
    background: "linear-gradient(140deg, #13263b 0%, #15293f 100%)",
    border: "1px solid #35516b",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  gmailCardsStack: {
    display: "grid",
    gap: 12,
    marginBottom: 14,
  },
  gmailFetchCard: {
    background: "linear-gradient(130deg, #1b2d43 0%, #16283e 78%, #15273c 100%)",
    border: "1px solid #35516d",
    borderRadius: 12,
    padding: 14,
    boxShadow: "0 12px 26px rgba(1,8,20,0.36)",
  },
  gmailInboxCard: {
    background: "linear-gradient(125deg, #1a2c43 0%, #15273c 66%, #13253a 100%)",
    border: "1px solid #35506a",
    borderRadius: 12,
    padding: 14,
    boxShadow: "0 10px 22px rgba(2,9,21,0.34)",
  },
  gmailCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 0.35,
    textTransform: "uppercase",
    color: "#90d8eb",
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(26,65,88,0.5)",
    border: "1px solid rgba(54,126,161,0.82)",
    marginBottom: 10,
  },
  gmailGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 130px auto",
    gap: 8,
    alignItems: "center",
  },
  gmailHint: {
    marginTop: 8,
    fontSize: 12,
    color: C.textMuted,
    lineHeight: 1.5,
  },
  gmailListHeader: {
    marginTop: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  gmailListMeta: {
    fontSize: 12,
    color: C.textMuted,
    marginLeft: "auto",
  },
  gmailMessagesList: {
    marginTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: 280,
    overflowY: "auto",
    paddingRight: 4,
  },
  gmailMessageItem: {
    background: "#182a3f",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: 10,
    alignItems: "start",
  },
  gmailMessageMeta: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 4,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  gmailMessagePreview: {
    marginTop: 6,
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  inboxShell: {
    marginTop: 10,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    overflow: "hidden",
    background: "#15283e",
  },
  inboxToolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderBottom: `1px solid ${C.border}`,
    background: "linear-gradient(90deg, #1d334c 0%, #182d45 100%)",
    flexWrap: "wrap",
  },
  inboxToolbarActions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  inboxIconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: "1px solid #fca5a5",
    background: "#3b2028",
    color: "#ffb3bf",
    fontSize: 17,
    lineHeight: 1,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease",
  },
  inboxHeaderRow: {
    display: "grid",
    gridTemplateColumns: "44px 28px minmax(180px, 0.9fr) minmax(320px, 2fr) 140px",
    gap: 10,
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: `1px solid ${C.border}`,
    background: "linear-gradient(90deg, #1b2f46 0%, #182a40 100%)",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: C.textMuted,
  },
  inboxRows: {
    maxHeight: 340,
    overflowY: "auto",
  },
  inboxRow: {
    display: "grid",
    gridTemplateColumns: "44px 28px minmax(180px, 0.9fr) minmax(320px, 2fr) 140px",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    borderBottom: `1px solid ${C.border}`,
    cursor: "pointer",
    background: "#172a40",
  },
  inboxRowActive: {
    background: "#223a55",
  },
  inboxRowSelected: {
    background: "#20354f",
    fontWeight: 600,
  },
  inboxStar: {
    fontSize: 15,
    color: "#5f738a",
    lineHeight: 1,
    textAlign: "center",
  },
  inboxSender: {
    fontSize: 13,
    color: C.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  inboxSubjectLine: {
    fontSize: 13,
    color: C.textPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  inboxSnippet: {
    color: C.textSecondary,
    fontWeight: 400,
  },
  inboxDate: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  inboxPreviewPane: {
    padding: "12px 14px",
    background: "#16293f",
    borderTop: `1px solid ${C.border}`,
  },
  inboxPreviewTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: C.textPrimary,
    marginBottom: 6,
  },
  inboxPreviewMeta: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 8,
  },
  inboxPreviewBody: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    maxHeight: 180,
    overflowY: "auto",
  },
  statusPanel: {
    background: "linear-gradient(130deg, #1a2c43 0%, #15273c 65%, #132439 100%)",
    border: "1px solid #35516d",
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    boxShadow: "0 10px 24px rgba(2,9,21,0.35)",
  },
  statusHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  statusMeta: {
    fontSize: 12,
    color: C.textMuted,
  },
  statusList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  statusItem: {
    display: "grid",
    gridTemplateColumns: "120px 150px 1fr auto",
    gap: 10,
    alignItems: "center",
    background: "#182b41",
    border: "1px solid #324a63",
    borderRadius: 8,
    padding: "8px 10px",
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: 700,
    padding: "3px 9px",
    borderRadius: 999,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    justifySelf: "start",
  },
  statusEmpty: {
    fontSize: 13,
    color: C.textMuted,
    background: "#182b41",
    border: `1px dashed ${C.border}`,
    borderRadius: 8,
    padding: "10px 12px",
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    border: "1.5px solid #38536e",
    borderRadius: 7,
    fontSize: 14,
    fontFamily: fontMono,
    color: C.textPrimary,
    background: "#15283d",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  },
  // Buttons
  btnPrimary: {
    background: "linear-gradient(90deg, #0ea5c5 0%, #14b8a6 100%)",
    color: C.white,
    border: "none",
    borderRadius: 7,
    padding: "11px 22px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: font,
    transition: "background 0.2s, transform 0.1s, box-shadow 0.2s",
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
  },
  btnSecondary: {
    background: "linear-gradient(90deg, #1e334b 0%, #1a2e45 100%)",
    color: C.textPrimary,
    border: "1px solid #36516b",
    borderRadius: 7,
    padding: "10px 20px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: font,
    transition: "background 0.2s",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  btnDanger: {
    background: "#dc2626",
    color: C.white,
    border: "1px solid #b91c1c",
    borderRadius: 7,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: font,
  },
  // Input panel
  section: {
    background: "linear-gradient(130deg, #1a2c43 0%, #15273c 72%, #14253a 100%)",
    border: "1px solid #35516d",
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    boxShadow: "0 10px 24px rgba(2,9,21,0.34)",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.textPrimary,
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sectionSub: {
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 18,
    lineHeight: 1.6,
  },
  textarea: {
    width: "100%",
    minHeight: 200,
    padding: "14px 16px",
    border: "1.5px solid #38536e",
    borderRadius: 7,
    fontSize: 14,
    fontFamily: fontMono,
    color: C.textPrimary,
    background: "#15283d",
    outline: "none",
    resize: "vertical",
    lineHeight: 1.6,
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    flexWrap: "wrap",
  },
  // Progress bar
  progressWrap: {
    background: "linear-gradient(120deg, #1a2d44 0%, #16293f 80%)",
    border: "1px solid #35516c",
    borderRadius: 12,
    padding: "22px 28px",
    marginBottom: 24,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxShadow: "0 10px 24px rgba(2,9,21,0.34)",
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: C.textPrimary,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  progressBar: {
    height: 7,
    background: C.border,
    borderRadius: 99,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #2e64d5, #18a871)",
    borderRadius: 99,
    animation: "progress-anim 1.6s ease-in-out infinite",
    width: "60%",
  },
  // Stats
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 18,
    marginBottom: 28,
  },
  statCard: {
    background: "linear-gradient(180deg, #1b2f46 0%, #172a40 100%)",
    border: "1px solid #35516d",
    borderRadius: 12,
    padding: "20px 22px",
    boxShadow: "0 10px 20px rgba(2,9,21,0.34)",
    position: "relative",
    overflow: "hidden",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.9px",
    marginBottom: 12,
  },
  statValue: {
    fontSize: 30,
    fontWeight: 800,
    lineHeight: 1,
  },
  statSub: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 8,
  },
  chartSection: {
    marginBottom: 28,
    display: "grid",
    gap: 18,
  },
  chartGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 18,
  },
  chartCard: {
    background: "linear-gradient(180deg, #1b2f46 0%, #172a40 100%)",
    border: "1px solid #35516d",
    borderRadius: 12,
    padding: 18,
    boxShadow: "0 10px 20px rgba(2,9,21,0.34)",
  },
  chartCardWide: {
    background: "linear-gradient(180deg, #1b2f46 0%, #172a40 100%)",
    border: "1px solid #35516d",
    borderRadius: 12,
    padding: 18,
    boxShadow: "0 10px 20px rgba(2,9,21,0.34)",
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: C.textPrimary,
    marginBottom: 6,
  },
  chartSub: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 14,
    lineHeight: 1.5,
  },
  barList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  barRow: {
    display: "grid",
    gridTemplateColumns: "94px minmax(0, 1fr) 40px",
    gap: 10,
    alignItems: "center",
  },
  barLabel: {
    fontSize: 12,
    color: C.textSecondary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  barTrack: {
    height: 10,
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    border: "1px solid rgba(109,137,166,0.18)",
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
    background: "linear-gradient(90deg, #22d3ee 0%, #14b8a6 100%)",
  },
  barValue: {
    textAlign: "right",
    fontSize: 12,
    color: C.textPrimary,
    fontWeight: 700,
  },
  chartEmpty: {
    fontSize: 13,
    color: C.textMuted,
    border: `1px dashed ${C.border}`,
    borderRadius: 10,
    padding: "14px 16px",
    background: "rgba(8,18,29,0.22)",
  },
  // Email card
  emailCard: {
    background: "linear-gradient(180deg, #1b2f46 0%, #172a40 100%)",
    border: "1px solid #35516d",
    borderRadius: 12,
    marginBottom: 22,
    boxShadow: "0 12px 22px rgba(2,9,21,0.34)",
    overflow: "hidden",
    transition: "box-shadow 0.2s, transform 0.2s",
    animation: "card-rise 0.5s ease both",
  },
  cardHeader: {
    padding: "16px 22px",
    borderBottom: `1px solid ${C.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "linear-gradient(90deg, #1f344d 0%, #1a2f47 100%)",
  },
  cardHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  cardNum: {
    width: 30,
    height: 30,
    borderRadius: 7,
    background: "linear-gradient(135deg, #0ea5c5 0%, #14b8a6 100%)",
    color: C.white,
    fontSize: 13,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  customerName: {
    fontSize: 16,
    fontWeight: 700,
    color: C.textPrimary,
  },
  cardBody: {
    display: "grid",
    gridTemplateColumns: "1fr 1.35fr",
    gap: 0,
  },
  cardLeft: {
    padding: "20px 22px",
    borderRight: `1px solid ${C.border}`,
    background: "#172a40",
  },
  cardRight: {
    padding: "20px 22px",
    background: "#192d43",
  },
  badgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 14,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    letterSpacing: "0.2px",
  },
  escalationBanner: {
    background: C.redLight,
    border: `1px solid ${C.redBorder}`,
    borderRadius: 8,
    padding: "10px 14px",
    marginTop: 12,
    display: "flex",
    gap: 8,
  },
  escalationIcon: {
    fontSize: 16,
    flexShrink: 0,
  },
  escalationText: {
    fontSize: 13,
    color: "#b91c1c",
    fontWeight: 600,
    lineHeight: 1.4,
  },
  replyLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  replyBox: {
    background: "#132338",
    border: `1.5px solid ${C.border}`,
    borderRadius: 14,
    padding: "14px 16px",
    fontSize: 13.5,
    lineHeight: 1.7,
    color: C.textPrimary,
    fontFamily: font,
    whiteSpace: "pre-wrap",
    maxHeight: 240,
    overflowY: "auto",
    marginBottom: 12,
  },
  draftEditor: {
    width: "100%",
    minHeight: 180,
    background: "#15283d",
    border: `1.5px solid ${C.indigo}`,
    borderRadius: 7,
    padding: "14px 16px",
    fontSize: 13.5,
    lineHeight: 1.7,
    color: C.textPrimary,
    fontFamily: font,
    resize: "vertical",
    marginBottom: 12,
    outline: "none",
  },
  replyFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardActionRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 12,
  },
  recipientInput: {
    flex: "1 1 220px",
    minWidth: 0,
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 7,
    fontSize: 13,
    fontFamily: font,
    color: C.textPrimary,
    background: "#15283d",
    outline: "none",
  },
  sendNote: {
    marginTop: 8,
    fontSize: 12,
    color: C.textMuted,
    lineHeight: 1.5,
  },
  sendError: {
    marginTop: 8,
    fontSize: 12,
    color: "#b91c1c",
    fontWeight: 600,
  },
  sendInfo: {
    marginTop: 8,
    fontSize: 12,
    color: "#0f766e",
    fontWeight: 600,
  },
  scheduleRow: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 14,
    padding: 12,
    background: "#14263a",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
  },
  scheduleLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
  },
  scheduleGrid: {
    display: "grid",
    gridTemplateColumns: "1.3fr 0.7fr 0.7fr 0.8fr",
    gap: 8,
  },
  scheduleActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  scheduleInput: {
    width: "100%",
    padding: "9px 12px",
    border: `1.5px solid ${C.border}`,
    borderRadius: 7,
    fontSize: 13,
    fontFamily: font,
    color: C.textPrimary,
    background: "#15283d",
    outline: "none",
  },
  schedulePreview: {
    fontSize: 12,
    color: C.textSecondary,
    background: "#15283d",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "8px 10px",
    lineHeight: 1.5,
  },
  scheduleBadge: {
    fontSize: 12,
    color: "#7ee7d6",
    background: "#123f45",
    border: "1px solid #2a8b96",
    borderRadius: 999,
    padding: "4px 10px",
    whiteSpace: "nowrap",
  },
  tonePill: {
    fontSize: 12,
    color: C.textMuted,
    background: "#14263a",
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "4px 10px",
    fontStyle: "italic",
  },
  cardFooter: {
    borderTop: `1px solid ${C.border}`,
    padding: "0 22px",
  },
  toggleBtn: {
    background: "none",
    border: "none",
    fontSize: 13,
    color: C.textSecondary,
    cursor: "pointer",
    padding: "12px 0",
    fontFamily: font,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 5,
  },
  originalEmailBox: {
    background: C.offWhite,
    border: `1px solid ${C.border}`,
    borderRadius: 9,
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.65,
    color: C.textSecondary,
    fontFamily: fontMono,
    marginBottom: 14,
    whiteSpace: "pre-wrap",
  },
  // Error/info banners
  errorBanner: {
    background: C.redLight,
    border: `1px solid ${C.redBorder}`,
    borderRadius: 14,
    padding: "14px 18px",
    marginBottom: 20,
    fontSize: 14,
    color: "#b91c1c",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  footer: {
    textAlign: "center",
    padding: "24px 24px 36px",
    fontSize: 12,
    color: C.textMuted,
    borderTop: `1px solid ${C.border}`,
    marginTop: 12,
    background: "#0f1d2f",
  },
};

// ─── BADGE CONFIG ─────────────────────────────────────────────────────────────
function sentimentStyle(s) {
  const map = {
    Positive: { bg: C.greenLight, color: "#15803d", border: "#bbf7d0" },
    Neutral: { bg: C.yellowLight, color: "#854d0e", border: "#fde047" },
    Negative: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
    Furious: { bg: C.redLight, color: "#b91c1c", border: C.redBorder },
  };
  return map[s] || map.Neutral;
}
function urgencyStyle(u) {
  const map = {
    Low: { bg: C.greenLight, color: "#15803d", border: "#bbf7d0" },
    Medium: { bg: C.yellowLight, color: "#854d0e", border: "#fde047" },
    High: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
    Critical: { bg: C.redLight, color: "#b91c1c", border: C.redBorder },
  };
  return map[u] || map.Low;
}
function churnStyle(c) {
  const map = {
    Low: { bg: C.greenLight, color: "#15803d", border: "#bbf7d0" },
    Medium: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
    High: { bg: C.orangeLight, color: "#c2410c", border: C.orangeBorder },
  };
  return map[c] || map.Low;
}
function categoryStyle() {
  return { bg: C.indigoLight, color: "#3730a3", border: "#c7d2fe" };
}

function getCountByKey(results, key, value) {
  return results.filter((item) => String(item?.[key] || "") === value).length;
}

function buildChartRows(results, key, labels, fallbackLabel = "Other") {
  const rows = labels.map(({ label, value, color }) => ({
    label,
    value: getCountByKey(results, key, value),
    color,
  }));

  const knownValues = new Set(labels.map((entry) => entry.value));
  const fallbackCount = results.filter((item) => !knownValues.has(String(item?.[key] || ""))).length;

  if (fallbackCount > 0) {
    rows.push({ label: fallbackLabel, value: fallbackCount, color: "#64748b" });
  }

  return rows.filter((row) => row.value > 0);
}

function BarChart({ title, subtitle, rows }) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div style={S.chartCard}>
      <div style={S.chartTitle}>{title}</div>
      <div style={S.chartSub}>{subtitle}</div>
      {rows.length ? (
        <div style={S.barList}>
          {rows.map((row) => {
            const width = Math.max((row.value / max) * 100, row.value > 0 ? 8 : 0);
            return (
              <div key={row.label} style={S.barRow}>
                <div style={S.barLabel} title={row.label}>
                  {row.label}
                </div>
                <div style={S.barTrack}>
                  <div
                    style={{
                      ...S.barFill,
                      width: `${width}%`,
                      background: row.color || S.barFill.background,
                    }}
                  />
                </div>
                <div style={S.barValue}>{row.value}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={S.chartEmpty}>No data yet. Run an analysis to generate charts.</div>
      )}
    </div>
  );
}

function DashboardCharts({ results }) {
  const sentimentRows = buildChartRows(results, "sentiment", [
    { label: "Positive", value: "Positive", color: "#22c55e" },
    { label: "Neutral", value: "Neutral", color: "#eab308" },
    { label: "Negative", value: "Negative", color: "#f97316" },
    { label: "Furious", value: "Furious", color: "#ef4444" },
  ]);

  const urgencyRows = buildChartRows(results, "urgency", [
    { label: "Low", value: "Low", color: "#22c55e" },
    { label: "Medium", value: "Medium", color: "#eab308" },
    { label: "High", value: "High", color: "#f97316" },
    { label: "Critical", value: "Critical", color: "#ef4444" },
  ]);

  const categoryCounts = results.reduce((acc, item) => {
    const category = String(item?.category || "Other").trim() || "Other";
    acc.set(category, (acc.get(category) || 0) + 1);
    return acc;
  }, new Map());

  const categoryRows = Array.from(categoryCounts.entries())
    .map(([label, value], index) => ({
      label,
      value,
      color: ["#22d3ee", "#14b8a6", "#818cf8", "#f97316", "#ef4444"][index % 5],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return (
    <div style={S.chartSection}>
      <div style={S.chartGrid}>
        <BarChart
          title="Sentiment Mix"
          subtitle="How customer tone is distributed across the analyzed emails."
          rows={sentimentRows}
        />
        <BarChart
          title="Urgency Breakdown"
          subtitle="Tickets grouped by urgency level from low to critical."
          rows={urgencyRows}
        />
      </div>
      <div style={S.chartCardWide}>
        <div style={S.chartTitle}>Top Categories</div>
        <div style={S.chartSub}>The most common issue types in the current analysis batch.</div>
        {categoryRows.length ? (
          <div style={S.barList}>
            {categoryRows.map((row) => {
              const max = Math.max(...categoryRows.map((item) => item.value), 1);
              const width = Math.max((row.value / max) * 100, row.value > 0 ? 8 : 0);
              return (
                <div key={row.label} style={S.barRow}>
                  <div style={S.barLabel} title={row.label}>
                    {row.label}
                  </div>
                  <div style={S.barTrack}>
                    <div
                      style={{
                        ...S.barFill,
                        width: `${width}%`,
                        background: row.color,
                      }}
                    />
                  </div>
                  <div style={S.barValue}>{row.value}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={S.chartEmpty}>No category data yet. Analyze emails to see the chart.</div>
        )}
      </div>
    </div>
  );
}

function Badge({ label, emoji, styleObj, title }) {
  return (
    <span
      title={title || ""}
      style={{
        ...S.badge,
        background: styleObj.bg,
        color: styleObj.color,
        border: `1px solid ${styleObj.border}`,
        cursor: title ? "help" : "default",
      }}
    >
      {emoji && <span>{emoji}</span>}
      {label}
    </span>
  );
}

// ─── COPY BUTTON ─────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      style={{
        ...S.btnSecondary,
        fontSize: 12,
        padding: "6px 14px",
        background: copied ? C.greenLight : C.white,
        borderColor: copied ? "#bbf7d0" : C.border,
        color: copied ? "#15803d" : C.textPrimary,
        transition: "all 0.2s",
      }}
      onClick={handle}
    >
      {copied ? "✅ Copied!" : "📋 Copy Reply"}
    </button>
  );
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseRecipientEmails(value) {
  const parts = String(value || "")
    .split(/[\n,;]+/)
    .map((item) => normalizeEmail(item))
    .filter(Boolean);

  return Array.from(new Set(parts));
}

function buildScheduleTicketKey(ownerEmail, data, index) {
  const safeOwner = normalizeEmail(ownerEmail || "guest");
  return `${safeOwner}::${String(data.id ?? index)}`;
}

function formatDateTimeWithAmPm(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function getFetchedMessageKey(message, index) {
  const id = String(message?.uid || "").trim();
  return id || `idx-${index}`;
}

function normalizeEmailBody(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  // Convert HTML-heavy bodies to plain readable text for preview and analysis.
  const textOnly = raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return textOnly;
}

function formatFetchedMessagesForAnalysis(messages) {
  return messages
    .map((msg, idx) => {
      const sentAt = formatDateTimeWithAmPm(msg.date || Date.now());
      const body = normalizeEmailBody(msg.text) || "(No plain-text body found)";
      return [
        `Message ${idx + 1}`,
        `From: ${msg.from || "Unknown"}`,
        `Subject: ${msg.subject || "(No subject)"}`,
        `Date: ${sentAt}`,
        "",
        body,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function mergeFetchedMessages(existingMessages, incomingMessages) {
  const merged = [...existingMessages];
  const seenKeys = new Set(existingMessages.map((msg, idx) => getFetchedMessageKey(msg, idx)));

  for (const message of incomingMessages) {
    const key = getFetchedMessageKey(message, merged.length);
    if (!seenKeys.has(key)) {
      merged.push(message);
      seenKeys.add(key);
    }
  }

  return merged;
}

function formatLocalDateInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildScheduledTimestamp(dateInput, hourInput, minuteInput, periodInput) {
  if (!dateInput || !hourInput || !minuteInput || !periodInput) {
    return Number.NaN;
  }

  const [year, month, day] = dateInput.split("-").map(Number);
  const hour24Base = Number(hourInput) % 12;
  const hour24 = periodInput === "PM" ? hour24Base + 12 : hour24Base;
  const minute = Number(minuteInput);

  if (![year, month, day, hour24, minute].every(Number.isFinite)) {
    return Number.NaN;
  }

  const scheduled = new Date(year, month - 1, day, hour24, minute, 0, 0);
  return scheduled.getTime();
}

async function fetchScheduledJob(ticketKey, ownerEmail) {
  const query = new URLSearchParams({ ticketKey, ownerEmail: ownerEmail || "" });
  const response = await fetch(apiUrl(`/api/scheduled-emails?${query.toString()}`));
  if (!response.ok) {
    throw new Error("Unable to fetch scheduled email status.");
  }

  const payload = await response.json();
  return payload.job || null;
}

async function createScheduledJob({ ticketKey, ownerEmail, recipientEmail, subject, body, scheduledAtMs }) {
  const response = await fetch(apiUrl("/api/scheduled-emails"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ticketKey,
      ownerEmail,
      recipientEmail,
      subject,
      body,
      scheduledAtMs,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to schedule email.");
  }

  return payload.job;
}

async function cancelScheduledJob(ticketKey, ownerEmail) {
  const query = new URLSearchParams({ ownerEmail: ownerEmail || "" });
  const response = await fetch(apiUrl(`/api/scheduled-emails/${encodeURIComponent(ticketKey)}?${query.toString()}`), {
    method: "DELETE",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to cancel scheduled email.");
  }
}

async function sendEmailNow({ ticketKey, ownerEmail, recipientEmail, subject, body }) {
  const response = await fetch(apiUrl("/api/send-email"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ticketKey,
      ownerEmail,
      recipientEmail,
      subject,
      body,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to send email now.");
  }

  return payload;
}

async function fetchDeliveryStatus(ownerEmail, limit = 30) {
  const query = new URLSearchParams({
    ownerEmail: ownerEmail || "",
    limit: String(limit),
  });
  const response = await fetch(apiUrl(`/api/scheduled-emails/history?${query.toString()}`));
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Unable to fetch delivery history.");
  }

  return {
    pendingJobs: Array.isArray(payload.pendingJobs) ? payload.pendingJobs : [],
    history: Array.isArray(payload.history) ? payload.history : [],
  };
}

function isAutoScheduledHistoryEvent(event) {
  const status = String(event?.status || "").toLowerCase();
  if (status !== "sent" && status !== "failed") {
    return false;
  }

  const source = String(event?.deliverySource || "").toLowerCase();
  return source === "scheduled";
}

async function deleteDeliveryHistoryEvent({ ticketKey, eventTimeMs, ownerEmail }) {
  const query = new URLSearchParams({
    ownerEmail: ownerEmail || "",
    eventTimeMs: String(eventTimeMs || ""),
  });

  const response = await fetch(
    apiUrl(`/api/scheduled-emails/history/${encodeURIComponent(ticketKey)}?${query.toString()}`),
    {
      method: "DELETE",
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to delete history item.");
  }
}

async function fetchSentEmailContent({ ownerEmail, ticketKey, gmailMessageId, recipientEmail, subject, eventTimeMs }) {
  const query = new URLSearchParams({
    ownerEmail: ownerEmail || "",
    ticketKey: ticketKey || "",
    gmailMessageId: gmailMessageId || "",
    recipientEmail: recipientEmail || "",
    subject: subject || "",
    eventTimeMs: String(eventTimeMs || ""),
  });

  const response = await fetch(apiUrl(`/api/gmail/sent-message?${query.toString()}`));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Unable to fetch sent email content.");
  }

  return payload.content || null;
}

async function fetchGmailMessages({ maxCount, unseenOnly, ownerEmail, gmailEmail, pageToken }) {
  const response = await fetch(apiUrl("/api/gmail/fetch"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      maxCount,
      unseenOnly,
      ownerEmail,
      gmailEmail,
      pageToken,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Unable to fetch Gmail messages.");
  }

  return {
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    nextPageToken: payload.nextPageToken || null,
  };
}

async function trashGmailMessages({ ownerEmail, gmailEmail, messageIds }) {
  const response = await fetch(apiUrl("/api/gmail/trash"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ownerEmail,
      gmailEmail,
      messageIds,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Unable to delete Gmail messages.");
  }

  return payload;
}

async function getGmailOAuthStatus(ownerEmail) {
  const query = new URLSearchParams({ ownerEmail: ownerEmail || "" });
  const response = await fetch(apiUrl(`/api/gmail/oauth/status?${query.toString()}`));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to fetch Gmail OAuth status.");
  }
  return payload;
}

async function startGmailOAuth(ownerEmail, gmailEmail) {
  const query = new URLSearchParams({
    ownerEmail: ownerEmail || "",
    gmailEmail: gmailEmail || "",
  });
  const response = await fetch(apiUrl(`/api/gmail/oauth/start?${query.toString()}`));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to start Gmail OAuth.");
  }
  if (!payload.authUrl) {
    throw new Error("OAuth URL missing from server response.");
  }
  return payload.authUrl;
}

async function disconnectGmailOAuth(ownerEmail) {
  const query = new URLSearchParams({ ownerEmail: ownerEmail || "" });
  const response = await fetch(apiUrl(`/api/gmail/oauth?${query.toString()}`), {
    method: "DELETE",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Unable to disconnect Gmail OAuth.");
  }
}

// ─── EMAIL CARD ───────────────────────────────────────────────────────────────
function EmailCard({ data, index, ownerEmail }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [draftReply, setDraftReply] = useState(data.draft_reply || "");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sendError, setSendError] = useState("");
  const [sendInfo, setSendInfo] = useState("");
  const [scheduledDateInput, setScheduledDateInput] = useState("");
  const [scheduledHourInput, setScheduledHourInput] = useState("09");
  const [scheduledMinuteInput, setScheduledMinuteInput] = useState("00");
  const [scheduledPeriodInput, setScheduledPeriodInput] = useState("AM");
  const [scheduledJob, setScheduledJob] = useState(null);
  const [sendingNow, setSendingNow] = useState(false);
  const isEscalate = data.escalate === true;
  const isHighChurn = data.churn_risk === "High";
  const ticketKey = buildScheduleTicketKey(ownerEmail, data, index);

  const leftBorderColor = isEscalate
    ? C.red
    : isHighChurn
    ? C.orange
    : "transparent";

  const subject = `Re: ${data.category || "Customer support request"}`;

  useEffect(() => {
    let isCancelled = false;

    fetchScheduledJob(ticketKey, ownerEmail)
      .then((job) => {
        if (isCancelled || !job) {
          return;
        }

        setScheduledJob(job);
        const loadedDate = new Date(job.scheduledAtMs);
        const loadedHour24 = loadedDate.getHours();
        const loadedHour12 = loadedHour24 % 12 || 12;
        setScheduledDateInput(formatLocalDateInput(loadedDate));
        setScheduledHourInput(String(loadedHour12).padStart(2, "0"));
        setScheduledMinuteInput(String(loadedDate.getMinutes()).padStart(2, "0"));
        setScheduledPeriodInput(loadedHour24 >= 12 ? "PM" : "AM");
        setRecipientEmail(job.recipientEmail || "");
      })
      .catch(() => {
        if (!isCancelled) {
          setSendInfo("Scheduler service not reachable. Start backend to enable auto-send.");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [ticketKey, ownerEmail]);

    const handleSendNow = async () => {
    const targetEmails = parseRecipientEmails(recipientEmail);
    if (!targetEmails.length) {
      setSendError("Enter at least one recipient email address before sending.");
      setSendInfo("");
      return;
    }

    const invalidEmails = targetEmails.filter((email) => !isValidEmail(email));
    if (invalidEmails.length) {
      setSendError(`Invalid recipient email(s): ${invalidEmails.join(", ")}`);
      setSendInfo("");
      return;
    }

    if (!draftReply.trim()) {
      setSendError("Draft reply is empty. Write or generate a reply before sending.");
      setSendInfo("");
      return;
    }

    try {
      setSendingNow(true);
      const sendAllResults = await Promise.allSettled(
        targetEmails.map((email, index) =>
          sendEmailNow({
            ticketKey:
              targetEmails.length === 1
                ? ticketKey
                : `${ticketKey}::send-${Date.now()}-${index + 1}`,
            ownerEmail,
            recipientEmail: email,
            subject,
            body: draftReply,
          })
        )
      );

      const failedEmails = [];
      const sentEmails = [];

      sendAllResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          sentEmails.push(targetEmails[index]);
        } else {
          failedEmails.push(targetEmails[index]);
        }
      });

      if (sentEmails.length) {
        setScheduledJob(null);
        setSendInfo(
          sentEmails.length === 1
            ? `Email sent successfully to ${sentEmails[0]}.`
            : `${sentEmails.length} emails sent successfully.`
        );
      } else {
        setSendInfo("");
      }

      if (failedEmails.length) {
        setSendError(
          failedEmails.length === 1
            ? `Unable to send email to ${failedEmails[0]}.`
            : `Unable to send ${failedEmails.length} emails: ${failedEmails.slice(0, 3).join(", ")}${failedEmails.length > 3 ? "..." : ""}`
        );
      } else {
        setSendError("");
      }
    } catch (error) {
      setSendError(error.message || "Unable to send email now.");
      setSendInfo("");
    } finally {
      setSendingNow(false);
    }
  };

  const handleScheduleSend = async () => {
    const targetEmails = parseRecipientEmails(recipientEmail);
    if (!targetEmails.length) {
      setSendError("Enter at least one recipient email address before scheduling.");
      setSendInfo("");
      return;
    }

    const invalidEmails = targetEmails.filter((email) => !isValidEmail(email));
    if (invalidEmails.length) {
      setSendError(`Invalid recipient email(s): ${invalidEmails.join(", ")}`);
      setSendInfo("");
      return;
    }

    if (!scheduledDateInput || !scheduledHourInput || !scheduledMinuteInput || !scheduledPeriodInput) {
      setSendError("Choose a scheduled date and time.");
      setSendInfo("");
      return;
    }

    const scheduledAtMs = buildScheduledTimestamp(
      scheduledDateInput,
      scheduledHourInput,
      scheduledMinuteInput,
      scheduledPeriodInput
    );
    if (!Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now() + 5000) {
      setSendError("Scheduled time must be at least a few seconds in the future.");
      setSendInfo("");
      return;
    }

    try {
      const scheduleResults = await Promise.allSettled(
        targetEmails.map((email, index) =>
          createScheduledJob({
            ticketKey:
              targetEmails.length === 1
                ? ticketKey
                : `${ticketKey}::sched-${scheduledAtMs}-${index + 1}`,
            ownerEmail,
            recipientEmail: email,
            subject,
            body: draftReply,
            scheduledAtMs,
          })
        )
      );

      const createdJobs = [];
      const failedEmails = [];

      scheduleResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          createdJobs.push(result.value);
        } else {
          failedEmails.push(targetEmails[index]);
        }
      });

      if (createdJobs.length === 1) {
        setScheduledJob(createdJobs[0]);
      } else {
        setScheduledJob(null);
      }

      if (createdJobs.length) {
        setSendInfo(
          createdJobs.length === 1
            ? `Auto-send scheduled for ${formatDateTimeWithAmPm(scheduledAtMs)}.`
            : `${createdJobs.length} auto-sends scheduled for ${formatDateTimeWithAmPm(scheduledAtMs)}.`
        );
      } else {
        setSendInfo("");
      }

      if (failedEmails.length) {
        setSendError(
          failedEmails.length === 1
            ? `Unable to schedule auto-send for ${failedEmails[0]}.`
            : `Unable to schedule ${failedEmails.length} emails: ${failedEmails.slice(0, 3).join(", ")}${failedEmails.length > 3 ? "..." : ""}`
        );
      } else {
        setSendError("");
      }
    } catch (error) {
      setSendError(error.message || "Unable to schedule auto-send.");
      setSendInfo("");
    }
  };

  const handleCancelScheduledSend = async () => {
    try {
      await cancelScheduledJob(ticketKey, ownerEmail);
      setScheduledJob(null);
      setSendInfo("Scheduled auto-send canceled.");
      setSendError("");
    } catch (error) {
      setSendError(error.message || "Unable to cancel scheduled send.");
    }
  };

  return (
    <div
      style={{
        ...S.emailCard,
        borderLeft: `4px solid ${leftBorderColor}`,
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.boxShadow =
          "0 8px 18px rgba(15,22,41,0.12)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.boxShadow =
          "0 3px 10px rgba(15,22,41,0.08)")
      }
    >
      {/* Card Header */}
      <div style={S.cardHeader}>
        <div style={S.cardHeaderLeft}>
          <div style={S.cardNum}>{index + 1}</div>
          <div>
            <div style={S.customerName}>
              {data.customer_name || "Unknown Customer"}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              Email #{data.id}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isEscalate && (
            <span
              style={{
                background: C.red,
                color: C.white,
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 6,
                letterSpacing: "0.5px",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              🚨 ESCALATE
            </span>
          )}
          {isHighChurn && (
            <span
              style={{
                background: C.orange,
                color: C.white,
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 6,
                letterSpacing: "0.5px",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              ⚠️ CHURN RISK
            </span>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div style={S.cardBody} className="email-card-body">
        {/* LEFT */}
        <div style={S.cardLeft} className="email-card-left">
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              marginBottom: 10,
            }}
          >
            Classification
          </div>
          <div style={S.badgeRow}>
            <Badge
              label={data.sentiment}
              emoji={
                data.sentiment === "Furious"
                  ? "😡"
                  : data.sentiment === "Negative"
                  ? "😞"
                  : data.sentiment === "Positive"
                  ? "😊"
                  : "😐"
              }
              styleObj={sentimentStyle(data.sentiment)}
            />
            <Badge
              label={data.category}
              emoji="🏷️"
              styleObj={categoryStyle()}
            />
            <Badge
              label={`${data.urgency} Urgency`}
              emoji={data.urgency === "Critical" ? "🔴" : data.urgency === "High" ? "🟠" : data.urgency === "Medium" ? "🟡" : "🟢"}
              styleObj={urgencyStyle(data.urgency)}
            />
            <Badge
              label={`${data.churn_risk} Churn`}
              emoji="📉"
              styleObj={churnStyle(data.churn_risk)}
              title={data.churn_reason}
            />
          </div>

          {/* Churn Reason */}
          {data.churn_reason && (
            <div
              style={{
                fontSize: 13,
                color: C.textSecondary,
                marginBottom: 12,
                lineHeight: 1.5,
                padding: "8px 12px",
                background: C.offWhite,
                borderRadius: 7,
                border: `1px solid ${C.border}`,
              }}
            >
              <span style={{ fontWeight: 600, color: C.textPrimary }}>
                Churn signal:{" "}
              </span>
              {data.churn_reason}
            </div>
          )}

          {/* Escalation Banner */}
          {isEscalate && data.escalation_reason && (
            <div style={S.escalationBanner}>
              <span style={S.escalationIcon}>🚨</span>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: "#b91c1c",
                    letterSpacing: "0.5px",
                    marginBottom: 2,
                  }}
                >
                  ESCALATION REQUIRED
                </div>
                <div style={S.escalationText}>
                  {data.escalation_reason}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Reply */}
        <div style={S.cardRight}>
          <div style={S.replyLabel}>
            <span>✉️</span> Draft Reply
          </div>
          {isEditingDraft ? (
            <textarea
              style={S.draftEditor}
              value={draftReply}
              onChange={(e) => setDraftReply(e.target.value)}
            />
          ) : (
            <div style={S.replyBox}>{draftReply}</div>
          )}
          <div style={S.replyFooter}>
            <CopyButton text={draftReply} />
            <span style={S.tonePill}>Tone: {data.reply_tone}</span>
          </div>
          <div style={S.cardActionRow}>
            <input
              style={S.recipientInput}
              type="text"
              placeholder="Recipient email(s): comma, semicolon, or new line separated"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
            />
            <button
              style={S.btnSecondary}
              onClick={() => setIsEditingDraft((value) => !value)}
            >
              {isEditingDraft ? "Done Editing" : "Edit Draft"}
            </button>
            {isEditingDraft && (
              <button
                style={S.btnSecondary}
                onClick={() => setDraftReply(data.draft_reply || "")}
              >
                Reset Draft
              </button>
            )}
            <button
              style={{ ...S.btnPrimary, marginLeft: "auto", opacity: sendingNow ? 0.8 : 1 }}
              onClick={handleSendNow}
              disabled={sendingNow}
            >
              {sendingNow ? "Sending..." : "Send Now"}
            </button>
          </div>
          <div style={S.scheduleRow}>
            <div style={S.scheduleLabel}>Schedule Send Time</div>
            <div style={S.scheduleGrid}>
              <input
                style={S.scheduleInput}
                type="date"
                value={scheduledDateInput}
                onChange={(e) => setScheduledDateInput(e.target.value)}
              />
              <select
                style={S.scheduleInput}
                value={scheduledHourInput}
                onChange={(e) => setScheduledHourInput(e.target.value)}
              >
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((hour) => (
                  <option key={hour} value={hour}>
                    {hour}
                  </option>
                ))}
              </select>
              <select
                style={S.scheduleInput}
                value={scheduledMinuteInput}
                onChange={(e) => setScheduledMinuteInput(e.target.value)}
              >
                {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map((minute) => (
                  <option key={minute} value={minute}>
                    {minute}
                  </option>
                ))}
              </select>
              <select
                style={S.scheduleInput}
                value={scheduledPeriodInput}
                onChange={(e) => setScheduledPeriodInput(e.target.value)}
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
            <div style={S.schedulePreview}>
              Selected time: {formatDateTimeWithAmPm(buildScheduledTimestamp(
                scheduledDateInput,
                scheduledHourInput,
                scheduledMinuteInput,
                scheduledPeriodInput
              )) || "Choose date and time"}
            </div>
            <div style={S.scheduleActions}>
              <button style={S.btnSecondary} onClick={handleScheduleSend}>
                Schedule Auto Send
              </button>
              {scheduledJob && (
                <>
                  <button style={S.btnDanger} onClick={handleCancelScheduledSend}>
                    Cancel Schedule
                  </button>
                  <span style={S.scheduleBadge}>
                    Scheduled: {formatDateTimeWithAmPm(scheduledJob.scheduledAtMs)}
                  </span>
                </>
              )}
            </div>
          </div>
          {sendInfo && <div style={S.sendInfo}>{sendInfo}</div>}
          {sendError && <div style={S.sendError}>{sendError}</div>}
        </div>
      </div>

      {/* Footer — Original Email Toggle */}
      <div style={S.cardFooter}>
        <button
          style={S.toggleBtn}
          onClick={() => setShowOriginal((v) => !v)}
        >
          <span>{showOriginal ? "▲" : "▼"}</span>
          {showOriginal ? "Hide" : "View"} Original Email
        </button>
        {showOriginal && (
          <div style={S.originalEmailBox}>{data.original_email}</div>
        )}
      </div>
    </div>
  );
}

// ─── STATS STRIP ─────────────────────────────────────────────────────────────
function StatsStrip({ results }) {
  const total = results.length;
  const escalations = results.filter((r) => r.escalate).length;
  const highChurn = results.filter((r) => r.churn_risk === "High").length;
  const urgencyMap = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  const avgUrgencyVal =
    results.reduce((acc, r) => acc + (urgencyMap[r.urgency] || 1), 0) /
    total;
  const avgUrgency =
    avgUrgencyVal >= 3.5
      ? "Critical"
      : avgUrgencyVal >= 2.5
      ? "High"
      : avgUrgencyVal >= 1.5
      ? "Medium"
      : "Low";

  const stats = [
    {
      label: "Emails Processed",
      value: total,
      emoji: "📧",
      color: C.indigo,
      sub: "total analyzed",
    },
    {
      label: "Escalations Flagged",
      value: escalations,
      emoji: "🚨",
      color: C.red,
      sub: "require immediate action",
    },
    {
      label: "High Churn Risk",
      value: highChurn,
      emoji: "⚠️",
      color: C.orange,
      sub: "likely to churn",
    },
    {
      label: "Avg. Urgency",
      value: avgUrgency,
      emoji: "📊",
      color: C.navyMid,
      sub: "across all tickets",
      isText: true,
    },
  ];

  return (
    <>
      <div style={S.statsRow} className="stats-row">
        {stats.map((s) => (
          <div key={s.label} style={S.statCard}>
            <div style={S.statLabel}>
              {s.emoji} {s.label}
            </div>
            <div
              style={{
                ...S.statValue,
                color: s.color,
                fontSize: s.isText ? 22 : 30,
              }}
            >
              {s.value}
            </div>
            <div style={S.statSub}>{s.sub}</div>
          </div>
        ))}
      </div>
      <DashboardCharts results={results} />
    </>
  );
}

function LoginMascotLogo() {
  return <img style={S.loginLogoArt} src={loginMascotLogo} alt="Mail assistant mascot" />;
}

function GoogleLogoIcon() {
  return <img style={S.loginGMark} src={googleLogo} alt="" aria-hidden="true" />;
}

// ─── LOGIN PAGE ──────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [googleOnlyEmail, setGoogleOnlyEmail] = useState("");
  const [mode, setMode] = useState("login");
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const setModeAndClear = (nextMode) => {
    setMode(nextMode);
    setLocalError("");
    setSuccessMessage("");
    setGoogleOnlyEmail("");
  };

  const isGoogleOnlyAccount = (user) =>
    user?.authProvider === "google" && !String(user?.password || "").trim();

  const submit = () => {
    const normalizedEmail = normalizeEmail(email);
    const trimmedPassword = password.trim();

    setLocalError("");
    setSuccessMessage("");
    setGoogleOnlyEmail("");

    if (!normalizedEmail) {
      setLocalError("Please enter your email address.");
      return;
    }

    if (mode !== "forgot" && !trimmedPassword) {
      setLocalError("Please enter both email and password.");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setLocalError("Please enter a valid email address.");
      return;
    }

    if (trimmedPassword && trimmedPassword.length < 6) {
      setLocalError("Password must be at least 6 characters long.");
      return;
    }

    const users = loadAuthUsers();
    const existingUser = users.find((user) => user.email === normalizedEmail);

    if (mode === "forgot") {
      if (!existingUser) {
        setLocalError("No account found for this email.");
        return;
      }

      if (isGoogleOnlyAccount(existingUser)) {
        setLocalError("This account uses Google Sign-In. Continue with Google below.");
        setGoogleOnlyEmail(normalizedEmail);
        return;
      }

      if (!trimmedPassword) {
        setLocalError("Please enter a new password.");
        return;
      }

      if (trimmedPassword !== confirmPassword.trim()) {
        setLocalError("Passwords do not match.");
        return;
      }

      const nextUsers = users.map((user) =>
        user.email === normalizedEmail
          ? {
              ...user,
              password: trimmedPassword,
              updatedAt: new Date().toISOString(),
            }
          : user
      );
      saveAuthUsers(nextUsers);

      setPassword("");
      setConfirmPassword("");
      setSuccessMessage("Password reset successful. Please sign in.");
      setMode("login");
      return;
    }

    if (mode === "signup") {
      if (existingUser) {
        if (existingUser.authProvider === "google") {
          setLocalError("Account already exists with Google. Use Google Sign-In.");
        } else {
          setLocalError("Account already exists. Please sign in.");
        }
        return;
      }

      const nextUsers = [
        ...users,
        {
          email: normalizedEmail,
          password: trimmedPassword,
          authProvider: "local",
          createdAt: new Date().toISOString(),
        },
      ];
      saveAuthUsers(nextUsers);
      setLocalError("");
      onLogin(normalizedEmail);
      return;
    }

    if (!existingUser) {
      setLocalError("No account found. Please create an account first.");
      return;
    }

    if (isGoogleOnlyAccount(existingUser)) {
      setLocalError("This account uses Google Sign-In. Continue with Google below.");
      setGoogleOnlyEmail(normalizedEmail);
      return;
    }

    if (existingUser.password !== trimmedPassword) {
      setLocalError("Incorrect password. Please try again.");
      return;
    }

    setLocalError("");
    onLogin(normalizedEmail);
  };

  const signInWithGoogle = async (preferredEmail = "") => {
    setLocalError("");
    setSuccessMessage("");
    setGoogleOnlyEmail("");

    setIsGoogleLoading(true);
    try {
      const auth = getFirebaseAuthInstance();
      await setPersistence(auth, browserLocalPersistence);

      const provider = new GoogleAuthProvider();
      const preferredNormalized = normalizeEmail(preferredEmail);
      provider.setCustomParameters(
        preferredNormalized && isValidEmail(preferredNormalized)
          ? { prompt: "select_account", login_hint: preferredNormalized }
          : { prompt: "select_account" }
      );

      const result = await signInWithPopup(auth, provider);
      const normalizedEmail = normalizeEmail(result.user?.email || "");

      if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
        throw new Error("Google did not return a valid email address.");
      }

      const users = loadAuthUsers();
      const existingUser = users.find((user) => user.email === normalizedEmail);

      if (!existingUser) {
        const nextUsers = [
          ...users,
          {
            email: normalizedEmail,
            password: "",
            authProvider: "google",
            createdAt: new Date().toISOString(),
          },
        ];
        saveAuthUsers(nextUsers);
      } else if (existingUser.authProvider !== "google" && existingUser.authProvider !== "local+google") {
        // Link existing local account with Google so user can use either login method.
        const nextUsers = users.map((user) =>
          user.email === normalizedEmail
            ? {
                ...user,
                authProvider: "local+google",
                updatedAt: new Date().toISOString(),
              }
            : user
        );
        saveAuthUsers(nextUsers);
      }

      onLogin(normalizedEmail);
    } catch (err) {
      const fallbackMessage = err?.message || "Unknown error.";
      const firebaseCode = err?.code || "";
      if (firebaseCode === "auth/popup-closed-by-user") {
        setLocalError("Google Sign-In was cancelled.");
      } else if (firebaseCode === "auth/popup-blocked") {
        setLocalError("Popup blocked by browser. Allow popups and try again.");
      } else if (firebaseCode === "auth/network-request-failed") {
        setLocalError(
          "Google Sign-In could not reach Firebase. Check internet connection, disable VPN/ad-blockers for this site, and ensure third-party cookies are allowed, then try again."
        );
      } else {
        setLocalError(`Google Sign-In failed: ${fallbackMessage}`);
      }
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div style={S.loginShell}>
      <div style={S.loginCard}>
        <div style={S.loginBrandWrap}>
          <LoginMascotLogo />
        </div>

        <div style={S.loginTitle}>Mail Assistant</div>
        <div style={S.loginHint}>Please enter your credentials</div>

        {mode === "signup" && (
          <div style={{ ...S.loginHint, color: "#0f172a", marginBottom: 8 }}>
            Create your account to continue.
          </div>
        )}
        {mode === "forgot" && (
          <div style={{ ...S.loginHint, color: "#0f172a", marginBottom: 8 }}>
            Reset your password for this account.
          </div>
        )}

        <div style={S.loginField}>
          <label style={S.loginLabel}>Email {mode === "login" && <span style={{ color: "#c0263d" }}>*</span>}</label>
          <input
            style={S.loginInput}
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (googleOnlyEmail) {
                setGoogleOnlyEmail("");
              }
            }}
            autoFocus
          />
        </div>

        <div style={S.loginField}>
          <label style={S.loginLabel}>
            {mode === "forgot" ? "New Password" : "Password"}
          </label>
          <div style={S.loginPasswordRow}>
            <input
              style={{ ...S.loginInput, paddingRight: 34 }}
              type={showPassword ? "text" : "password"}
              placeholder={mode === "forgot" ? "Enter new password" : "Enter your password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button
              type="button"
              style={S.loginEyeBtn}
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
        </div>

        {mode === "forgot" && (
          <div style={S.loginField}>
            <label style={S.loginLabel}>Confirm Password</label>
            <input
              style={S.loginInput}
              type="password"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
        )}

        {mode === "login" && (
          <div style={S.loginForgot} onClick={() => setModeAndClear("forgot")}>
            Forgot Password?
          </div>
        )}

        {localError && (
          <div style={{ color: "#b91c1c", marginTop: 10, fontSize: 13 }}>
            {localError}
          </div>
        )}
        {mode === "login" && googleOnlyEmail && (
          <button
            type="button"
            style={{
              ...S.loginGoogleBtn,
              marginTop: 10,
              background: "#f8fafc",
              borderColor: "#cbd5e1",
              color: "#0f172a",
            }}
            onClick={() => signInWithGoogle(googleOnlyEmail)}
            disabled={isGoogleLoading}
          >
            <GoogleLogoIcon />
            {isGoogleLoading ? "Connecting..." : `Continue with Google (${googleOnlyEmail})`}
          </button>
        )}
        {successMessage && (
          <div style={S.successText}>{successMessage}</div>
        )}

        <button
          style={S.loginPrimaryBtn}
          onClick={submit}
        >
          {mode === "signup"
            ? "Create"
            : mode === "forgot"
            ? "Reset"
            : "Login"}
        </button>

        <button style={S.loginGoogleBtn} onClick={signInWithGoogle} disabled={isGoogleLoading}>
          <GoogleLogoIcon />
          {isGoogleLoading ? "Connecting..." : "Sign in with Google"}
        </button>

        {mode === "login" ? (
          <div style={S.loginBottomLink} onClick={() => setModeAndClear("signup")}>
            Don't have an account? Create account
          </div>
        ) : (
          <div style={S.loginBottomLink} onClick={() => setModeAndClear("login")}>
            Back to Sign In
          </div>
        )}
        </div>
    </div>
  );
}

function statusBadgeStyle(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "sent") {
    return { background: "#ecfdf3", color: "#166534", border: "1px solid #86efac" };
  }
  if (normalized === "failed") {
    return { background: "#fef2f2", color: "#991b1b", border: "1px solid #fca5a5" };
  }
  if (normalized === "canceled") {
    return { background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74" };
  }
  return { background: "#eff6ff", color: "#1d4ed8", border: "1px solid #93c5fd" };
}

function formatDeliveryDetailText(event) {
  return "";
}

function DeliveryStatusPanel({ ownerEmail, mode = "all" }) {
  const [pendingJobs, setPendingJobs] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const [deletingHistoryKey, setDeletingHistoryKey] = useState("");
  const [expandedHistoryKey, setExpandedHistoryKey] = useState("");
  const [historyContentByKey, setHistoryContentByKey] = useState({});
  const [loadingHistoryContentKey, setLoadingHistoryContentKey] = useState("");
  const visibleHistory = useMemo(
    () => (mode === "pending" ? history.filter(isAutoScheduledHistoryEvent) : history),
    [history, mode]
  );

  const refresh = useCallback(async () => {
    if (!ownerEmail) {
      setPendingJobs([]);
      setHistory([]);
      setLoadError("");
      return;
    }

    try {
      const data = await fetchDeliveryStatus(ownerEmail, 30);
      setPendingJobs(data.pendingJobs);
      setHistory(data.history);
      setLoadError("");
      setLastUpdated(Date.now());
    } catch (error) {
      setLoadError(error.message || "Unable to load delivery status.");
    }
  }, [ownerEmail]);

  const handleDeleteJob = useCallback(async (ticketKey) => {
    if (!window.confirm("Delete this scheduled email?")) {
      return;
    }

    setDeletingKey(ticketKey);
    try {
      await cancelScheduledJob(ticketKey, ownerEmail);
      setPendingJobs((jobs) => jobs.filter((job) => job.ticketKey !== ticketKey));
      setLoadError("");
    } catch (error) {
      setLoadError(error.message || "Unable to delete scheduled email.");
    } finally {
      setDeletingKey(null);
    }
  }, [ownerEmail]);

  const handleDeleteHistoryEvent = useCallback(async (event) => {
    const ticketKey = String(event?.ticketKey || "").trim();
    const eventTimeMs = Number(event?.eventTimeMs || 0);
    if (!ticketKey || !Number.isFinite(eventTimeMs) || eventTimeMs <= 0) {
      setLoadError("Unable to delete this history item.");
      return;
    }

    if (!window.confirm("Delete this Sent/Failed history item?")) {
      return;
    }

    const itemKey = `${ticketKey}-${eventTimeMs}`;
    setDeletingHistoryKey(itemKey);
    try {
      await deleteDeliveryHistoryEvent({
        ticketKey,
        eventTimeMs,
        ownerEmail,
      });
      setHistory((items) =>
        items.filter(
          (item) =>
            !(
              String(item?.ticketKey || "") === ticketKey &&
              Number(item?.eventTimeMs || 0) === eventTimeMs
            )
        )
      );
        setHistoryContentByKey((current) => {
          const next = { ...current };
          delete next[itemKey];
          return next;
        });
      setLoadError("");
    } catch (error) {
      setLoadError(error.message || "Unable to delete history item.");
    } finally {
      setDeletingHistoryKey("");
    }
  }, [ownerEmail]);

    const toggleHistoryContent = useCallback(async (event) => {
    const itemKey = `${String(event?.ticketKey || "").trim()}-${Number(event?.eventTimeMs || 0)}`;
      setLoadError("");

      setExpandedHistoryKey((current) => (current === itemKey ? "" : itemKey));

      const existingBody = String(event?.body || historyContentByKey[itemKey]?.body || "").trim();
      if (existingBody || loadingHistoryContentKey === itemKey) {
        return;
      }

      setLoadingHistoryContentKey(itemKey);
      try {
        const content = await fetchSentEmailContent({
          ownerEmail,
          ticketKey: event.ticketKey,
          gmailMessageId: event.gmailMessageId || "",
          recipientEmail: event.recipientEmail || "",
          subject: event.subject || "",
          eventTimeMs: event.eventTimeMs || 0,
        });

        if (!content) {
          return;
        }

        setHistoryContentByKey((current) => ({
          ...current,
          [itemKey]: content,
        }));
        setHistory((items) =>
          items.map((item) => {
            const key = `${String(item?.ticketKey || "").trim()}-${Number(item?.eventTimeMs || 0)}`;
            if (key !== itemKey) {
              return item;
            }

            return {
              ...item,
              body: item.body || content.body || "",
              gmailMessageId: item.gmailMessageId || content.gmailMessageId || null,
              subject: item.subject || content.subject || "",
              recipientEmail: item.recipientEmail || content.recipientEmail || "",
            };
          })
        );
      } catch (error) {
        setLoadError(error.message || "Unable to load sent email content.");
      } finally {
        setLoadingHistoryContentKey("");
      }
  }, [historyContentByKey, loadingHistoryContentKey, ownerEmail]);

  useEffect(() => {
    refresh();
    const intervalId = window.setInterval(refresh, 15000);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  return (
    <div style={S.statusPanel}>
      <div style={S.statusHeader}>
        <div style={S.sectionTitle}>
          <span>{mode === "pending" ? "🗓️" : "📬"}</span>{" "}
          {mode === "pending" ? "Scheduled Mails" : "Sent/Failed Delivery Status"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={{ ...S.btnSecondary, padding: "6px 12px", fontSize: 12 }} onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
      <div style={S.statusMeta}>
        {mode === "pending"
          ? `Pending: ${pendingJobs.length} · Outcomes: ${visibleHistory.length}`
          : `History: ${history.length}`}
        {lastUpdated ? ` · Updated ${formatDateTimeWithAmPm(lastUpdated)}` : ""}
      </div>

      {loadError && <div style={S.sendError}>{loadError}</div>}

      {mode === "pending" && (
        <>
          <div style={{ ...S.replyLabel, marginTop: 12, marginBottom: 8 }}>Pending Jobs</div>
          {pendingJobs.length === 0 ? (
            <div style={S.statusEmpty}>No pending scheduled emails.</div>
          ) : (
            <div style={S.statusList}>
              {pendingJobs.map((job) => (
                <div key={`pending-${job.ticketKey}`} style={{ ...S.statusItem, gridTemplateColumns: "110px minmax(0, 1fr) auto" }}>
                  <span style={{ ...S.statusBadge, ...statusBadgeStyle("pending") }}>Pending</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: C.textPrimary, marginBottom: 2 }}>{job.recipientEmail}</div>
                    <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 2 }}>
                      Scheduled: {formatDateTimeWithAmPm(job.scheduledAtMs)}
                    </div>
                    <div style={{ fontSize: 12, color: C.textMuted }}>Ticket: {job.ticketKey}</div>
                  </div>
                  <button
                    style={{ ...S.btnDanger, padding: "7px 12px", fontSize: 12, whiteSpace: "nowrap" }}
                    onClick={() => handleDeleteJob(job.ticketKey)}
                    disabled={deletingKey === job.ticketKey}
                    title="Delete this scheduled email"
                  >
                    {deletingKey === job.ticketKey ? "Deleting..." : "Delete"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode !== "pending" && (
        <>
          <div style={{ ...S.replyLabel, marginTop: 14, marginBottom: 8 }}>Recent Outcomes</div>
          {history.length === 0 ? (
            <div style={S.statusEmpty}>No sent/failed history yet.</div>
          ) : (
            <div style={S.statusList}>
              {history.map((event, idx) => (
                <div key={`${event.ticketKey}-${event.eventTimeMs || idx}`}>
                  <div
                    style={{ ...S.statusItem, gridTemplateColumns: "120px 150px 1fr minmax(0, 1fr) auto auto" }}
                  >
                    <span style={{ ...S.statusBadge, ...statusBadgeStyle(event.status) }}>{event.status}</span>
                    <span style={{ fontSize: 12, color: C.textSecondary }}>{formatDateTimeWithAmPm(event.eventTimeMs || Date.now())}</span>
                    <span style={{ fontSize: 13, color: C.textPrimary }}>{event.recipientEmail}</span>
                    <span style={{ fontSize: 12, color: C.textMuted, minWidth: 0 }}>{formatDeliveryDetailText(event)}</span>
                    <button
                      style={{ ...S.btnSecondary, padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                      onClick={() => toggleHistoryContent(event)}
                      title="View sent email content"
                    >
                      {loadingHistoryContentKey === `${event.ticketKey}-${event.eventTimeMs || 0}`
                        ? "Loading..."
                        : expandedHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}`
                        ? "Hide mail"
                        : "View mail"}
                    </button>
                    <button
                      style={{ ...S.btnDanger, padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                      onClick={() => handleDeleteHistoryEvent(event)}
                      disabled={deletingHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}`}
                      title="Delete this Sent/Failed history item"
                    >
                      {deletingHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                  {expandedHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}` && (
                    <div style={{ ...S.inboxPreviewPane, marginTop: 6, borderRadius: 8 }}>
                      <div style={S.inboxPreviewTitle}>{event.subject || "(No subject)"}</div>
                      <div style={S.inboxPreviewMeta}>
                        To: {event.recipientEmail || "Unknown"} · {formatDateTimeWithAmPm(event.eventTimeMs || Date.now())}
                      </div>
                      <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                        {String(event.body || historyContentByKey[`${event.ticketKey}-${event.eventTimeMs || 0}`]?.body || "").trim() ||
                          "No saved body is available for this item yet."}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "pending" && (
        <>
          <div style={{ ...S.replyLabel, marginTop: 14, marginBottom: 8 }}>Sent/Failed Outcomes</div>
          {visibleHistory.length === 0 ? (
            <div style={S.statusEmpty}>No sent/failed history yet.</div>
          ) : (
            <div style={S.statusList}>
              {visibleHistory.map((event, idx) => (
                <div key={`${event.ticketKey}-${event.eventTimeMs || idx}`}>
                  <div
                    style={{ ...S.statusItem, gridTemplateColumns: "120px 150px 1fr minmax(0, 1fr) auto auto" }}
                  >
                    <span style={{ ...S.statusBadge, ...statusBadgeStyle(event.status) }}>{event.status}</span>
                    <span style={{ fontSize: 12, color: C.textSecondary }}>{formatDateTimeWithAmPm(event.eventTimeMs || Date.now())}</span>
                    <span style={{ fontSize: 13, color: C.textPrimary }}>{event.recipientEmail}</span>
                    <span style={{ fontSize: 12, color: C.textMuted, minWidth: 0 }}>{formatDeliveryDetailText(event)}</span>
                    <button
                      style={{ ...S.btnSecondary, padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                      onClick={() => toggleHistoryContent(event)}
                      title="View sent email content"
                    >
                      {loadingHistoryContentKey === `${event.ticketKey}-${event.eventTimeMs || 0}`
                        ? "Loading..."
                        : expandedHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}`
                        ? "Hide mail"
                        : "View mail"}
                    </button>
                    <button
                      style={{ ...S.btnDanger, padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                      onClick={() => handleDeleteHistoryEvent(event)}
                      disabled={deletingHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}`}
                      title="Delete this Sent/Failed history item"
                    >
                      {deletingHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                  {expandedHistoryKey === `${event.ticketKey}-${event.eventTimeMs || 0}` && (
                    <div style={{ ...S.inboxPreviewPane, marginTop: 6, borderRadius: 8 }}>
                      <div style={S.inboxPreviewTitle}>{event.subject || "(No subject)"}</div>
                      <div style={S.inboxPreviewMeta}>
                        To: {event.recipientEmail || "Unknown"} · {formatDateTimeWithAmPm(event.eventTimeMs || Date.now())}
                      </div>
                      <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                        {String(event.body || historyContentByKey[`${event.ticketKey}-${event.eventTimeMs || 0}`]?.body || "").trim() ||
                          "No saved body is available for this item yet."}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [gmailFetchCount, setGmailFetchCount] = useState("10");
  const [gmailUnseenOnly, setGmailUnseenOnly] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailOauthConnected, setGmailOauthConnected] = useState(false);
  const [gmailOauthAddress, setGmailOauthAddress] = useState("");
  const [gmailOauthCanModify, setGmailOauthCanModify] = useState(false);
  const [gmailOauthBusy, setGmailOauthBusy] = useState(false);
  const [gmailFetchError, setGmailFetchError] = useState("");
  const [gmailMessages, setGmailMessages] = useState([]);
  const [selectedGmailIds, setSelectedGmailIds] = useState([]);
  const [gmailDeleting, setGmailDeleting] = useState(false);
  const [gmailNextPageToken, setGmailNextPageToken] = useState(null);
  const [activeGmailMessageKey, setActiveGmailMessageKey] = useState("");
  const [gmailSyncingAll, setGmailSyncingAll] = useState(false);
  const [gmailSyncStatus, setGmailSyncStatus] = useState("");
  const [emailText, setEmailText] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [emailCount, setEmailCount] = useState(0);
  const [activeSection, setActiveSection] = useState("email-input");
  const analysisCacheRef = useRef(loadAnalysisCache());
  const autoFetchedInboxKeyRef = useRef("");
  const sectionMenuItems = [
    { id: "api-key", label: "API Key", emoji: "🔑" },
    { id: "delivery-status", label: "Delivery Status", emoji: "📬" },
    { id: "scheduled-mail", label: "Scheduled Mail", emoji: "🗓️" },
    { id: "email-input", label: "Inbox", emoji: "📨" },
    { id: "results", label: "Analysis Results", emoji: "📋" },
  ];

  useEffect(() => {
    if (!isAuthenticated || !currentUserEmail) {
      return;
    }

    const savedApiKey = loadSavedApiKey(currentUserEmail);
    setApiKey(savedApiKey);
    setApiKeyInput(savedApiKey);

    getGmailOAuthStatus(currentUserEmail)
      .then((status) => {
        setGmailOauthConnected(Boolean(status.connected));
        setGmailOauthAddress(status.gmailEmail || "");
        setGmailOauthCanModify(Boolean(status.canModify));
      })
      .catch(() => {
        setGmailOauthConnected(false);
        setGmailOauthAddress("");
        setGmailOauthCanModify(false);
      });

    autoFetchedInboxKeyRef.current = "";
  }, [isAuthenticated, currentUserEmail]);

  const handleConnectGmailOAuth = useCallback(async () => {
    if (!currentUserEmail) {
      setGmailFetchError("Sign in first to connect Gmail.");
      return;
    }

    setGmailOauthBusy(true);
    setGmailFetchError("");
    try {
      const authUrl = await startGmailOAuth(currentUserEmail, currentUserEmail);
      window.open(authUrl, "_blank", "noopener,noreferrer");
      setGmailFetchError("Google consent window opened. Complete it, then click Refresh Gmail Status.");
    } catch (err) {
      setGmailFetchError(err.message || "Unable to start Gmail OAuth.");
    } finally {
      setGmailOauthBusy(false);
    }
  }, [currentUserEmail]);

  const handleRefreshGmailOAuth = useCallback(async () => {
    if (!currentUserEmail) {
      return;
    }

    setGmailOauthBusy(true);
    try {
      const status = await getGmailOAuthStatus(currentUserEmail);
      setGmailOauthConnected(Boolean(status.connected));
      setGmailOauthAddress(status.gmailEmail || "");
      setGmailOauthCanModify(Boolean(status.canModify));
      if (status.connected) {
        setGmailFetchError("");
      }
    } catch (err) {
      setGmailFetchError(err.message || "Unable to refresh Gmail OAuth status.");
    } finally {
      setGmailOauthBusy(false);
    }
  }, [currentUserEmail]);

  const handleDisconnectGmailOAuth = useCallback(async () => {
    if (!currentUserEmail) {
      return;
    }

    setGmailOauthBusy(true);
    try {
      await disconnectGmailOAuth(currentUserEmail);
      setGmailOauthConnected(false);
      setGmailOauthAddress("");
      setGmailOauthCanModify(false);
      setGmailMessages([]);
      setSelectedGmailIds([]);
      setGmailNextPageToken(null);
      setActiveGmailMessageKey("");
      autoFetchedInboxKeyRef.current = "";
    } catch (err) {
      setGmailFetchError(err.message || "Unable to disconnect Gmail OAuth.");
    } finally {
      setGmailOauthBusy(false);
    }
  }, [currentUserEmail]);

  const handleFetchFromGmail = useCallback(async () => {
    if (!gmailOauthConnected) {
      setGmailFetchError("Please connect Gmail OAuth first, then click Fetch Gmail.");
      return;
    }

    const safeCount = 10;

    setGmailLoading(true);
    setGmailFetchError("");

    try {
      const result = await fetchGmailMessages({
        maxCount: safeCount,
        unseenOnly: gmailUnseenOnly,
        ownerEmail: currentUserEmail,
        gmailEmail: gmailOauthAddress,
        pageToken: null,
      });

      const messages = result.messages;

      if (!messages.length) {
        setGmailMessages([]);
        setSelectedGmailIds([]);
        setGmailNextPageToken(null);
        setGmailFetchError("No matching emails found in Gmail inbox.");
        return;
      }

      const allKeys = messages.map((msg, idx) => getFetchedMessageKey(msg, idx));

      setGmailMessages(messages);
      setSelectedGmailIds((prev) => {
        const nextSet = new Set(allKeys);
        return prev.filter((id) => nextSet.has(id));
      });
      setGmailNextPageToken(result.nextPageToken || null);
      setActiveGmailMessageKey((prev) => (allKeys.includes(prev) ? prev : (allKeys[0] || "")));
    } catch (err) {
      setGmailFetchError(err.message || "Unable to fetch Gmail messages.");
    } finally {
      setGmailLoading(false);
    }
  }, [gmailUnseenOnly, gmailOauthConnected, currentUserEmail, gmailOauthAddress]);

  useEffect(() => {
    if (!gmailOauthConnected || !currentUserEmail) {
      return;
    }

    const autoFetchKey = `${currentUserEmail}|${gmailFetchCount}|${gmailUnseenOnly}`;
    if (autoFetchedInboxKeyRef.current === autoFetchKey) {
      return;
    }

    autoFetchedInboxKeyRef.current = autoFetchKey;
    void handleFetchFromGmail();
  }, [gmailOauthConnected, currentUserEmail, gmailFetchCount, gmailUnseenOnly, handleFetchFromGmail]);

  useEffect(() => {
    if (!gmailOauthConnected || !currentUserEmail) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void handleFetchFromGmail();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [gmailOauthConnected, currentUserEmail, handleFetchFromGmail]);

  const handleToggleFetchedMessage = useCallback((messageKey) => {
    setSelectedGmailIds((prev) => {
      if (prev.includes(messageKey)) {
        return prev.filter((id) => id !== messageKey);
      }
      return [...prev, messageKey];
    });
  }, []);

  const handleSelectAllFetchedMessages = useCallback(() => {
    setSelectedGmailIds(gmailMessages.map((msg, idx) => getFetchedMessageKey(msg, idx)));
  }, [gmailMessages]);

  const handleClearFetchedSelection = useCallback(() => {
    setSelectedGmailIds([]);
  }, []);

  const handleUseSelectedFetchedMessages = useCallback(() => {
    const selectedSet = new Set(selectedGmailIds);
    const selectedMessages = gmailMessages.filter((msg, idx) =>
      selectedSet.has(getFetchedMessageKey(msg, idx))
    );

    if (!selectedMessages.length) {
      setGmailFetchError("Select at least one fetched email to load into analysis.");
      return;
    }

    setGmailFetchError("");
    setEmailText(formatFetchedMessagesForAnalysis(selectedMessages));
    setResults([]);
    setError("");
  }, [gmailMessages, selectedGmailIds]);

  const handleTrashSelectedMessages = useCallback(async () => {
    if (gmailDeleting) {
      return;
    }

    if (!gmailOauthCanModify) {
      setGmailFetchError(
        "Inbox delete needs Gmail modify permission. Disconnect Gmail OAuth, reconnect, approve access, then click Refresh Gmail Status."
      );
      return;
    }

    const selectedSet = new Set(selectedGmailIds);
    const selectedMessages = gmailMessages.filter((msg, idx) =>
      selectedSet.has(getFetchedMessageKey(msg, idx))
    );

    const messageIds = selectedMessages
      .map((msg) => String(msg?.uid || "").trim())
      .filter(Boolean);

    if (!messageIds.length) {
      setGmailFetchError("Select at least one inbox email, then click the trash button.");
      return;
    }

    if (!window.confirm(`Move ${messageIds.length} selected email(s) to Trash?`)) {
      return;
    }

    setGmailDeleting(true);
    setGmailFetchError("");
    try {
      await trashGmailMessages({
        ownerEmail: currentUserEmail,
        gmailEmail: gmailOauthAddress,
        messageIds,
      });

      const removed = new Set(messageIds);
      setGmailMessages((prev) => prev.filter((msg) => !removed.has(String(msg?.uid || "").trim())));
      setSelectedGmailIds((prev) => prev.filter((id) => !removed.has(id)));
      setGmailFetchError(`${messageIds.length} email(s) moved to Trash.`);
    } catch (err) {
      setGmailFetchError(err.message || "Unable to delete Gmail messages.");
    } finally {
      setGmailDeleting(false);
    }
  }, [
    gmailDeleting,
    gmailOauthCanModify,
    selectedGmailIds,
    gmailMessages,
    currentUserEmail,
    gmailOauthAddress,
  ]);

  useEffect(() => {
    if (!gmailMessages.length) {
      setActiveGmailMessageKey("");
      return;
    }

    const hasActive = gmailMessages.some((msg, idx) => getFetchedMessageKey(msg, idx) === activeGmailMessageKey);
    if (!hasActive) {
      setActiveGmailMessageKey(getFetchedMessageKey(gmailMessages[0], 0));
    }
  }, [gmailMessages, activeGmailMessageKey]);

  const selectedGmailMessages = useMemo(() => {
    const selectedSet = new Set(selectedGmailIds);
    return gmailMessages.filter((msg, idx) => selectedSet.has(getFetchedMessageKey(msg, idx)));
  }, [gmailMessages, selectedGmailIds]);

  useEffect(() => {
    if (!selectedGmailMessages.length) {
      setActiveGmailMessageKey("");
      setEmailText("");
      return;
    }

    const selectedSet = new Set(selectedGmailIds);
    const activeIsSelected = selectedSet.has(activeGmailMessageKey);

    if (!activeIsSelected) {
      setActiveGmailMessageKey(selectedGmailIds[0] || "");
    }

    setEmailText(formatFetchedMessagesForAnalysis(selectedGmailMessages));
  }, [selectedGmailMessages, selectedGmailIds, activeGmailMessageKey]);

  const activeGmailMessage = gmailMessages.find(
    (msg, idx) => getFetchedMessageKey(msg, idx) === activeGmailMessageKey
  ) || selectedGmailMessages[0] || null;

  const handleLoadMoreFromGmail = useCallback(async () => {
    if (!gmailNextPageToken || gmailLoading) {
      return;
    }

    setGmailLoading(true);
    setGmailFetchError("");

    try {
      const count = Number(gmailFetchCount);
      const safeCount = Number.isFinite(count) ? Math.min(Math.max(count, 1), 100) : 20;

      const result = await fetchGmailMessages({
        maxCount: safeCount,
        unseenOnly: gmailUnseenOnly,
        ownerEmail: currentUserEmail,
        gmailEmail: gmailOauthAddress,
        pageToken: gmailNextPageToken,
      });

      const nextBatch = result.messages;
      if (!nextBatch.length) {
        setGmailNextPageToken(null);
        return;
      }

      setGmailMessages((prev) => mergeFetchedMessages(prev, nextBatch));

      setSelectedGmailIds((prev) => {
        const prevSet = new Set(prev);
        const added = nextBatch.map((msg, idx) => getFetchedMessageKey(msg, idx)).filter((id) => !prevSet.has(id));
        return [...prev, ...added];
      });

      setGmailNextPageToken(result.nextPageToken || null);
    } catch (err) {
      setGmailFetchError(err.message || "Unable to load more Gmail messages.");
    } finally {
      setGmailLoading(false);
    }
  }, [gmailNextPageToken, gmailLoading, gmailFetchCount, gmailUnseenOnly, currentUserEmail, gmailOauthAddress]);

  const handleSyncFullInbox = useCallback(async () => {
    if (!gmailOauthConnected || gmailSyncingAll) {
      return;
    }

    setGmailSyncingAll(true);
    setGmailFetchError("");

    try {
      const count = Number(gmailFetchCount);
      const safeCount = Number.isFinite(count) ? Math.min(Math.max(count, 1), 100) : 50;

      let aggregate = [...gmailMessages];
      let token = gmailNextPageToken;

      if (!aggregate.length) {
        setGmailSyncStatus("Loading first page...");
        const first = await fetchGmailMessages({
          maxCount: safeCount,
          unseenOnly: gmailUnseenOnly,
          ownerEmail: currentUserEmail,
          gmailEmail: gmailOauthAddress,
          pageToken: null,
        });

        aggregate = mergeFetchedMessages([], first.messages);
        token = first.nextPageToken || null;
        setGmailMessages(aggregate);
        setSelectedGmailIds([]);
        setGmailNextPageToken(token);
      }

      while (token) {
        setGmailSyncStatus(`Loading more inbox emails... currently ${aggregate.length} loaded`);
        const page = await fetchGmailMessages({
          maxCount: safeCount,
          unseenOnly: gmailUnseenOnly,
          ownerEmail: currentUserEmail,
          gmailEmail: gmailOauthAddress,
          pageToken: token,
        });

        aggregate = mergeFetchedMessages(aggregate, page.messages);
        token = page.nextPageToken || null;

        setGmailMessages(aggregate);
        setSelectedGmailIds((prev) => {
          const prevSet = new Set(prev);
          const nextIds = aggregate
            .map((msg, idx) => getFetchedMessageKey(msg, idx))
            .filter((id) => !prevSet.has(id));
          return [...prev, ...nextIds];
        });
        setGmailNextPageToken(token);
      }

      setGmailSyncStatus(`Inbox synced: ${aggregate.length} emails loaded`);
    } catch (err) {
      setGmailFetchError(err.message || "Unable to sync full inbox.");
      setGmailSyncStatus("");
    } finally {
      setGmailSyncingAll(false);
    }
  }, [gmailOauthConnected, gmailSyncingAll, gmailFetchCount, gmailUnseenOnly, currentUserEmail, gmailOauthAddress, gmailMessages, gmailNextPageToken]);

  const handleSaveKey = () => {
    const nextKey = apiKeyInput.trim();
    if (!nextKey) {
      setError("Please enter a Groq API key.");
      return;
    }
    setApiKey(nextKey);
    if (currentUserEmail) {
      saveApiKey(currentUserEmail, nextKey);
    }
    setError("");
  };

  const parseEmails = (text) =>
    text
      .split(/\n---\n|^---$/m)
      .map((e) => e.trim())
      .filter(Boolean);

  const buildCacheKey = (emails) => emails.join("\n---\n");

  // Sanitize email text by removing zero-width and invisible Unicode characters
  function sanitizeEmail(text) {
    if (!text) return text;
    // Remove zero-width characters, zero-width joiner, zero-width non-joiner, soft hyphen, etc.
    return text
      .replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, "") // Zero-width characters
      .replace(/[\u061C\u180E\u2066-\u2069]/g, "") // Invisible formatting
      .trim();
  }

  const analyzeEmails = useCallback(async () => {
    setError("");
    const emails = parseEmails(emailText).map(sanitizeEmail);
    if (!emails.length) {
      setError("Please paste at least one email before analyzing.");
      return;
    }
    setLoading(true);
    setEmailCount(emails.length);
    setResults([]);

    const cacheKey = buildCacheKey(emails);
    const cached = analysisCacheRef.current.get(cacheKey);
    if (cached) {
      setResults(cached);
      setActiveSection("results");
      setLoading(false);
      return;
    }

    const emailsFormatted = emails
      .map((e, i) => `EMAIL ${i + 1}:\n${e}`)
      .join("\n\n---\n\n");

    const systemPrompt = `You are an expert Customer Experience (CX) AI agent. Analyze each customer email thoroughly and return a JSON array — nothing else.

Rules:
- Be conservative with churn risk. Only mark "High" if there are explicit signals: "cancelling", "switching", "last time", "never again", "disputing", "competitor".
- Mark escalate: true if sentiment is "Furious", churn_risk is "High", or email mentions legal action, repeated contact, refund disputes, or billing fraud.
- Draft replies must be warm, professional, empathetic, and never reveal they are AI-generated. Sign off as "Customer Support Team".
- Extract customer name if mentioned, otherwise use "Unknown".
- Return ONLY a valid JSON array. No markdown. No code fences. No explanation.

Each object in the array must have exactly these fields:
{
  "id": number (1-indexed),
  "original_email": "the original text verbatim",
  "customer_name": "extracted name or Unknown",
  "sentiment": "Positive | Neutral | Negative | Furious",
  "category": "Billing | Delivery | Product | Refund | Technical | General",
  "urgency": "Low | Medium | High | Critical",
  "churn_risk": "Low | Medium | High",
  "churn_reason": "one-line explanation of churn signal or why risk is low",
  "escalate": true or false,
  "escalation_reason": "reason string or empty string",
  "draft_reply": "full ready-to-send professional email reply",
  "reply_tone": "Empathetic | Formal | Apologetic | Informative"
}`;

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 4096,
          temperature: 0,
          top_p: 1,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: `Analyze these ${emails.length} customer emails:\n\n${emailsFormatted}`,
            },
          ],
        }),
      });

      if (response.status === 429) {
        setError(
          "Rate limited by Groq API. Please wait a moment and try again."
        );
        setLoading(false);
        return;
      }
      if (response.status === 401) {
        setError(
          "Invalid API key. Please check your Groq API key and try again."
        );
        setLoading(false);
        return;
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        setError(`API error: ${err?.error?.message || response.statusText}`);
        setLoading(false);
        return;
      }

      const data = await response.json();
      const rawText = data.choices?.[0]?.message?.content || "";

      // Strip any accidental markdown fences
      let cleaned = rawText
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      // Try to extract JSON array from response
      // Handle cases where model adds explanation text before/after JSON
      const arrayStart = cleaned.indexOf('[');
      const arrayEnd = cleaned.lastIndexOf(']');
      
      if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
        cleaned = cleaned.substring(arrayStart, arrayEnd + 1);
      }

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) parsed = [parsed];
      } catch (parseErr) {
        console.error("Parse error:", parseErr.message);
        console.error("Raw response:", rawText);
        console.error("Cleaned response:", cleaned);
        console.error("First 500 chars:", cleaned.substring(0, 500));
        
        setError(
          `The AI returned an unexpected format. Response preview: "${cleaned.substring(0, 100)}...". Please check console for details.`
        );
        setLoading(false);
        return;
      }

      setResults(parsed);
      setActiveSection("results");
      analysisCacheRef.current.set(cacheKey, parsed);
      saveAnalysisCache(analysisCacheRef.current);
    } catch (err) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [apiKey, emailText]);

  if (!isAuthenticated) {
    return (
      <>
        <style>{`
          html, body, #root { margin: 0; min-height: 100%; overflow: hidden; }
        `}</style>
        <LoginPage
          onLogin={(email) => {
            setCurrentUserEmail(email);
            setIsAuthenticated(true);
          }}
        />
      </>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: radial-gradient(circle at 12% 8%, rgba(34,211,238,0.16) 0%, rgba(34,211,238,0) 34%), radial-gradient(circle at 88% 0%, rgba(56,189,248,0.14) 0%, rgba(56,189,248,0) 32%), linear-gradient(150deg, #091323 0%, #102238 58%, #0f1f34 100%);
          color: ${C.textPrimary};
        }
        @keyframes progress-anim {
          0% { transform: translateX(-100%); width: 60%; }
          50% { width: 80%; }
          100% { transform: translateX(200%); width: 60%; }
        }
        @keyframes card-rise {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.border}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb { background: ${C.textMuted}; border-radius: 3px; }

        @media (max-width: 960px) {
          .dashboard-frame { padding: 12px !important; }
          .workspace-layout { grid-template-columns: 1fr !important; }
          .side-menu {
            position: static !important;
            top: auto !important;
          }
          .side-menu-list {
            flex-direction: row !important;
            flex-wrap: wrap !important;
          }
          .side-menu-button {
            flex: 1 1 220px;
          }
          .email-card-body { grid-template-columns: 1fr !important; }
          .email-card-left {
            border-right: none !important;
            border-bottom: 1px solid ${C.border} !important;
          }
          .gmail-grid { grid-template-columns: 1fr 1fr !important; }
        }

        @media (max-width: 640px) {
          .stats-row { grid-template-columns: 1fr !important; }
          .gmail-grid { grid-template-columns: 1fr !important; }
          .side-menu-list { flex-direction: column !important; }
          .side-menu-button { flex: 1 1 auto; }
        }
      `}</style>

      <div style={S.app} className="dashboard-wrap">
        {/* Header */}
        <header style={S.header}>
          <div style={S.headerLeft}>
            <img src={appLogo} alt="App logo" style={S.headerIcon} />
            <span style={S.headerLogo}>Mail Assistant</span>
            {/* <span style={S.headerBadge}>Ops Desk</span> */}
            {currentUserEmail && (
              <span
                style={{
                  color: "#d8f4ef",
                  fontSize: 12,
                  padding: "2px 8px",
                  border: "1px solid rgba(216,244,239,0.45)",
                  borderRadius: 999,
                }}
              >
                {currentUserEmail}
              </span>
            )}
          </div>
          <div style={S.headerRight}>
            <button
              style={{ ...S.btnSecondary, fontSize: 12, padding: "6px 12px" }}
              onClick={() => {
                setIsAuthenticated(false);
                setCurrentUserEmail("");
              }}
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main style={S.main}>
          <div style={S.dashboardFrame} className="dashboard-frame">
            <div style={S.workspaceLayout} className="workspace-layout">
              <aside style={S.sideMenu} className="side-menu">
                <div style={S.sideMenuTitle}>Main Menu</div>
                <div style={S.sideMenuList} className="side-menu-list">
                  {sectionMenuItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="side-menu-button"
                      style={{
                        ...S.menuButton,
                        ...(activeSection === item.id ? S.menuButtonActive : {}),
                      }}
                      onClick={() => setActiveSection(item.id)}
                    >
                      <span>{item.emoji}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <div style={S.contentPanel}>
                {activeSection === "api-key" && (
            <div style={S.apiPanel}>
            <div style={{ ...S.sectionTitle, marginBottom: 10 }}>
              <span>🔑</span> Groq API Key
            </div>
            <div style={{ ...S.sectionSub, marginBottom: 12 }}>
              Enter your key once and it will be remembered for this account on this browser.
            </div>
            <div style={S.apiPanelRow}>
              <input
                style={{ ...S.input, flex: "1 1 320px" }}
                type="password"
                placeholder="gsk_..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
              />
              <button style={S.btnPrimary} onClick={handleSaveKey}>
                Save Key
              </button>
              {apiKey && (
                <button
                  style={S.btnSecondary}
                  onClick={() => {
                    setApiKey("");
                    setApiKeyInput("");
                    setResults([]);
                    clearSavedApiKey(currentUserEmail);
                  }}
                >
                  Clear Key
                </button>
              )}
              <span style={S.apiStatus}>{apiKey ? "Key saved" : "No key saved"}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted }}>
              Need a key?{" "}
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
                console.groq.com/keys
              </a>
            </div>
          </div>
                )}

                {activeSection === "delivery-status" && (
                  <DeliveryStatusPanel ownerEmail={currentUserEmail} mode="all" />
                )}

                {activeSection === "scheduled-mail" && (
                  <DeliveryStatusPanel ownerEmail={currentUserEmail} mode="pending" />
                )}

          {/* Error Banner */}
          {error && (
            <div style={S.errorBanner}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <span>{error}</span>
              <button
                style={{
                  marginLeft: "auto",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#b91c1c",
                  fontSize: 16,
                }}
                onClick={() => setError("")}
              >
                ✕
              </button>
            </div>
          )}

          {activeSection === "email-input" && (
          <>
          {/* Input Panel */}
          <div style={S.section}>
            <div style={S.sectionTitle}>
              <span>📨</span> Customer Emails Input
            </div>
            {/* <div style={S.sectionSub}>
              Paste one or multiple customer complaint emails below. Separate
              multiple emails with{" "}
              <code
                style={{
                  background: C.border,
                  padding: "1px 5px",
                  borderRadius: 4,
                  fontFamily: fontMono,
                  fontSize: 12,
                }}
              >
                ---
              </code>{" "}
              on its own line.
            </div> */}
            <div style={S.gmailCardsStack}>
              <div style={S.gmailFetchCard}>
                <div style={S.gmailCardHeader}>
                  <span>📥</span> Gmail Connection and Fetch
                </div>
                <div style={{ ...S.gmailPanel, marginBottom: 0 }}>
                  <div style={{ ...S.apiPanelRow, marginBottom: 8 }}>
                <button
                  style={S.btnSecondary}
                  onClick={handleConnectGmailOAuth}
                  disabled={gmailOauthBusy}
                >
                  {gmailOauthBusy ? "Connecting..." : "Connect Gmail OAuth"}
                </button>
                <button
                  style={S.btnSecondary}
                  onClick={handleRefreshGmailOAuth}
                  disabled={gmailOauthBusy}
                >
                  Refresh Gmail Status
                </button>
                {gmailOauthConnected && (
                  <button
                    style={S.btnDanger}
                    onClick={handleDisconnectGmailOAuth}
                    disabled={gmailOauthBusy}
                  >
                    Disconnect Gmail
                  </button>
                )}
                <span style={S.apiStatus}>
                  {gmailOauthConnected
                    ? `OAuth connected${gmailOauthAddress ? `: ${gmailOauthAddress}` : ""}`
                    : "OAuth not connected"}
                </span>
                  </div>
                  <div style={S.gmailGrid} className="gmail-grid">
                <div style={{ ...S.input, display: "flex", alignItems: "center", color: C.textPrimary, fontWeight: 600 }}>
                  {gmailOauthConnected
                    ? `Connected account: ${gmailOauthAddress || currentUserEmail}`
                    : `Connected account will appear here after OAuth`}
                </div>
                <div style={{ ...S.input, display: "flex", alignItems: "center", color: C.textMuted }}>
                  OAuth mode only (no App Password)
                </div>
                <input
                  style={S.input}
                  value="Latest 10 emails"
                  readOnly
                />
                <button
                  style={{ ...S.btnSecondary, justifyContent: "center" }}
                  onClick={handleFetchFromGmail}
                  disabled={gmailLoading || !gmailOauthConnected || !gmailOauthAddress && !currentUserEmail}
                >
                  {gmailLoading ? "Refreshing..." : "Refresh Inbox"}
                </button>
                  </div>
                  <div style={{ ...S.gmailHint, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={gmailUnseenOnly}
                    onChange={(e) => setGmailUnseenOnly(e.target.checked)}
                  />
                  Unread only
                </label>
                <span>
                  {gmailOauthConnected
                    ? gmailOauthCanModify
                      ? "OAuth active: fetch and inbox delete are enabled for your connected account."
                      : "OAuth active for fetch, but inbox delete is blocked. Reconnect Gmail OAuth to grant mailbox modify permission."
                    : "Connect Gmail OAuth first. App Password fetch is disabled in this mode."}
                </span>
                  </div>
                </div>
              </div>

              <div style={S.gmailInboxCard}>
                <div style={S.gmailCardHeader}>
                  <span>📬</span> Inbox Selection and Preview
                </div>
                <div style={S.gmailListHeader}>
                <button
                  style={{ ...S.btnSecondary, padding: "6px 12px", fontSize: 12 }}
                  onClick={handleSelectAllFetchedMessages}
                  type="button"
                  disabled={gmailMessages.length === 0}
                >
                  Select all
                </button>
                <button
                  style={{ ...S.btnSecondary, padding: "6px 12px", fontSize: 12 }}
                  onClick={handleClearFetchedSelection}
                  type="button"
                  disabled={gmailMessages.length === 0}
                >
                  Clear selection
                </button>
                <button
                  style={{ ...S.btnPrimary, padding: "6px 12px", fontSize: 12 }}
                  onClick={handleUseSelectedFetchedMessages}
                  type="button"
                  disabled={gmailMessages.length === 0}
                >
                  Use selected for analysis
                </button>
                <span style={S.gmailListMeta}>
                  Loaded: {gmailMessages.length} · Selected: {selectedGmailIds.length}
                </span>
                </div>

                {gmailMessages.length === 0 ? (
                  <div style={{ ...S.statusEmpty, marginTop: 10 }}>
                    No emails loaded yet. Click Refresh Inbox in the card above.
                  </div>
                ) : (
                  <>
                    <div style={S.inboxShell}>
                    <div style={S.inboxToolbar}>
                      <span style={{ fontSize: 12, color: C.textMuted }}>
                        All Mails
                      </span>
                      <div style={S.inboxToolbarActions}>
                        <button
                          type="button"
                          style={{
                            ...S.inboxIconButton,
                            opacity: gmailDeleting || selectedGmailIds.length === 0 || !gmailOauthCanModify ? 0.72 : 1,
                            cursor:
                              gmailDeleting || selectedGmailIds.length === 0 || !gmailOauthCanModify
                                ? "not-allowed"
                                : "pointer",
                          }}
                          onClick={handleTrashSelectedMessages}
                          disabled={gmailDeleting || selectedGmailIds.length === 0 || !gmailOauthCanModify}
                          title={
                            !gmailOauthCanModify
                              ? "Reconnect Gmail OAuth with mailbox modify permission to enable delete"
                              : selectedGmailIds.length === 0
                              ? "Select inbox emails to delete"
                              : `Move ${selectedGmailIds.length} selected email(s) to Trash`
                          }
                          aria-label="Move selected emails to Trash"
                        >
                          🗑
                        </button>
                      </div>
                    </div>

                    <div style={S.inboxHeaderRow}>
                      <span>Select</span>
                      <span>☆</span>
                      <span>From</span>
                      <span>Subject and snippet</span>
                      <span style={{ textAlign: "right" }}>Date</span>
                    </div>

                    <div style={S.inboxRows}>
                      {gmailMessages.map((msg, idx) => {
                        const messageKey = getFetchedMessageKey(msg, idx);
                        const checked = selectedGmailIds.includes(messageKey);
                        const isActive = activeGmailMessageKey === messageKey;
                        const preview = normalizeEmailBody(msg.text).replace(/\s+/g, " ").trim();
                        return (
                          <div
                            key={messageKey}
                            style={{
                              ...S.inboxRow,
                              ...(checked ? S.inboxRowSelected : {}),
                              ...(isActive ? S.inboxRowActive : {}),
                            }}
                            onClick={() => setActiveGmailMessageKey(messageKey)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setActiveGmailMessageKey(messageKey);
                              }
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleFetchedMessage(messageKey)}
                              onClick={(event) => event.stopPropagation()}
                            />
                            <span style={S.inboxStar}>☆</span>
                            <div style={S.inboxSender}>{msg.from || "Unknown sender"}</div>
                            <div style={S.inboxSubjectLine}>
                              {msg.subject || "(No subject)"}
                              <span style={S.inboxSnippet}> - {preview || "(No preview text available)"}</span>
                            </div>
                            <div style={S.inboxDate}>{formatDateTimeWithAmPm(msg.date || Date.now())}</div>
                          </div>
                        );
                      })}
                    </div>

                    {selectedGmailIds.length > 0 && activeGmailMessage && (
                      <div style={S.inboxPreviewPane}>
                        <div style={S.inboxPreviewTitle}>{activeGmailMessage.subject || "(No subject)"}</div>
                        <div style={S.inboxPreviewMeta}>
                          From: {activeGmailMessage.from || "Unknown sender"} · {formatDateTimeWithAmPm(activeGmailMessage.date || Date.now())}
                        </div>
                        <div style={S.inboxPreviewBody}>
                          {(normalizeEmailBody(activeGmailMessage.text) || "(No plain-text body found)").trim()}
                        </div>
                      </div>
                    )}
                    </div>

                    <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 12, color: C.textMuted }}>Showing the latest 10 emails only</span>
                    </div>
                  </>
                )}
              </div>

              {gmailFetchError && <div style={S.sendError}>{gmailFetchError}</div>}
            </div>
            <textarea
              style={S.textarea}
              placeholder={`Paste customer email here...\n\n---\n\nPaste another email here...`}
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              onFocus={(e) =>
                (e.target.style.borderColor = C.indigo)
              }
              onBlur={(e) =>
                (e.target.style.borderColor = C.border)
              }
              disabled={loading}
            />
            <div style={S.row}>
              <button
                style={{
                  ...S.btnPrimary,
                  opacity: loading ? 0.6 : 1,
                  fontSize: 15,
                  padding: "12px 28px",
                }}
                onClick={analyzeEmails}
                disabled={loading || !apiKey}
              >
                {loading ? "⏳ Analyzing..." : "🔍 Analyze Emails"}
              </button>
              {emailText && !loading && (
                <button
                  style={{
                    ...S.btnSecondary,
                    color: C.textMuted,
                  }}
                  onClick={() => {
                    setEmailText("");
                    setResults([]);
                    setError("");
                  }}
                >
                  🗑️ Clear
                </button>
              )}
              <span
                style={{
                  fontSize: 13,
                  color: C.textMuted,
                  marginLeft: "auto",
                }}
              >
                {parseEmails(emailText).length > 0 &&
                  `${parseEmails(emailText).length} email(s) detected`}
              </span>
            </div>
          </div>
          </>
          )}

          {activeSection === "results" && (
          <>
          {/* Loading State */}
          {loading && (
            <div style={S.progressWrap}>
              <div style={S.progressLabel}>
                <span
                  style={{
                    display: "inline-block",
                    animation: "spin 1s linear infinite",
                  }}
                >
                  ⚙️
                </span>
                Agent is analyzing {emailCount} email
                {emailCount !== 1 ? "s" : ""}...
              </div>
              <div style={S.progressBar}>
                <div style={S.progressFill} />
              </div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                Classifying sentiment · Assessing churn risk · Drafting
                replies · Checking escalation triggers
              </div>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <>
              <StatsStrip results={results} />

              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: C.textPrimary,
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                📋 Analysis Results
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.textMuted,
                    background: C.border,
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  {results.length} tickets
                </span>
              </div>

              {results.map((r, i) => (
                <EmailCard
                  key={r.id || i}
                  data={r}
                  index={i}
                  ownerEmail={currentUserEmail}
                />
              ))}
            </>
          )}

          {/* Empty state */}
          {!loading && results.length === 0 && !error && (
            <div
              style={{
                textAlign: "center",
                padding: "48px 24px",
                color: C.textMuted,
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 14 }}>📭</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.textSecondary, marginBottom: 8 }}>
                No emails analyzed yet
              </div>
              <div style={{ fontSize: 14 }}>
                Paste customer emails above or click "Load Demo Emails" to get
                started.
              </div>
            </div>
          )}
          </>
          )}
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer style={S.footer}>
          <div style={{ marginBottom: 4 }}>
            🛡️{" "}
            <strong>
              All replies are AI-drafted and must be reviewed by a human before
              sending.
            </strong>{" "}
            This tool does not store or log any customer email content.
          </div>
          <div>
            Customer Response Copilot · Powered by Groq · For
            internal use only
          </div>
        </footer>
      </div>
    </>
  );
}
