import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type MortgageWidget = {
  id: string;
  title: string;
  templateUri: string;
  invoking: string;
  invoked: string;
  html: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.ASSETS_ROOT || path.resolve(__dirname, "..");
// Resolve assets directory robustly across environments (Render may mount repo under different roots)
const CANDIDATE_ASSETS_DIRS = [
  // If ASSETS_ROOT is provided, prefer its /assets child and the root itself (in case ASSETS_ROOT already points to /assets)
  process.env.ASSETS_ROOT ? path.resolve(process.env.ASSETS_ROOT, "assets") : "",
  process.env.ASSETS_ROOT ? path.resolve(process.env.ASSETS_ROOT) : "",
  // Repo root /assets (running with tsx from src/)
  path.resolve(__dirname, "..", "assets"),
  // Monorepo/go workspaces where cwd is project root
  path.resolve(process.cwd(), "assets"),
  // One more level up just in case
  path.resolve(__dirname, "..", "..", "assets"),
  // Fallback to ROOT_DIR/assets
  path.resolve(ROOT_DIR, "assets"),
].filter(Boolean) as string[];

const pickAssetsDir = (): string => {
  for (const p of CANDIDATE_ASSETS_DIRS) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  // Default guess (may not exist; readWidgetHtml will throw with candidates listed)
  return path.resolve(ROOT_DIR, "assets");
};

const ASSETS_DIR = pickAssetsDir();
const LOGS_DIR = path.resolve(__dirname, "..", "logs");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// FRED daily mortgage rate endpoint (/api/rate)
type RateCache = { ts: number; payload: any } | null;
let fredRateCache: RateCache = null;

async function fetchFredLatestRate(): Promise<{ raw: number; adjusted: number; observationDate: string; source: string; } | null> {
  const FRED_API_KEY = process.env.FRED_API_KEY;
  const seriesId = process.env.FRED_SERIES_ID || "MORTGAGE30US";
  if (!FRED_API_KEY) {
    console.error("[FRED] FRED_API_KEY not set");
    return null;
  }

  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", FRED_API_KEY);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "14");

  try {
    console.log("[FRED] Fetching latest rate", {
      seriesId,
      url: url.toString(),
    });
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`FRED error ${resp.status}`);
    const data = await resp.json();
    const obs = Array.isArray(data?.observations) ? data.observations : [];
    const firstValid = obs.find((o: any) => o && o.value && o.value !== ".");
    if (!firstValid) {
      console.error("[FRED] No valid observations returned", {
        seriesId,
        sample: obs.slice(0, 5),
      });
      return null;
    }
    const raw = parseFloat(firstValid.value);
    if (!Number.isFinite(raw)) {
      console.error("[FRED] Observation value not numeric", {
        seriesId,
        observation: firstValid,
      });
      return null;
    }
    const adjusted = raw - 0.4;
    console.log("[FRED] Received observation", {
      observationDate: firstValid.date,
      raw,
      adjusted,
    });
    return { raw, adjusted, observationDate: firstValid.date, source: seriesId };
  } catch (e) {
    console.error("[FRED] Fetch failed", e);
    return null;
  }
}

async function handleRate(req: IncomingMessage, res: ServerResponse) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log("[Rate] Request received", {
    requestId,
    method: req.method,
    url: req.url,
  });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    }).end();
    return;
  }

  if (req.method !== "GET") {
    console.warn("[Rate] Unsupported method", { requestId, method: req.method });
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const now = Date.now();
  const TTL = 60 * 60 * 1000; // 1 hour
  if (fredRateCache && now - fredRateCache.ts < TTL) {
    console.log("[Rate] Serving cached value", {
      requestId,
      cachedAt: fredRateCache.ts,
      ratePercent: fredRateCache.payload?.ratePercent,
    });
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.writeHead(200).end(JSON.stringify(fredRateCache.payload));
    return;
  }

  console.log("[Rate] Cache miss, fetching fresh value", {
    requestId,
    cachePresent: Boolean(fredRateCache),
  });
  const result = await fetchFredLatestRate();
  if (!result) {
    console.error("[Rate] Failed to obtain FRED rate", { requestId });
    res.setHeader("Cache-Control", "no-store");
    res.writeHead(503).end(JSON.stringify({ error: "FRED unavailable" }));
    return;
  }
  const rounded = Math.round(result.adjusted * 10) / 10;
  const payload: any = {
    ratePercent: rounded,
    rawPercent: result.raw,
    adjustedAdded: -0.4,
    observationDate: result.observationDate,
    source: result.source,
  };
  fredRateCache = { ts: now, payload };
  console.log("[Rate] Returning fresh value", {
    requestId,
    payload,
  });
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.writeHead(200).end(JSON.stringify(payload));
}

type AnalyticsEvent = {
  timestamp: string;
  event: string;
  [key: string]: any;
};

function logAnalytics(event: string, data: Record<string, any> = {}) {
  const entry: AnalyticsEvent = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };

  const logLine = JSON.stringify(entry);
  console.log(logLine);

  const today = new Date().toISOString().split("T")[0];
  const logFile = path.join(LOGS_DIR, `${today}.log`);
  fs.appendFileSync(logFile, logLine + "\n");
}

function getRecentLogs(days: number = 7): AnalyticsEvent[] {
  const logs: AnalyticsEvent[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const logFile = path.join(LOGS_DIR, `${dateStr}.log`);

    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, "utf8");
      const lines = content.trim().split("\n");
      lines.forEach((line) => {
        try {
          logs.push(JSON.parse(line));
        } catch (e) {}
      });
    }
  }

  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function classifyDevice(userAgent?: string | null): string {
  if (!userAgent) return "Unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "iOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macOS";
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("linux")) return "Linux";
  if (ua.includes("cros")) return "ChromeOS";
  return "Other";
}

