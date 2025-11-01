import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// OpenAI SDK types (from the documentation)
type DisplayMode = "pip" | "inline" | "fullscreen";
type Theme = "light" | "dark";

interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface SafeArea {
  insets: SafeAreaInsets;
}

interface DeviceType {
  type: "mobile" | "tablet" | "desktop" | "unknown";
  capabilities: {
    hover: boolean;
    touch: boolean;
  };
}

interface UserAgent {
  device: DeviceType;
}

interface ToolInput {
  purchasePrice?: number;
  interestRate?: number;
  loanTerm?: number;
}

interface ToolOutput {
  monthlyPayment?: number;
  totalInterest?: number;
  totalCost?: number;
}

interface WidgetState {
  purchasePrice: number;
  interestRate: number;
  loanTerm: number;
}

interface OpenAiGlobals {
  theme: Theme;
  userAgent: UserAgent;
  locale: string;
  maxHeight: number;
  displayMode: DisplayMode;
  safeArea: SafeArea;
  toolInput: ToolInput;
  toolOutput: ToolOutput | null;
  widgetState: WidgetState | null;
}

interface OpenAiAPI {
  callTool: (name: string, args: Record<string, unknown>) => Promise<any>;
  sendFollowUpMessage: (args: { prompt: string }) => Promise<void>;
  openExternal: (payload: { href: string }) => void;
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<{ mode: DisplayMode }>;
  setWidgetState: (state: WidgetState) => Promise<void>;
}

declare global {
  interface Window {
    openai: OpenAiAPI & { globals: OpenAiGlobals };
  }
}

function MortgageCalculator() {
  // Initialize state from tool input or widget state
  const [purchasePrice, setPurchasePrice] = useState<number>(
    window.openai.globals.toolInput?.purchasePrice || window.openai.globals.widgetState?.purchasePrice || 350000
  );
  const [interestRate, setInterestRate] = useState<number>(
    window.openai.globals.toolInput?.interestRate || window.openai.globals.widgetState?.interestRate || 7.0
  );
  const [loanTerm, setLoanTerm] = useState<number>(
    window.openai.globals.toolInput?.loanTerm || window.openai.globals.widgetState?.loanTerm || 30
  );

  const [monthlyPayment, setMonthlyPayment] = useState<number>(0);
  const [totalInterest, setTotalInterest] = useState<number>(0);
  const [totalCost, setTotalCost] = useState<number>(0);

  // Calculate mortgage payment
  const calculateMortgage = () => {
    const principal = purchasePrice;
    const monthlyRate = interestRate / 100 / 12;
    const numberOfPayments = loanTerm * 12;

    if (monthlyRate === 0) {
      // Simple interest calculation for 0% rate
      const payment = principal / numberOfPayments;
      setMonthlyPayment(payment);
      setTotalInterest(0);
      setTotalCost(principal);
    } else {
      // Standard mortgage calculation
      const payment = (principal * monthlyRate * Math.pow(1 + monthlyRate, numberOfPayments)) /
                     (Math.pow(1 + monthlyRate, numberOfPayments) - 1);

      const totalPaid = payment * numberOfPayments;
      const totalInterestPaid = totalPaid - principal;

      setMonthlyPayment(payment);
      setTotalInterest(totalInterestPaid);
      setTotalCost(totalPaid);
    }
  };

  // Calculate on mount and when inputs change
  useEffect(() => {
    calculateMortgage();
  }, [purchasePrice, interestRate, loanTerm]);

  // Save widget state when it changes
  useEffect(() => {
    const state = { purchasePrice, interestRate, loanTerm };
    window.openai.setWidgetState(state).catch(console.error);
  }, [purchasePrice, interestRate, loanTerm]);

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '400px',
      margin: '0 auto',
      padding: '20px',
      backgroundColor: window.openai.globals.theme === 'dark' ? '#1a1a1a' : '#ffffff',
      color: window.openai.globals.theme === 'dark' ? '#ffffff' : '#000000',
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
    }}>
      <h2 style={{ marginBottom: '20px', textAlign: 'center' }}>🏠 Mortgage Calculator</h2>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
          Purchase Price ($)
        </label>
        <input
          type="number"
          value={purchasePrice}
          onChange={(e) => setPurchasePrice(Number(e.target.value))}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '16px'
          }}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
          Interest Rate (%)
        </label>
        <input
          type="number"
          step="0.1"
          value={interestRate}
          onChange={(e) => setInterestRate(Number(e.target.value))}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '16px'
          }}
        />
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
          Loan Term (years)
        </label>
        <input
          type="number"
          value={loanTerm}
          onChange={(e) => setLoanTerm(Number(e.target.value))}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '16px'
          }}
        />
      </div>

      <div style={{
        backgroundColor: window.openai.globals.theme === 'dark' ? '#2a2a2a' : '#f8f9fa',
        padding: '16px',
        borderRadius: '4px',
        marginBottom: '16px'
      }}>
        <h3 style={{ marginBottom: '12px', fontSize: '18px' }}>Payment Summary</h3>

        <div style={{ marginBottom: '8px' }}>
          <strong>Monthly Payment:</strong> ${monthlyPayment.toFixed(2)}
        </div>

        <div style={{ marginBottom: '8px' }}>
          <strong>Total Interest:</strong> ${totalInterest.toFixed(2)}
        </div>

        <div style={{ marginBottom: '8px' }}>
          <strong>Total Cost:</strong> ${totalCost.toFixed(2)}
        </div>
      </div>

      <button
        onClick={calculateMortgage}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '16px',
          cursor: 'pointer'
        }}
      >
        Recalculate
      </button>
    </div>
  );
}

// Mount the component
const container = document.getElementById('mortgage-calculator-root');
if (container) {
  const root = createRoot(container);
  root.render(<MortgageCalculator />);
} else {
  console.error('Root element not found');
}
