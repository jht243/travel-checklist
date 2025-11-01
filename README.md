# Mortgage Calculator - ChatGPT MCP Connector

A Model Context Protocol (MCP) server that provides an interactive mortgage calculator widget for ChatGPT. Helps users calculate monthly mortgage payments, analyze financing options, and plan their home purchase budget.

## Features

- 💰 Calculate monthly mortgage payments
- 📊 Simple inputs: purchase price, interest rate, loan term
- 🔄 Interactive widget that appears directly in ChatGPT
- 📈 Shows principal, interest, and total payment breakdown

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Installation

```bash
pnpm install
```

### Run Locally

```bash
pnpm start
```

Server runs on `http://localhost:8000`

### Deploy to Render.com

1. Push this repo to GitHub
2. Connect to Render.com
3. Create new Web Service from this repo
4. Render will auto-detect `render.yaml` and deploy

Your permanent URL: `https://your-app.onrender.com/mcp`

## How to Use in ChatGPT

1. Open ChatGPT in **Developer Mode**
2. Add MCP Connector with URL: `https://your-app.onrender.com/mcp`
3. Say: **"show me a mortgage calculator"**
4. The interactive widget appears!

## Tech Stack

- **MCP SDK** - Model Context Protocol for ChatGPT integration
- **Node.js + TypeScript** - Server runtime
- **Server-Sent Events (SSE)** - Real-time communication
- **React** - Widget UI components

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
BUTTONDOWN_API_KEY=your_api_key
TURNSTILE_SECRET_KEY=your_secret_key
ANALYTICS_PASSWORD=your_password
```

## License

MIT