function computeSummary(args: any) {
  // Prefer auto-loan fields when present, otherwise fall back to generic mortgage fields
  const autoPrice = typeof (args as any).auto_price === "number" && (args as any).auto_price > 0 ? (args as any).auto_price : null;
  const loanMonths = typeof (args as any).loan_term_months === "number" && (args as any).loan_term_months > 0 ? (args as any).loan_term_months : null;
  const ratePctAuto = typeof (args as any).interest_rate_pct === "number" && (args as any).interest_rate_pct >= 0 ? (args as any).interest_rate_pct : null;
  const cashIncentives = Math.max(0, Number((args as any).cash_incentives ?? 0));
  const downPaymentValAuto = Math.max(0, Number((args as any).down_payment_value ?? 0));
  const tradeInValue = Math.max(0, Number((args as any).trade_in_value ?? 0));
  const tradeInOwed = Math.max(0, Number((args as any).trade_in_owed ?? 0));
  const salesTaxPct = Math.max(0, Number((args as any).sales_tax_pct ?? 0));
  const titleFees = Math.max(0, Number((args as any).title_fees ?? 0));
  const includeTaxesFees = Boolean((args as any).include_taxes_fees);

  // Map auto-loan into principal if auto fields are available
  let principalAuto: number | null = null;
  if (autoPrice != null) {
    const priceAfterIncentives = Math.max(0, autoPrice - cashIncentives);
    const netTrade = Math.max(0, tradeInValue - tradeInOwed) - Math.max(0, tradeInOwed - tradeInValue); // signed net is tradeValue - tradeOwed
    const signedNetTrade = tradeInValue - tradeInOwed; // positive reduces principal, negative increases
    const taxableBase = Math.max(0, priceAfterIncentives - Math.max(0, tradeInValue));
    const taxes = (salesTaxPct / 100) * taxableBase;
    const financedExtras = includeTaxesFees ? (taxes + titleFees) : 0;
    const baseToFinance = Math.max(0, priceAfterIncentives - downPaymentValAuto - signedNetTrade);
    principalAuto = Math.max(0, baseToFinance + financedExtras);
  }

  const hv = autoPrice != null ? autoPrice : (typeof args.home_value === "number" && args.home_value > 0 ? args.home_value : null);
  const dpv = autoPrice != null ? downPaymentValAuto : (typeof args.down_payment_value === "number" && args.down_payment_value >= 0 ? args.down_payment_value : 0);
  const apr = ratePctAuto != null ? ratePctAuto : (typeof args.rate_apr === "number" && args.rate_apr > 0 ? args.rate_apr : null);
  const years = loanMonths != null ? (loanMonths / 12) : (typeof args.term_years === "number" && args.term_years > 0 ? args.term_years : null);
  const principal = principalAuto != null ? principalAuto : (hv != null ? Math.max(0, hv - dpv) : null);
  if (principal == null || apr == null || years == null) {
    return {
      loan_amount: principal,
      monthly_payment_pi: null,
      months_to_payoff: null,
      payoff_date: null,
      lifetime_interest: null,
      pmi_end_month_index: null,
      biweekly: null,
    };
  }
  const n = Math.round(years * 12);
  const r = (apr / 100) / 12;
  let m = 0;
  if (r === 0) {
    m = principal / n;
  } else {
    const f = Math.pow(1 + r, n);
    m = principal * r * f / (f - 1);
  }
  const totalPaid = m * n;
  const totalInterest = totalPaid - principal;
  let startMonth = args.start_month && args.start_month >= 1 && args.start_month <= 12 ? args.start_month : null;
  let startYear = typeof args.start_year === "number" && args.start_year > 1900 ? args.start_year : null;
  const now = new Date();
  if (!startMonth || !startYear) {
    startMonth = now.getMonth() + 1;
    startYear = now.getFullYear();
  }
  const payoff = new Date(startYear, (startMonth - 1) + n, 1);
  const payoffDate = `${payoff.getFullYear()}-${String(payoff.getMonth() + 1).padStart(2, "0")}`;
  let pmiEndIndex: number | null = null;
  const pmiThreshold = hv * 0.8;
  if (principal > 0) {
    let bal = principal;
    for (let i = 1; i <= n; i++) {
      const interestPortion = r === 0 ? 0 : bal * r;
      const principalPortion = Math.min(bal, m - interestPortion);
      bal = Math.max(0, bal - principalPortion);
      const ltvAmount = bal;
      if (pmiEndIndex === null && ltvAmount <= pmiThreshold) {
        pmiEndIndex = i;
        break;
      }
    }
  }
  let biweekly: any = null;
  try {
    const periodsPerYear = 26;
    const i = (apr / 100) / periodsPerYear;
    const paymentBiweekly = m / 2;
    let nbi = null as null | number;
    if (i === 0) {
      nbi = principal / paymentBiweekly;
    } else {
      const denom = paymentBiweekly - principal * i;
      if (denom > 0) {
        nbi = Math.log(paymentBiweekly / denom) / Math.log(1 + i);
      }
    }
    if (nbi && nbi > 0 && Number.isFinite(nbi)) {
      const interestBi = paymentBiweekly * nbi - principal;
      const monthsBi = nbi / periodsPerYear * 12;
      const monthsSaved = Math.max(0, n - monthsBi);
      biweekly = {
        months_to_payoff: Math.round(monthsBi),
        interest_paid: Math.max(0, interestBi),
        savings_interest: Math.max(0, totalInterest - interestBi),
        months_saved: Math.round(monthsSaved),
      };
    }
  } catch {}
  return {
    loan_amount: Math.round(principal),
    monthly_payment_pi: Math.round(m * 100) / 100,
    months_to_payoff: n,
    payoff_date: payoffDate,
    lifetime_interest: Math.round(totalInterest * 100) / 100,
    pmi_end_month_index: pmiEndIndex,
    biweekly,
  };
}

function readWidgetHtml(componentName: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    const searched = Array.from(new Set(CANDIDATE_ASSETS_DIRS)).join(" | ");
    throw new Error(
      `Widget assets not found. Searched: ${searched}. Set ASSETS_ROOT to your project root or ensure the assets directory is present in the repo.`
    );
  }

  const directPath = path.join(ASSETS_DIR, `${componentName}.html`);
  let htmlContents: string | null = null;
  let loadedFrom = "";

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
    loadedFrom = directPath;
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(
        (file) => file.startsWith(`${componentName}-`) && file.endsWith(".html")
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      const fallbackPath = path.join(ASSETS_DIR, fallback);
      htmlContents = fs.readFileSync(fallbackPath, "utf8");
      loadedFrom = fallbackPath;
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "${componentName}" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`
    );
  }

  // Log what was loaded and check for "5%" in the badge
  const has5Percent = htmlContents.includes('<span class="rate-num">5%</span>');
  const isBlank = htmlContents.includes('<span class="rate-num"></span>');
  console.log(`[Widget Load] File: ${loadedFrom}`);
  console.log(`[Widget Load] Has "5%": ${has5Percent}, Is Blank: ${isBlank}`);
  console.log(`[Widget Load] HTML length: ${htmlContents.length} bytes`);

  return htmlContents;
}

// Use git commit hash for deterministic cache-busting across deploys
// Added timestamp suffix to force cache invalidation for width fix
const VERSION = (process.env.RENDER_GIT_COMMIT?.slice(0, 7) || Date.now().toString()) + '-' + Date.now();

function widgetMeta(widget: MortgageWidget, bustCache: boolean = false) {
  const templateUri = bustCache
    ? `ui://widget/auto-loan-calculator.html?v=${VERSION}`
    : widget.templateUri;

  return {
    "openai/outputTemplate": templateUri,
    "openai/widgetDescription":
      "Auto Loan Calculator widget for analyzing auto loans. Enter purchase, financing, and expenses to calculate return on investment: ROI, cash-on-cash return, internal rate of return (IRR), capitalization rate (cap rate), net operating income (NOI), mortgage P&I, annual cash flow, equity, and a 20-year investment summary including profit when sold. Includes Year-1 KPIs, an expense donut, and a year-by-year breakdown.",
    "openai/componentDescriptions": {
      "rate-indicator": "Header indicator for auto loan analysis showing today’s mortgage rate reference to contextualize ROI and cash-on-cash return; includes a refresh control for current rates.",
      "rate-badge": "Badge showing the most recent mortgage rate reference to inform auto loan returns (cash-on-cash, IRR, cap rate); updates when refreshed.",
      "manual-refresh-button": "Refresh to pull a new mortgage rate reference so auto loan ROI, cash-on-cash return, and IRR reflect current rates.",
      "loan-input-form": "Auto loan financing inputs—loan program, down payment, interest rate, and term—used to compute mortgage P&I for the auto loan calculator and drive cash flow/NOI.",
      "monthly-summary-card": "Year-1 auto loan summary showing income after expenses and monthly/annual cash flow to support ROI analysis.",
      "quick-metrics": "Auto loan KPIs including cap rate, cash-on-cash return, NOI, and mortgage P&I totals for quick insight.",
      "breakdown-chart": "Auto loan expense donut showing operating expenses and mix to explain NOI and cash flow.",
      "amortization-section": "20-year investment summary for auto loans: income, expenses, cash flow, equity, cash if sold, and IRR at the chosen horizon.",
      "notification-cta": "Optional call-to-action for rate-drop updates to revisit auto loan returns when interest rates move.",
    },
    "openai/widgetKeywords": [
      "auto loan calculator",
      "ROI on auto loan",
      "calculate return on auto loan",
      "auto loan cash on cash return",
      "auto loan IRR",
      "investment property cap rate",
      "auto loan NOI",
      "auto loan mortgage P&I",
      "auto loan returns",
      "auto loan analysis",
      "20 year auto loan projections",
      "auto loan profit when sold",
      "auto loan equity growth",
    ],
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: [
        "https://api.stlouisfed.org",
        "https://mortgage-calculator-open-ai.onrender.com",
        "http://localhost:8000"
      ],
      resource_domains: [],
    },
    "openai/widgetDomain": "https://chatgpt.com",
    "openai/toolInvocation/invoking": widget.invoking,
    "openai/toolInvocation/invoked": widget.invoked,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
    "openai/starterPrompts": [
      "Show an auto loan calculator.",
      "Analyze the return of a car loan.",
      "Calculate cashflow on this auto loan.",
      "Analyze a car loan: purchase $30,000, 20% down, 6.25% APR, monthly expenses $500, over 5 years.",
      "Show me the ROI on a $25,000 car loan with 25% down, monthly expenses $400, over 5 years.",
    ],
    "openai/sampleConversations": [
      { "user": "Calculate cash-on-cash return and IRR for a car loan with $30k purchase, 15% down, 6.25% for 5y, monthly expenses $500.", "assistant": "Here are the auto loan metrics: ROI, cash-on-cash return, IRR, cap rate, NOI, P&I totals, and a 20-year investment summary including equity and profit when sold. Year-1 KPIs and the expense donut are included." },
      { "user": "How does 3% vs 4% appreciation affect profit when sold and IRR?", "assistant": "I’ll compute two scenarios and compare 20-year ROI, IRR, cash-on-cash return, cap rate, NOI, annual cash flow, equity, and profit when sold." }
    ],
  } as const;
}

