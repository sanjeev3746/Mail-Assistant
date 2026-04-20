# 🤖 Customer Response Copilot

An AI-powered CX agent that processes customer complaint emails, classifies them, detects churn risk, drafts professional replies, and flags escalations — powered by Groq.

---

## ✨ Features

- **Login Screen** — Simple sign-in gate before dashboard access
- **AI Classification** — Sentiment, category, urgency per email
- **Churn Risk Detection** — Conservative, signal-based churn scoring
- **Escalation Flags** — Auto-detects furious customers, legal mentions, repeated contacts
- **Draft Replies** — Professional, warm replies ready to send (human review required)
- **Summary Dashboard** — Stats strip with key metrics across all emails
- **Batch Processing** — Analyze multiple emails at once (separated by `---`)
- **Automatic Scheduled Send** — Send drafted emails automatically at a specific time without manual send click
- **Direct Gmail Fetch** — Pull recent inbox emails directly into the analyzer (no copy/paste)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- A [Groq API key](https://console.groq.com/keys)

### Installation

```bash
# 0. Configure environment
# Copy .env.example to .env and fill your values.
# Backend now auto-loads .env via dotenv.
# Example frontend keys:
# VITE_FIREBASE_API_KEY=your_firebase_api_key
# VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
# VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
# VITE_FIREBASE_APP_ID=your_firebase_app_id

# 1. Install dependencies
npm install

# 2. Configure scheduler/OAuth vars in .env for automatic sending
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=465
# SMTP_USER=your_gmail_address@gmail.com
# SMTP_PASS=your_gmail_app_password
# SMTP_FROM="CX Copilot <your_gmail_address@gmail.com>"
# SCHEDULER_PORT=3001
# GOOGLE_OAUTH_CLIENT_ID=...
# GOOGLE_OAUTH_CLIENT_SECRET=...
# GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3001/api/gmail/oauth/callback
# FRONTEND_BASE_URL=http://localhost:3000

# 3. Start frontend + scheduler
npm run dev:full

# 4. Open http://localhost:3000
```

For Gmail accounts, generate a Google App Password and use it as `SMTP_PASS`.

### Usage

1. Sign in on the login page
2. Enter your Groq API key in the dashboard API key panel
3. Optional: fetch directly from Gmail using your Gmail address + App Password
4. Paste customer emails (separated by `---`) or use fetched Gmail content
5. Click "Analyze Emails"
6. Review AI-generated classifications and draft replies
7. Copy replies and send after human review

### Gmail Direct Fetch Setup

- Enable IMAP in your Gmail settings.
- Create a Google App Password for your Gmail account.
- In the app, use:
	- Gmail address (e.g. `your@gmail.com`)
	- App Password (not your normal Gmail password)
	- Fetch count and unread filter options

### Gmail OAuth Fetch Setup (No App Password)

- Create OAuth credentials in Google Cloud Console.
- Add these env vars for the backend:
	- `GOOGLE_OAUTH_CLIENT_ID`
	- `GOOGLE_OAUTH_CLIENT_SECRET`
	- `GOOGLE_OAUTH_REDIRECT_URI` (e.g. `http://localhost:3001/api/gmail/oauth/callback`)
	- `FRONTEND_BASE_URL` (e.g. `http://localhost:3000`)
- In Google OAuth consent/scopes, include Gmail read scope.
- In the app, click **Connect Gmail OAuth** and complete Google consent.

---

## 📁 Project Structure

```
customer-response-copilot/
├── index.html          # HTML entry point
├── vite.config.js      # Vite config
├── package.json        # Dependencies
├── README.md           # This file
├── main.jsx           # React mount
├── App.jsx            # Main app logic & UI
└── server/
	└── index.js       # Scheduled email backend (SMTP + queue)
```

---

## 🔐 Security Notes

- API key is stored **only in React state** (memory) — never in localStorage or cookies
- No customer email data is stored or logged
- All API calls go directly to `api.groq.com`

---

## ⚠️ Disclaimer

All AI-drafted replies **must be reviewed by a human** before sending. This tool is for internal CX team use only.

---

## 🛠️ Tech Stack

- React 18 (functional components + hooks)
- Vite (build tool)
- JavaScript inline styles (no CSS framework)
- Groq API (`llama-3.3-70b-versatile`)
- IBM Plex Sans / IBM Plex Mono (Google Fonts)

---

## 📦 Build for Production

```bash
npm run build
# Output in /dist folder
```
