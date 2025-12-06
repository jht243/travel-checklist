import React, { useState } from "react";
import { createRoot } from "react-dom/client";

import RetirementCalculatorHelloWorld from "./component";
import PortfolioSimulator from "./PortfolioSimulator";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Widget Error Boundary caught error:", error, errorInfo);
    // Log to server
    try {
        fetch("/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                event: "crash",
                data: {
                    error: error?.message || "Unknown error",
                    stack: error?.stack,
                    componentStack: errorInfo?.componentStack
                }
            })
        }).catch(e => console.error("Failed to report crash", e));
    } catch (e) {
        // Ignore reporting errors
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, textAlign: "center", fontFamily: "sans-serif", color: "#DC2626", wordBreak: "break-word" }}>
          <h3>Something went wrong.</h3>
          <p>Please try refreshing the page.</p>
          {/* Debug Info */}
          <details style={{ marginTop: 10, textAlign: "left", fontSize: "12px", color: "#666" }}>
            <summary>Debug Error Details</summary>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 10, borderRadius: 4 }}>
              {(this.state as any).error?.toString()}
              <br />
              {(this.state as any).error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

// Add hydration type definitions
interface OpenAIGlobals {
  toolOutput?: any;
  structuredContent?: any;
  toolInput?: any;
  result?: {
    structuredContent?: any;
  };
}

// Hydration Helper
const getHydrationData = (): any => {
  console.log("[Hydration] Starting hydration check...");
  
  // Check for window.openai
  if (typeof window === 'undefined') {
    console.log("[Hydration] Window is undefined");
    return {};
  }
  
  const oa = (window as any).openai as OpenAIGlobals;
  if (!oa) {
    console.log("[Hydration] window.openai not found, rendering with defaults");
    return {};
  }

  console.log("[Hydration] window.openai found:", Object.keys(oa));

  // Prioritize sources as per reference implementation
  const candidates = [
    oa.toolOutput,
    oa.structuredContent,
    oa.result?.structuredContent,
    oa.toolInput
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) {
      console.log("[Hydration] Found data:", candidate);
      return candidate;
    }
  }
  
  console.log("[Hydration] No data found in any candidate source");
  return {};
};

console.log("[Main] Retirement Calculator main.tsx loading...");

// App wrapper with tool switching
const COLORS = {
  primary: "#56C596",
  primaryDark: "#3aa87b",
  bg: "#FAFAFA",
  textMain: "#1A1A1A",
  textSecondary: "#9CA3AF",
  border: "#F3F4F6",
  accentLight: "#E6F7F0",
  blue: "#5D9CEC"
};

function AppWithToolSwitcher({ initialData }: { initialData: any }) {
  const [activeTool, setActiveTool] = useState<"retirement" | "portfolio">("retirement");

  return (
    <div style={{ backgroundColor: COLORS.bg, minHeight: "100vh" }}>
      {/* Tool Switcher Tabs */}
      <div style={{
        maxWidth: "600px",
        margin: "0 auto",
        padding: "20px 20px 0 20px",
        fontFamily: "'Inter', sans-serif"
      }}>
        <div style={{
          display: "flex",
          backgroundColor: COLORS.border,
          borderRadius: "16px",
          padding: "4px",
          marginBottom: "20px"
        }}>
          <button
            onClick={() => setActiveTool("retirement")}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "12px",
              border: "none",
              backgroundColor: activeTool === "retirement" ? "white" : "transparent",
              color: activeTool === "retirement" ? COLORS.textMain : COLORS.textSecondary,
              fontWeight: 700,
              fontSize: "14px",
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: activeTool === "retirement" ? "0 2px 8px rgba(0,0,0,0.08)" : "none"
            }}
          >
            🏦 Retirement Planner
          </button>
          <button
            onClick={() => setActiveTool("portfolio")}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: "12px",
              border: "none",
              backgroundColor: activeTool === "portfolio" ? "white" : "transparent",
              color: activeTool === "portfolio" ? COLORS.textMain : COLORS.textSecondary,
              fontWeight: 700,
              fontSize: "14px",
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: activeTool === "portfolio" ? "0 2px 8px rgba(0,0,0,0.08)" : "none"
            }}
          >
            📊 Portfolio Simulator
          </button>
        </div>
      </div>

      {/* Render Active Tool */}
      {activeTool === "retirement" ? (
        <RetirementCalculatorHelloWorld initialData={initialData} />
      ) : (
        <PortfolioSimulator initialData={initialData} />
      )}
    </div>
  );
}

// Get initial data
const container = document.getElementById("retirement-calculator-root");

if (!container) {
  throw new Error("retirement-calculator-root element not found");
}

const root = createRoot(container);

const renderApp = (data: any) => {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppWithToolSwitcher key={Date.now()} initialData={data} />
      </ErrorBoundary>
    </React.StrictMode>
  );
};

// Initial render
const initialData = getHydrationData();
renderApp(initialData);

// Listen for late hydration events (Apps SDK pattern)
window.addEventListener('openai:set_globals', (ev: any) => {
  const globals = ev?.detail?.globals;
  if (globals) {
    console.log("[Hydration] Late event received:", globals);
    
    // Extract data from the event globals similar to getHydrationData
    const candidates = [
      globals.toolOutput,
      globals.structuredContent,
      globals.result?.structuredContent,
      globals.toolInput
    ];
    
    for (const candidate of candidates) {
       if (candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) {
          console.log("[Hydration] Re-rendering with late data:", candidate);
          // Force re-mount by changing key, ensuring initialData is applied fresh
          renderApp(candidate);
          return;
       }
    }
  }
});