const widgets: MortgageWidget[] = [
  {
    id: "auto-loan-calculator",
    title: "Auto Loan Calculator — calculate ROI, cash-on-cash return, IRR, cap rate, NOI, and 20-year projections for auto loans",
    templateUri: `ui://widget/auto-loan-calculator.html?v=${VERSION}`,
    invoking:
      "Opening the Auto Loan Calculator with inputs for purchase, financing, income, and expenses to compute ROI, cash-on-cash return, IRR, cap rate, NOI, cash flow, and 20-year projections...",
    invoked:
      "Here is the Auto Loan Calculator with Year-1 KPIs, an expense donut, and a 20-year investment summary (ROI, cash-on-cash return, IRR, cap rate, NOI, cash flow, equity, and profit when sold).",
    html: readWidgetHtml("auto-loan-calculator"),
  },
];

const widgetsById = new Map<string, MortgageWidget>();
const widgetsByUri = new Map<string, MortgageWidget>();

widgets.forEach((widget) => {
  widgetsById.set(widget.id, widget);
  widgetsByUri.set(widget.templateUri, widget);
});

const toolInputSchema = {
  type: "object",
  properties: {
    loan_type: {
      type: "string",
      enum: ["conventional", "FHA", "VA", "USDA"],
      description: "Loan program type. Choose one of: conventional, FHA, VA, USDA. Natural language hints: 'FHA loan', 'VA mortgage'.",
      examples: ["conventional", "FHA"],
    },
    home_value: {
      type: "number",
      description: "Home purchase price (a.k.a. home price, house price, property price, purchase price, list price). Extract dollar amounts like '$500,000', '500k', '0.5m'.",
      examples: [500000, 350000, 875000],
    },
    down_payment_value: {
      type: "number",
      description: "Down payment in dollars (not percent). If the user says '20% down' and home_value is known, compute value = home_value * 0.20. Accept '$25,000 down', '25k down'.",
      examples: [100000, 25000, 90000],
    },
    rate_apr: {
      type: "number",
      description: "Interest rate APR as a percentage number, e.g., 6.5 for 6.5%. Extract from phrasing like 'rate 5.75%', 'APR 6.2', 'at 6%'.",
      examples: [6.5, 5.75, 6.2],
    },
    term_years: {
      type: "number",
      description: "Loan term in years. Extract from phrases like '30-year fixed', '15 yr', '20 year'.",
      examples: [30, 15, 20],
    },
    zip_code: {
      type: "string",
      description: "Optional ZIP/postal code. Prefer 5-digit US ZIP if present in the user text.",
      examples: ["94110", "11215"],
    },
    // Auto-loan specific inputs
    auto_price: { type: "number", description: "Vehicle price (e.g., 50000)." },
    loan_term_months: { type: "number", description: "Loan term in months (e.g., 60)." },
    interest_rate_pct: { type: "number", description: "APR as percent (e.g., 5 for 5%)." },
    cash_incentives: { type: "number", description: "Cash rebates/incentives applied to price." },
    trade_in_value: { type: "number", description: "Trade-in value in dollars." },
    trade_in_owed: { type: "number", description: "Amount still owed on trade-in in dollars." },
    state: { type: "string", description: "Two-letter state code." },
    sales_tax_pct: { type: "number", description: "Sales tax percent applied to taxable base." },
    title_fees: { type: "number", description: "Title/registration/other fees in dollars." },
    include_taxes_fees: { type: "boolean", description: "If true, include taxes and fees in the financed amount." },
    // Rental-specific inputs (accepted from prompts for widget hydration)
    purchase_price: { type: "number", description: "Rental property purchase price (e.g., $700,000)." },
    closing_cost: { type: "number", description: "Estimated closing costs in dollars." },
    monthly_rent: { type: "number", description: "Total monthly rent for the property (all units)." },
    other_monthly_income: { type: "number", description: "Other recurring monthly income (parking, laundry)." },
    vacancy_rate_pct: { type: "number", description: "Vacancy rate as a percent number (e.g., 5 for 5%)." },
    exp_property_tax_annual: { type: "number", description: "Annual property taxes in dollars." },
    exp_insurance_annual: { type: "number", description: "Annual homeowners insurance in dollars." },
    exp_hoa_annual: { type: "number", description: "Annual HOA dues in dollars." },
    exp_maintenance_annual: { type: "number", description: "Annual maintenance cost in dollars." },
    exp_other_annual: { type: "number", description: "Annual other operating costs in dollars." },
    down_payment_pct: { type: "number", description: "Down payment percent (e.g., 20 for 20%)." },
    loan_term_years: { type: "number", description: "Loan term in years (e.g., 30)." },
    monthly_rent_increase_pct: { type: "number", description: "Annual rent increase percent." },
    other_monthly_income_increase_pct: { type: "number", description: "Annual other income increase percent." },
    exp_property_tax_increase_pct: { type: "number", description: "Annual tax increase percent." },
    exp_insurance_increase_pct: { type: "number", description: "Annual insurance increase percent." },
    exp_hoa_increase_pct: { type: "number", description: "Annual HOA increase percent." },
    exp_maintenance_increase_pct: { type: "number", description: "Annual maintenance increase percent." },
    exp_other_increase_pct: { type: "number", description: "Annual other cost increase percent." },
    holding_length_years: { type: "number", description: "Holding period in years for the investment summary." },
    cost_to_sell_pct: { type: "number", description: "Percent cost to sell at exit (e.g., 6)." },
    value_appreciation_pct: { type: "number", description: "Annual property appreciation percent (e.g., 3)." },
    sell_price: { type: "number", description: "Explicit sell price if known (overrides appreciation)." },
  },
  required: [],
  additionalProperties: false,
} as const;

const toolInputParser = z.object({
  loan_type: z.enum(["conventional", "FHA", "VA", "USDA"]).optional(),
  home_value: z.number().optional(),
  down_payment_value: z.number().optional(),
  rate_apr: z.number().optional(),
  term_years: z.number().optional(),
  zip_code: z.string().optional(),
  credit_score: z.enum(["760+", "720-759", "680-719", "640-679", "600-639", "<600"]).optional(),
  property_tax_input: z.number().optional(),
  homeowners_insurance_yearly: z.number().optional(),
  hoa_monthly: z.number().optional(),
  pmi_pct: z.number().optional(),
  annual_mi_pct: z.number().optional(),
  upfront_fee_pct: z.number().optional(),
  finance_upfront_fee: z.boolean().optional(),
  start_month: z.number().min(1).max(12).optional(),
  start_year: z.number().optional(),
  extra_principal_monthly: z.number().optional(),
  extra_start_month_index: z.number().optional(),
  // Auto-loan specific (preferred)
  auto_price: z.number().optional(),
  loan_term_months: z.number().optional(),
  interest_rate_pct: z.number().optional(),
  cash_incentives: z.number().optional(),
  trade_in_value: z.number().optional(),
  trade_in_owed: z.number().optional(),
  state: z.string().optional(),
  sales_tax_pct: z.number().optional(),
  title_fees: z.number().optional(),
  include_taxes_fees: z.boolean().optional(),

  // Rental-specific fields (optional for hydration; retained for backward-compat)
  purchase_price: z.number().optional(),
  closing_cost: z.number().optional(),
  monthly_rent: z.number().optional(),
  other_monthly_income: z.number().optional(),
  vacancy_rate_pct: z.number().optional(),
  exp_property_tax_annual: z.number().optional(),
  exp_insurance_annual: z.number().optional(),
  exp_hoa_annual: z.number().optional(),
  exp_maintenance_annual: z.number().optional(),
  exp_other_annual: z.number().optional(),
  down_payment_pct: z.number().optional(),
  loan_term_years: z.number().optional(),
  monthly_rent_increase_pct: z.number().optional(),
  other_monthly_income_increase_pct: z.number().optional(),
  exp_property_tax_increase_pct: z.number().optional(),
  exp_insurance_increase_pct: z.number().optional(),
  exp_hoa_increase_pct: z.number().optional(),
  exp_maintenance_increase_pct: z.number().optional(),
  exp_other_increase_pct: z.number().optional(),
  holding_length_years: z.number().optional(),
  cost_to_sell_pct: z.number().optional(),
  value_appreciation_pct: z.number().optional(),
  sell_price: z.number().optional(),
});

const tools: Tool[] = widgets.map((widget) => ({
  name: widget.id,
  description:
    "Use this for auto loan analysis. The calculator opens with sensible default values and does NOT require explicit numbers to run—users can adjust inputs interactively in the widget. If the user provides specific values (purchase price, loan term, interest rate, etc.), pass them to pre-populate the calculator. Calculates return on investment: ROI, cash-on-cash return, internal rate of return (IRR), capitalization rate (cap rate), net operating income (NOI), mortgage P&I totals, annual cash flow, equity, and a 20-year investment summary including profit when sold.",
  inputSchema: toolInputSchema,
  outputSchema: {
    type: "object",
    properties: {
      ready: { type: "boolean" },
      timestamp: { type: "string" },
      currentRate: { type: ["number", "null"] },
      loan_type: { type: "string" },
      home_value: { type: "number" },
      down_payment_value: { type: "number" },
      rate_apr: { type: "number" },
      term_years: { type: "number" },
      zip_code: { type: "string" },
      credit_score: { type: "string" },
      property_tax_input: { type: "number" },
      homeowners_insurance_yearly: { type: "number" },
      hoa_monthly: { type: "number" },
      pmi_pct: { type: "number" },
      annual_mi_pct: { type: "number" },
      upfront_fee_pct: { type: "number" },
      finance_upfront_fee: { type: "boolean" },
      start_month: { type: "number" },
      start_year: { type: "number" },
      extra_principal_monthly: { type: "number" },
      extra_start_month_index: { type: "number" },
      summary: {
        type: "object",
        properties: {
          loan_amount: { type: ["number", "null"] },
          monthly_payment_pi: { type: ["number", "null"] },
          months_to_payoff: { type: ["number", "null"] },
          payoff_date: { type: ["string", "null"] },
          lifetime_interest: { type: ["number", "null"] },
          pmi_end_month_index: { type: ["number", "null"] },
          biweekly: {
            type: ["object", "null"],
            properties: {
              months_to_payoff: { type: ["number", "null"] },
              interest_paid: { type: ["number", "null"] },
              savings_interest: { type: ["number", "null"] },
              months_saved: { type: ["number", "null"] },
            },
          },
        },
      },
      suggested_followups: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  title: widget.title,
  securitySchemes: [{ type: "noauth" }],
  _meta: {
    ...widgetMeta(widget),
    securitySchemes: [{ type: "noauth" }],
  },
  annotations: {
    destructiveHint: false,
    openWorldHint: false,
    readOnlyHint: true,
  },
}));

const resources: Resource[] = widgets.map((widget) => ({
  uri: widget.templateUri,
  name: widget.title,
  description:
    "HTML template for the Auto Loan Calculator widget. Presents inputs for purchase, financing, and expenses, with Year-1 KPIs, expense donut, and a 20-year investment summary showing ROI, cash-on-cash return, IRR, cap rate, NOI, cash flow, equity, and profit when sold.",
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget),
}));

const resourceTemplates: ResourceTemplate[] = widgets.map((widget) => ({
  uriTemplate: widget.templateUri,
  name: widget.title,
  description:
    "Template descriptor for the Auto Loan Calculator widget that analyzes auto loans. Includes inputs for purchase, financing, and operating expenses, plus Year-1 KPIs, an expense donut, and a 20-year investment summary including ROI, cash-on-cash return, IRR, cap rate, NOI, cash flow, equity, and profit when sold.",
  mimeType: "text/html+skybridge",
  _meta: widgetMeta(widget),
}));

function createMortgageCalculatorServer(): Server {
  const server = new Server(
    {
      name: "auto-loan-calculator",
      version: "0.1.0",
      description:
        "Auto Loan Calculator is a comprehensive app for analyzing auto loans. It calculates return on investment including cash-on-cash return, IRR, cap rate, NOI, mortgage P&I totals, annual cash flow, equity growth, and a 20-year investment summary with profit when sold. It opens with sensible defaults and supports general prompts like ‘show an auto loan calculator’.",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request: ListResourcesRequest) => {
      console.log(`[MCP] resources/list called, returning ${resources.length} resources`);
      resources.forEach((r: any) => {
        console.log(`  - ${r.uri} (${r.name})`);
      });
      return { resources };
    }
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request: ReadResourceRequest) => {
      const widget = widgetsByUri.get(request.params.uri);

      if (!widget) {
        throw new Error(`Unknown resource: ${request.params.uri}`);
      }

      // Inject current FRED rate into HTML before sending to ChatGPT
      let htmlToSend = widget.html;
      let displayRate: number | null = null;
      if (fredRateCache && fredRateCache.payload && typeof fredRateCache.payload.ratePercent === "number") {
        displayRate = fredRateCache.payload.ratePercent;
        console.log(`[MCP Injection] Using cached rate: ${displayRate}%`);
      } else {
        const latest = await fetchFredLatestRate();
        if (latest) {
          displayRate = Math.round((latest.adjusted) * 10) / 10;
          console.log(`[MCP Injection] Fetched fresh rate: ${displayRate}%`);
        } else {
          console.log(`[MCP Injection] FRED fetch failed, leaving blank`);
        }
      }
      // Only inject if we have a valid live rate. Otherwise leave blank.
      if (displayRate != null && Number.isFinite(displayRate)) {
        const rateText = `${displayRate}%`;
        const beforeLength = htmlToSend.length;
        htmlToSend = htmlToSend.replace(
          /(<span\s+class="rate-num">)([^<]*?)(<\/span>)/,
          (_m: any, p1: string, _p2: string, p3: string) => `${p1}${rateText}${p3}`
        );
        const afterLength = htmlToSend.length;
        const replaced = beforeLength !== afterLength || htmlToSend.includes(`rate-num">${rateText}`);
        console.log(`[MCP Injection] Injected "${rateText}", replacement success: ${replaced}`);
      } else {
        console.log(`[MCP Injection] No valid rate, sending blank badge`);
      }

      return {
        contents: [
          {
            uri: widget.templateUri,
            mimeType: "text/html+skybridge",
            text: htmlToSend,
            _meta: widgetMeta(widget),
          },
        ],
      };
    }
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_request: ListResourceTemplatesRequest) => ({ resourceTemplates })
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request: ListToolsRequest) => ({ tools })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      const startTime = Date.now();
      let userAgentString: string | null = null;
      let deviceCategory = "Unknown";
      
      // Log the full request to debug _meta location
      console.log("Full request object:", JSON.stringify(request, null, 2));
      
      try {
        const widget = widgetsById.get(request.params.name);

        if (!widget) {
          logAnalytics("tool_call_error", {
            error: "Unknown tool",
            toolName: request.params.name,
          });
          throw new Error(`Unknown tool: ${request.params.name}`);
        }

        // Parse and validate input parameters
        let args: z.infer<typeof toolInputParser> = {};
        try {
          args = toolInputParser.parse(request.params.arguments ?? {});
        } catch (parseError: any) {
          logAnalytics("parameter_parse_error", {
            toolName: request.params.name,
            params: request.params.arguments,
            error: parseError.message,
          });
          throw parseError;
        }

        // Capture user context from _meta - try multiple locations
        const meta = (request as any)._meta || request.params?._meta || {};
        const userLocation = meta["openai/userLocation"];
        const userLocale = meta["openai/locale"];
        const userAgent = meta["openai/userAgent"];
        userAgentString = typeof userAgent === "string" ? userAgent : null;
        deviceCategory = classifyDevice(userAgentString);
        
        // Debug log
        console.log("Captured meta:", { userLocation, userLocale, userAgent });

        // If ChatGPT didn't pass structured arguments, try to infer key numbers from freeform text in meta
        try {
          const candidates: any[] = [
            meta["openai/subject"],
            meta["openai/userPrompt"],
            meta["openai/userText"],
            meta["openai/lastUserMessage"],
            meta["openai/inputText"],
            meta["openai/requestText"],
          ];
          const userText = candidates.find((t) => typeof t === "string" && t.trim().length > 0) || "";
          if (args.home_value === undefined || args.home_value === null) {
            if (userText) {
              const parseAmountToNumber = (s: string): number | null => {
                const lower = s.toLowerCase().replace(/[,$\s]/g, "").trim();
                const m = lower.match(/^(\d+(?:\.\d+)?)(m)$/);
                const k = lower.match(/^(\d+(?:\.\d+)?)(k)$/);
                if (m) return Math.round(parseFloat(m[1]) * 1_000_000);
                if (k) return Math.round(parseFloat(k[1]) * 1_000);
                const n = Number(lower.replace(/[^0-9.]/g, ""));
                return Number.isFinite(n) ? Math.round(n) : null;
              };

              // 1) Targeted pattern allowing determiners between preposition and number (e.g., "on a 500,000 home")
              const targeted = userText.match(/(?:home|house|property|mortgage)\b[^\d$]{0,40}?\$?([\d,.]+\s*[kKmM]?)/i)
                || userText.match(/\$\s*([\d,.]+\s*[kKmM]?)/i)
                || userText.match(/([\d,.]+\s*[kKmM]?)\s*(?:home|house|property|mortgage)\b/i);

              const tryAssign = (raw: string | null | undefined) => {
                if (!raw) return false;
                const parsed = parseAmountToNumber(raw);
                if (parsed && parsed >= 50_000 && parsed <= 100_000_000) {
                  args.home_value = parsed;
                  console.log("[Inference] home_value inferred from user text", { home_value: parsed, source: userText });
                  return true;
                }
                return false;
              };

              let assigned = false;
              if (targeted && targeted[1]) {
                assigned = tryAssign(targeted[1]);
              }

              // 2) Fallback: scan for any plausible amount near keywords within a small window
              if (!assigned) {
                const keywordRe = /(home|house|property|mortgage)/i;
                const amountRe = /\$?\b(\d{1,3}(?:[.,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s*[kKmM]?)\b/g;
                let match: RegExpExecArray | null;
                while ((match = amountRe.exec(userText)) !== null) {
                  const start = Math.max(0, match.index - 40);
                  const end = Math.min(userText.length, amountRe.lastIndex + 40);
                  const windowText = userText.slice(start, end);
                  if (keywordRe.test(windowText)) {
                    if (tryAssign(match[1])) { assigned = true; break; }
                  }
                }
              }
            }
          }
          if ((args.term_years === undefined || args.term_years === null) && userText) {
            const tm = userText.match(/\b(\d{1,2})\s*[- ]?(?:year|yr|y)\b/i) || userText.match(/\b(10|15|20|25|30)\s*[- ]?(?:fixed|mortgage)\b/i);
            if (tm && tm[1]) {
              const ty = parseInt(tm[1], 10);
              if (ty >= 5 && ty <= 40) {
                args.term_years = ty;
              }
            }
          }
          if ((args.rate_apr === undefined || args.rate_apr === null) && userText) {
            const rm = userText.match(/\b(\d{1,2}(?:\.\d+)?)\s*%\b/i) || userText.match(/\b(?:rate|apr|at)\s*(\d{1,2}(?:\.\d+)?)\b/i);
            if (rm && rm[1]) {
              const rv = parseFloat(rm[1]);
              if (rv > 0 && rv < 25) {
                args.rate_apr = rv;
              }
            }
          }
          if ((args.zip_code === undefined || args.zip_code === null) && userText) {
            const zm = userText.match(/\b(\d{5})\b/);
            if (zm && zm[1]) {
              args.zip_code = zm[1];
            }
          }
          if ((args.down_payment_value === undefined || args.down_payment_value === null) && userText) {
            let dpm = userText.match(/\$\s*([\d,.]+)\s*(?:down|dp)\b/i);
            if (dpm && dpm[1]) {
              const n = Number(dpm[1].replace(/[^0-9.]/g, ""));
              if (Number.isFinite(n) && n >= 0) {
                args.down_payment_value = Math.round(n);
              }
            } else {
              const ppm = userText.match(/\b(\d{1,2}(?:\.\d+)?)\s*%\s*(?:down|dp|down\s*payment)\b/i) || userText.match(/\b(?:down|dp|down\s*payment)[^\d%]{0,20}(\d{1,2}(?:\.\d+)?)\s*%\b/i);
              if (ppm && ppm[1] && typeof args.home_value === "number" && args.home_value > 0) {
                const pct = parseFloat(ppm[1]);
                if (pct >= 0 && pct <= 100) {
                  args.down_payment_value = Math.round(args.home_value * (pct / 100));
                }
              }
            }
          }

          // Rental-focused inference and mapping
          // Map home_value -> purchase_price if explicit purchase_price wasn't provided
          if ((args as any).purchase_price == null && typeof args.home_value === "number" && args.home_value > 0) {
            (args as any).purchase_price = args.home_value;
          }
          // Infer monthly_rent if user mentions "rent $X"
          if ((args as any).monthly_rent == null && userText) {
            const rentMatch = userText.match(/rent[^\d$]{0,15}\$?([\d,.]+)\b/i) || userText.match(/\$\s*([\d,.]+)\b[^\n]{0,20}\brent\b/i);
            if (rentMatch && rentMatch[1]) {
              const rn = Number(rentMatch[1].replace(/[^0-9.]/g, ""));
              if (Number.isFinite(rn) && rn >= 0) {
                (args as any).monthly_rent = Math.round(rn);
              }
            }
          }
          // Compute down_payment_pct from value if possible
          if ((args as any).down_payment_pct == null && typeof args.home_value === "number" && args.home_value > 0 && typeof args.down_payment_value === "number") {
            const pct = (args.down_payment_value / args.home_value) * 100;
            if (Number.isFinite(pct)) {
              (args as any).down_payment_pct = Math.round(pct * 100) / 100;
            }
          }
        } catch (e) {
          console.warn("Parameter inference from meta failed", e);
        }

        const responseTime = Date.now() - startTime;

        // Infer likely user query from parameters
        const inferredQuery = [];
        if (args.home_value) inferredQuery.push(`home value: $${args.home_value.toLocaleString()}`);
        if (args.down_payment_value) inferredQuery.push(`down payment: $${args.down_payment_value.toLocaleString()}`);
        if (args.loan_type) inferredQuery.push(`loan type: ${args.loan_type}`);
        if (args.term_years) inferredQuery.push(`${args.term_years}-year term`);
        if (args.rate_apr) inferredQuery.push(`${args.rate_apr}% APR`);

        logAnalytics("tool_call_success", {
          toolName: request.params.name,
          params: args,
          inferredQuery: inferredQuery.length > 0 ? inferredQuery.join(", ") : "Auto Loan Calculator",
          responseTime,
          device: deviceCategory,
          userLocation: userLocation
            ? {
                city: userLocation.city,
                region: userLocation.region,
                country: userLocation.country,
                timezone: userLocation.timezone,
              }
            : null,
          userLocale,
          userAgent,
        });

        // Use a stable template URI so toolOutput reliably hydrates the component
        const widgetMetadata = widgetMeta(widget, false);
        console.log(`[MCP] Tool called: ${request.params.name}, returning templateUri: ${(widgetMetadata as any)["openai/outputTemplate"]}`);

        // Build structured content once so we can log it and return it
        const structured = {
          ready: true,
          timestamp: new Date().toISOString(),
          currentRate: fredRateCache?.payload?.ratePercent ?? null,
          // Flatten parsed parameters directly into structuredContent
          loan_type: args.loan_type,
          home_value: args.home_value,
          down_payment_value: args.down_payment_value,
          rate_apr: args.rate_apr,
          term_years: args.term_years,
          zip_code: args.zip_code,
          credit_score: args.credit_score,
          property_tax_input: args.property_tax_input,
          homeowners_insurance_yearly: args.homeowners_insurance_yearly,
          hoa_monthly: args.hoa_monthly,
          pmi_pct: args.pmi_pct,
          annual_mi_pct: args.annual_mi_pct,
          upfront_fee_pct: args.upfront_fee_pct,
          finance_upfront_fee: args.finance_upfront_fee,
          start_month: args.start_month,
          start_year: args.start_year,
          extra_principal_monthly: args.extra_principal_monthly,
          extra_start_month_index: args.extra_start_month_index,
          // Rental-specific parameters passed through for widget hydration
          purchase_price: (args as any).purchase_price,
          closing_cost: (args as any).closing_cost,
          monthly_rent: (args as any).monthly_rent,
          other_monthly_income: (args as any).other_monthly_income,
          vacancy_rate_pct: (args as any).vacancy_rate_pct,
          exp_property_tax_annual: (args as any).exp_property_tax_annual,
          exp_insurance_annual: (args as any).exp_insurance_annual,
          exp_hoa_annual: (args as any).exp_hoa_annual,
          exp_maintenance_annual: (args as any).exp_maintenance_annual,
          exp_other_annual: (args as any).exp_other_annual,
          down_payment_pct: (args as any).down_payment_pct,
          interest_rate_pct: (args as any).interest_rate_pct,
          loan_term_years: (args as any).loan_term_years,
          monthly_rent_increase_pct: (args as any).monthly_rent_increase_pct,
          other_monthly_income_increase_pct: (args as any).other_monthly_income_increase_pct,
          exp_property_tax_increase_pct: (args as any).exp_property_tax_increase_pct,
          exp_insurance_increase_pct: (args as any).exp_insurance_increase_pct,
          exp_hoa_increase_pct: (args as any).exp_hoa_increase_pct,
          exp_maintenance_increase_pct: (args as any).exp_maintenance_increase_pct,
          exp_other_increase_pct: (args as any).exp_other_increase_pct,
          holding_length_years: (args as any).holding_length_years,
          cost_to_sell_pct: (args as any).cost_to_sell_pct,
          value_appreciation_pct: (args as any).value_appreciation_pct,
          sell_price: (args as any).sell_price,
          summary: computeSummary(args),
          suggested_followups: [
            "Help me reduce my monthly payment",
            "Compare 15 vs 30 year for my inputs",
            "What if property taxes are 1.2%?",
          ],
        } as const;

        // Embed the widget resource in _meta to mirror official examples and improve hydration reliability
        const metaForReturn = {
          ...widgetMetadata,
          "openai.com/widget": {
            type: "resource",
            resource: {
              uri: widget.templateUri,
              mimeType: "text/html+skybridge",
              text: widget.html,
              title: widget.title,
            },
          },
        } as const;

        console.log("[MCP] Returning outputTemplate:", (metaForReturn as any)["openai/outputTemplate"]);
        console.log("[MCP] Returning structuredContent:", structured);

        // Log success analytics with rental parameters
        try {
          logAnalytics("tool_call_success", {
            responseTime,
            params: request.params.arguments || {},
            inferredQuery: inferredQuery.join(", "),
            userLocation,
            userLocale,
            device: deviceCategory,
          });
        } catch {}

        return {
          content: [],
          structuredContent: structured,
          _meta: metaForReturn,
        };
      } catch (error: any) {
        logAnalytics("tool_call_error", {
          error: error.message,
          stack: error.stack,
          responseTime: Date.now() - startTime,
          device: deviceCategory,
          userAgent: userAgentString,
        });
        throw error;
      }
    }
  );

  return server;
}

type SessionRecord = {
  server: Server;
  transport: SSEServerTransport;
};

const sessions = new Map<string, SessionRecord>();

const ssePath = "/mcp";
const postPath = "/mcp/messages";
const subscribePath = "/api/subscribe";
const analyticsPath = "/analytics";
const trackEventPath = "/api/track";
const healthPath = "/health";
const ratePath = "/api/rate";

const ANALYTICS_PASSWORD = process.env.ANALYTICS_PASSWORD || "changeme123";

function checkAnalyticsAuth(req: IncomingMessage): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  const base64Credentials = authHeader.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
  const [username, password] = credentials.split(":");

  return username === "admin" && password === ANALYTICS_PASSWORD;
}

function humanizeEventName(event: string): string {
  const eventMap: Record<string, string> = {
    tool_call_success: "Tool Call Success",
    tool_call_error: "Tool Call Error",
    parameter_parse_error: "Parameter Parse Error",
    widget_file_claim_click: "File Claim Click",
    widget_share_click: "Share Click",
    widget_notify_me_subscribe: "Notify Me Subscribe",
    widget_carousel_prev: "Carousel Previous",
    widget_carousel_next: "Carousel Next",
    widget_filter_age_change: "Filter: Age Change",
    widget_filter_state_change: "Filter: State Change",
    widget_filter_sort_change: "Filter: Sort Change",
    widget_filter_category_change: "Filter: Category Change",
    widget_user_feedback: "User Feedback",
    widget_test_event: "Test Event",
    widget_followup_click: "Follow-up Click",
    widget_toggle_biweekly: "Toggle Biweekly",
    widget_slider_rate_change: "Rate Slider Change",
    widget_slider_down_payment_change: "Down Payment Slider Change",
  };
  return eventMap[event] || event;
}

function formatEventDetails(log: AnalyticsEvent): string {
  const excludeKeys = ["timestamp", "event"];
  const details: Record<string, any> = {};
  
  Object.keys(log).forEach((key) => {
    if (!excludeKeys.includes(key)) {
      details[key] = log[key];
    }
  });
  
  if (Object.keys(details).length === 0) {
    return "—";
  }
  
  return JSON.stringify(details, null, 0);
}

function generateAnalyticsDashboard(logs: AnalyticsEvent[]): string {
  const errorLogs = logs.filter((l) => l.event.includes("error"));
  const successLogs = logs.filter((l) => l.event === "tool_call_success");
  const parseLogs = logs.filter((l) => l.event === "parameter_parse_error");
  const widgetEvents = logs.filter((l) => l.event.startsWith("widget_"));

  const avgResponseTime =
    successLogs.length > 0
      ? (successLogs.reduce((sum, l) => sum + (l.responseTime || 0), 0) /
          successLogs.length).toFixed(0)
      : "N/A";

  const paramUsage: Record<string, number> = {};
  const zipDist: Record<string, number> = {};
  const loanTypeDist: Record<string, number> = {};
  
  successLogs.forEach((log) => {
    if (log.params) {
      Object.keys(log.params).forEach((key) => {
        if (log.params[key] !== undefined) {
          paramUsage[key] = (paramUsage[key] || 0) + 1;
          if (key === "zip_code") {
            const zip = String(log.params[key]);
            zipDist[zip] = (zipDist[zip] || 0) + 1;
          }
          if (key === "loan_type") {
            const lt = String(log.params[key]);
            loanTypeDist[lt] = (loanTypeDist[lt] || 0) + 1;
          }
        }
      });
    }
  });
  
  const widgetInteractions: Record<string, number> = {};
  widgetEvents.forEach((log) => {
    const humanName = humanizeEventName(log.event);
    widgetInteractions[humanName] = (widgetInteractions[humanName] || 0) + 1;
  });
  
  // Category selections count
  const categorySelections: Record<string, number> = {};
  widgetEvents.filter(l => l.event === "widget_filter_category_change").forEach((log) => {
    if (log.to) {
      categorySelections[log.to] = (categorySelections[log.to] || 0) + 1;
    }
  });
  
  // Age selections count
  const ageSelections: Record<string, number> = {};
  widgetEvents.filter(l => l.event === "widget_filter_age_change").forEach((log) => {
    if (log.to) {
      ageSelections[log.to] = (ageSelections[log.to] || 0) + 1;
    }
  });
  
  // Sort selections count
  const sortSelections: Record<string, number> = {};
  widgetEvents.filter(l => l.event === "widget_filter_sort_change").forEach((log) => {
    if (log.to) {
      sortSelections[log.to] = (sortSelections[log.to] || 0) + 1;
    }
  });
  
  // Clicks per settlement
  const settlementClicks: Record<string, { name: string; count: number }> = {};
  widgetEvents.filter(l => l.event === "widget_file_claim_click").forEach((log) => {
    if (log.settlementId) {
      if (!settlementClicks[log.settlementId]) {
        settlementClicks[log.settlementId] = { name: log.settlementName || log.settlementId, count: 0 };
      }
      settlementClicks[log.settlementId].count++;
    }
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Auto Loan Calculator Analytics</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #1a1a1a; margin-bottom: 10px; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .card h2 { font-size: 14px; color: #666; text-transform: uppercase; margin-bottom: 10px; }
    .card .value { font-size: 32px; font-weight: bold; color: #1a1a1a; }
    .card.error .value { color: #dc2626; }
    .card.success .value { color: #16a34a; }
    .card.warning .value { color: #ea580c; }
    table { width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e5e5; }
    th { background: #f9fafb; font-weight: 600; color: #374151; font-size: 12px; text-transform: uppercase; }
    td { color: #1f2937; font-size: 14px; }
    tr:last-child td { border-bottom: none; }
    .error-row { background: #fef2f2; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    .timestamp { color: #9ca3af; font-size: 12px; }
    td strong { color: #1f2937; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Auto Loan Calculator Analytics</h1>
    <p class="subtitle">Last 7 days • Auto-refresh every 60s</p>
    
    <div class="grid">
      <div class="card success">
        <h2>Total Calls</h2>
        <div class="value">${successLogs.length}</div>
      </div>
      <div class="card error">
        <h2>Errors</h2>
        <div class="value">${errorLogs.length}</div>
      </div>
      <div class="card warning">
        <h2>Parse Errors</h2>
        <div class="value">${parseLogs.length}</div>
      </div>
      <div class="card">
        <h2>Avg Response Time</h2>
        <div class="value">${avgResponseTime}<span style="font-size: 16px; color: #666;">ms</span></div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>Parameter Usage</h2>
      <table>
        <thead><tr><th>Parameter</th><th>Times Used</th><th>Usage %</th></tr></thead>
        <tbody>
          ${Object.entries(paramUsage)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([param, count]) => `
            <tr>
              <td><code>${param}</code></td>
              <td>${count}</td>
              <td>${((count / successLogs.length) * 100).toFixed(1)}%</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="grid" style="margin-bottom: 20px;">
      <div class="card">
        <h2>ZIP Code Distribution</h2>
        <table>
          <thead><tr><th>ZIP Code</th><th>Count</th></tr></thead>
          <tbody>
            ${Object.entries(zipDist).length > 0 ? Object.entries(zipDist)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([zip, count]) => `
              <tr>
                <td>${zip}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
      
      <div class="card">
        <h2>Loan Types</h2>
        <table>
          <thead><tr><th>Loan Type</th><th>Count</th></tr></thead>
          <tbody>
            ${Object.entries(loanTypeDist).length > 0 ? Object.entries(loanTypeDist)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([lt, count]) => `
              <tr>
                <td>${lt}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>Widget Interactions</h2>
      <table>
        <thead><tr><th>Action</th><th>Count</th></tr></thead>
        <tbody>
          ${Object.entries(widgetInteractions).length > 0 ? Object.entries(widgetInteractions)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([action, count]) => `
            <tr>
              <td>${action}</td>
              <td>${count}</td>
            </tr>
          `
            )
            .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="grid" style="margin-bottom: 20px;">
      <div class="card">
        <h2>Category Selections</h2>
        <table>
          <thead><tr><th>Category</th><th>Selections</th></tr></thead>
          <tbody>
            ${Object.entries(categorySelections).length > 0 ? Object.entries(categorySelections)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([category, count]) => `
              <tr>
                <td>${category}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
      
      <div class="card">
        <h2>Age Range Selections</h2>
        <table>
          <thead><tr><th>Age Range</th><th>Selections</th></tr></thead>
          <tbody>
            ${Object.entries(ageSelections).length > 0 ? Object.entries(ageSelections)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([age, count]) => `
              <tr>
                <td>${age}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid" style="margin-bottom: 20px;">
      <div class="card">
        <h2>Sort Selections</h2>
        <table>
          <thead><tr><th>Sort By</th><th>Selections</th></tr></thead>
          <tbody>
            ${Object.entries(sortSelections).length > 0 ? Object.entries(sortSelections)
              .sort((a, b) => b[1] - a[1])
              .map(
                ([sort, count]) => `
              <tr>
                <td>${sort}</td>
                <td>${count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
      
      <div class="card">
        <h2>File Claim Clicks by Settlement</h2>
        <table>
          <thead><tr><th>Settlement</th><th>Clicks</th></tr></thead>
          <tbody>
            ${Object.entries(settlementClicks).length > 0 ? Object.entries(settlementClicks)
              .sort((a, b) => b[1].count - a[1].count)
              .slice(0, 10)
              .map(
                ([id, data]) => `
              <tr>
                <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${data.name}</td>
                <td>${data.count}</td>
              </tr>
            `
              )
              .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No data yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>User Queries (Inferred from Tool Calls)</h2>
      <table>
        <thead><tr><th>Date</th><th>Query</th><th>Location</th><th>Locale</th></tr></thead>
        <tbody>
          ${successLogs.length > 0 ? successLogs
            .slice(0, 20)
            .map(
              (log) => `
            <tr>
              <td class="timestamp" style="white-space: nowrap;">${new Date(log.timestamp).toLocaleString()}</td>
              <td style="max-width: 400px;">${log.inferredQuery || "general search"}</td>
              <td style="font-size: 12px; color: #6b7280;">${log.userLocation ? `${log.userLocation.city || ''}, ${log.userLocation.region || ''}, ${log.userLocation.country || ''}`.replace(/^, |, $/g, '') : '—'}</td>
              <td style="font-size: 12px; color: #6b7280;">${log.userLocale || '—'}</td>
            </tr>
          `
            )
            .join("") : '<tr><td colspan="4" style="text-align: center; color: #9ca3af;">No queries yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>User Feedback</h2>
      <table>
        <thead><tr><th>Date</th><th>Feedback</th></tr></thead>
        <tbody>
          ${logs.filter(l => l.event === "widget_user_feedback").length > 0 ? logs
            .filter(l => l.event === "widget_user_feedback")
            .slice(0, 20)
            .map(
              (log) => `
            <tr>
              <td class="timestamp" style="white-space: nowrap;">${new Date(log.timestamp).toLocaleString()}</td>
              <td style="max-width: 600px;">${log.feedback || "—"}</td>
            </tr>
          `
            )
            .join("") : '<tr><td colspan="2" style="text-align: center; color: #9ca3af;">No feedback yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Recent Events (Last 50)</h2>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead>
        <tbody>
          ${logs
            .slice(0, 50)
            .map(
              (log) => `
            <tr class="${log.event.includes("error") ? "error-row" : ""}">
              <td class="timestamp">${new Date(log.timestamp).toLocaleString()}</td>
              <td><strong>${humanizeEventName(log.event)}</strong></td>
              <td style="font-size: 12px; max-width: 600px; overflow: hidden; text-overflow: ellipsis;">${formatEventDetails(log)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </div>
  <script>setTimeout(() => location.reload(), 60000);</script>
</body>
</html>`;
}

async function handleAnalytics(req: IncomingMessage, res: ServerResponse) {
  if (!checkAnalyticsAuth(req)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Analytics Dashboard"',
      "Content-Type": "text/plain",
    });
    res.end("Authentication required");
    return;
  }

  try {
    const logs = getRecentLogs(7);
    const html = generateAnalyticsDashboard(logs);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } catch (error) {
    console.error("Analytics error:", error);
    res.writeHead(500).end("Failed to generate analytics");
  }
}

async function handleTrackEvent(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const { event, data } = JSON.parse(body);

    if (!event) {
      res.writeHead(400).end(JSON.stringify({ error: "Missing event name" }));
      return;
    }

    logAnalytics(`widget_${event}`, data || {});

    res.writeHead(200).end(JSON.stringify({ success: true }));
  } catch (error) {
    console.error("Track event error:", error);
    res.writeHead(500).end(JSON.stringify({ error: "Failed to track event" }));
  }
}

// Turnstile verification
async function verifyTurnstile(token: string): Promise<boolean> {
  const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
  
  // Accept fallback tokens when Turnstile fails to load (e.g., in iframes)
  if (token === 'auto-verified-fallback' || token === 'error-fallback' || token === 'render-error-fallback') {
    console.warn(`Turnstile fallback used: ${token}`);
    return true; // Allow subscription to proceed
  }
  
  if (!TURNSTILE_SECRET_KEY) {
    console.error("TURNSTILE_SECRET_KEY not set in environment variables");
    return false;
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
      }),
    });

    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return false;
  }
}

// Buttondown API integration
async function subscribeToButtondown(email: string, settlementId: string, settlementName: string, deadline: string | null) {
  const BUTTONDOWN_API_KEY = process.env.BUTTONDOWN_API_KEY;
  
  if (!BUTTONDOWN_API_KEY) {
    throw new Error("BUTTONDOWN_API_KEY not set in environment variables");
  }

  const metadata: Record<string, any> = {
    settlementName,
    subscribedAt: new Date().toISOString(),
  };

  // Only add deadline if it's provided (not null for global notifications)
  if (deadline) {
    metadata.deadline = deadline;
  }

  const response = await fetch("https://api.buttondown.email/v1/subscribers", {
    method: "POST",
    headers: {
      "Authorization": `Token ${BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: email,
      tags: [settlementId],
      metadata,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = "Failed to subscribe";
    
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.detail) {
        errorMessage = errorData.detail;
      } else if (errorData.code) {
        errorMessage = `Error: ${errorData.code}`;
      }
    } catch {
      errorMessage = errorText;
    }
    
    throw new Error(errorMessage);
  }

  return await response.json();
}

// Update existing subscriber with new settlement
async function updateButtondownSubscriber(email: string, settlementId: string, settlementName: string, deadline: string | null) {
  const BUTTONDOWN_API_KEY = process.env.BUTTONDOWN_API_KEY;
  
  if (!BUTTONDOWN_API_KEY) {
    throw new Error("BUTTONDOWN_API_KEY not set in environment variables");
  }

  // First, get the subscriber ID
  const searchResponse = await fetch(`https://api.buttondown.email/v1/subscribers?email=${encodeURIComponent(email)}`, {
    method: "GET",
    headers: {
      "Authorization": `Token ${BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!searchResponse.ok) {
    throw new Error("Failed to find subscriber");
  }

  const subscribers = await searchResponse.json();
  if (!subscribers.results || subscribers.results.length === 0) {
    throw new Error("Subscriber not found");
  }

  const subscriber = subscribers.results[0];
  const subscriberId = subscriber.id;

  // Update the subscriber with new tag and metadata
  const existingTags = subscriber.tags || [];
  const existingMetadata = subscriber.metadata || {};

  // Add new settlement to tags if not already there
  const updatedTags = existingTags.includes(settlementId) ? existingTags : [...existingTags, settlementId];

  // Add new settlement to metadata (Buttondown requires string values)
  const settlementKey = `settlement_${settlementId}`;
  const settlementData = JSON.stringify({
    name: settlementName,
    deadline: deadline,
    subscribedAt: new Date().toISOString(),
  });
  
  const updatedMetadata = {
    ...existingMetadata,
    [settlementKey]: settlementData,
  };

  const updateResponse = await fetch(`https://api.buttondown.email/v1/subscribers/${subscriberId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Token ${BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tags: updatedTags,
      metadata: updatedMetadata,
    }),
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    throw new Error(`Failed to update subscriber: ${errorText}`);
  }

  return await updateResponse.json();
}

async function handleSubscribe(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    const { email, settlementId, settlementName, deadline, turnstileToken } = JSON.parse(body);

    if (!email || !email.includes("@")) {
      res.writeHead(400).end(JSON.stringify({ error: "Invalid email address" }));
      return;
    }

    if (!settlementId || !settlementName) {
      res.writeHead(400).end(JSON.stringify({ error: "Missing required fields" }));
      return;
    }

    // Verify Turnstile token
    if (!turnstileToken) {
      res.writeHead(400).end(JSON.stringify({ error: "Security verification required" }));
      return;
    }

    const isValidToken = await verifyTurnstile(turnstileToken);
    if (!isValidToken) {
      res.writeHead(400).end(JSON.stringify({ error: "Security verification failed. Please try again." }));
      return;
    }

    const BUTTONDOWN_API_KEY_PRESENT = !!process.env.BUTTONDOWN_API_KEY;
    if (!BUTTONDOWN_API_KEY_PRESENT) {
      res.writeHead(500).end(JSON.stringify({ error: "Server misconfigured: BUTTONDOWN_API_KEY missing" }));
      return;
    }

    try {
      await subscribeToButtondown(email, settlementId, settlementName, deadline || null);
      res.writeHead(200).end(JSON.stringify({ 
        success: true, 
        message: "Successfully subscribed! You'll receive a reminder before the deadline." 
      }));
    } catch (subscribeError: any) {
      const rawMessage = String(subscribeError?.message ?? "").trim();
      const msg = rawMessage.toLowerCase();
      const already = msg.includes('already subscribed') || msg.includes('already exists') || msg.includes('already on your list') || msg.includes('subscriber already exists') || msg.includes('already');

      if (already) {
        console.log("Subscriber already on list, attempting update", { email, settlementId, message: rawMessage });
        try {
          await updateButtondownSubscriber(email, settlementId, settlementName, deadline || null);
          res.writeHead(200).end(JSON.stringify({ 
            success: true, 
            message: "Settlement added to your subscriptions!" 
          }));
        } catch (updateError: any) {
          console.warn("Update subscriber failed, returning graceful success", {
            email,
            settlementId,
            error: updateError?.message,
          });
          res.writeHead(200).end(JSON.stringify({
            success: true,
            message: "You're already subscribed! We'll keep you posted.",
          }));
        }
        return;
      }

      throw subscribeError;
    }
  } catch (error: any) {
    console.error("Subscribe error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    res.writeHead(500).end(JSON.stringify({ 
      error: error.message || "Failed to subscribe. Please try again." 
    }));
  }
}

async function handleSseRequest(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const server = createMortgageCalculatorServer();
  const transport = new SSEServerTransport(postPath, res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });

  transport.onclose = async () => {
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to process message", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const httpServer = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (
      req.method === "OPTIONS" &&
      (url.pathname === ssePath || url.pathname === postPath)
    ) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === healthPath) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("OK");
      return;
    }

    if (req.method === "GET" && url.pathname === ssePath) {
      await handleSseRequest(res);
      return;
    }

    if (req.method === "POST" && url.pathname === postPath) {
      await handlePostMessage(req, res, url);
      return;
    }

    if (url.pathname === subscribePath) {
      await handleSubscribe(req, res);
      return;
    }

    if (url.pathname === ratePath) {
      await handleRate(req, res);
      return;
    }

    if (url.pathname === analyticsPath) {
      await handleAnalytics(req, res);
      return;
    }

    if (url.pathname === trackEventPath) {
      await handleTrackEvent(req, res);
      return;
    }

    // Serve alias for legacy loader path -> our main widget HTML
    if (req.method === "GET" && url.pathname === "/assets/mortgage-calculator-2d2b.html") {
      const mainAssetPath = path.join(ASSETS_DIR, "auto-loan-calculator.html");
      if (fs.existsSync(mainAssetPath) && fs.statSync(mainAssetPath).isFile()) {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
        });
        fs.createReadStream(mainAssetPath).pipe(res);
        return;
      }
    }

    // Serve static assets from /assets directory
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const assetPath = path.join(ASSETS_DIR, url.pathname.slice(8));
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const ext = path.extname(assetPath);
        const contentType = ext === ".js" ? "application/javascript" : 
                           ext === ".css" ? "text/css" : 
                           ext === ".html" ? "text/html" : "application/octet-stream";
        res.writeHead(200, { 
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        });

        // If serving the main widget HTML, inject the current rate into the badge
        if (ext === ".html" && path.basename(assetPath) === "auto-loan-calculator.html") {
          try {
            let html = fs.readFileSync(assetPath, "utf8");
            // Compute the current rate (prefer cache, otherwise fetch)
            let displayRate: number | null = null;
            if (fredRateCache && fredRateCache.payload && typeof fredRateCache.payload.ratePercent === "number") {
              displayRate = fredRateCache.payload.ratePercent;
            } else {
              const latest = await fetchFredLatestRate();
              if (latest) {
                displayRate = Math.round((latest.adjusted) * 10) / 10;
              }
            }
            // Only inject if we have a valid live rate. Otherwise leave blank.
            if (displayRate != null && Number.isFinite(displayRate)) {
              const rateText = `${displayRate}%`;
              html = html.replace(
                /(<span\s+class=\"rate-num\">)([^<]*?)(<\/span>)/,
                (_m: any, p1: string, _p2: string, p3: string) => `${p1}${rateText}${p3}`
              );
            }
            res.end(html);
            return;
          } catch (e) {
            // Fallback to streaming the file unchanged if anything goes wrong
          }
        }

        fs.createReadStream(assetPath).pipe(res);
        return;
      }
    }

    res.writeHead(404).end("Not Found");
  }
);

httpServer.on("clientError", (err: Error, socket) => {
  console.error("HTTP client error", err);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

httpServer.listen(port, () => {
  console.log(`Auto Loan Calculator MCP server listening on http://localhost:${port}`);
  console.log(`  SSE stream: GET http://localhost:${port}${ssePath}`);
  console.log(
    `  Message post endpoint: POST http://localhost:${port}${postPath}?sessionId=...`
  );
});
