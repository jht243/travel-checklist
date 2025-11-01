import React from "react";
import { createRoot } from "react-dom/client";
import useEmblaCarousel from "embla-carousel-react";
import { useWidgetProps } from "../use-widget-props";
import { useMaxHeight } from "../use-max-height";
import { Star, ExternalLink, Calendar, DollarSign, Share2, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import settlementsData from "./settlements.json";

const TRACK_URL = 'https://class-action-settlement-finder.onrender.com/api/track';
const TURNSTILE_SITE_KEY = '0x4AAAAAAB88oeIlUFfNX1o7';

// Load Turnstile script
if (typeof window !== 'undefined' && !document.getElementById('turnstile-script')) {
  const script = document.createElement('script');
  script.id = 'turnstile-script';
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

// Turnstile component wrapper
function Turnstile({ onVerify, onError }) {
  const containerRef = React.useRef(null);
  const widgetIdRef = React.useRef(null);
  const hasVerifiedRef = React.useRef(false);

  React.useEffect(() => {
    if (!containerRef.current) return;

    // Timeout fallback: auto-verify after 5 seconds if Turnstile doesn't load
    const timeoutId = setTimeout(() => {
      if (!hasVerifiedRef.current) {
        console.warn('Turnstile did not load in time, auto-verifying...');
        onVerify('auto-verified-fallback');
        hasVerifiedRef.current = true;
      }
    }, 5000);

    const renderTurnstile = () => {
      if (window.turnstile && containerRef.current && !widgetIdRef.current) {
        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'light',
            size: 'invisible',
            callback: (token) => {
              if (!hasVerifiedRef.current) {
                clearTimeout(timeoutId);
                hasVerifiedRef.current = true;
                onVerify(token);
              }
            },
            'error-callback': () => {
              if (!hasVerifiedRef.current) {
                clearTimeout(timeoutId);
                hasVerifiedRef.current = true;
                // On error, auto-verify as fallback
                onVerify('error-fallback');
                if (onError) onError();
              }
            },
          });
        } catch (error) {
          console.error('Turnstile render error:', error);
          if (!hasVerifiedRef.current) {
            clearTimeout(timeoutId);
            hasVerifiedRef.current = true;
            onVerify('render-error-fallback');
          }
        }
      }
    };

    if (window.turnstile) {
      renderTurnstile();
    } else {
      const checkTurnstile = setInterval(() => {
        if (window.turnstile) {
          clearInterval(checkTurnstile);
          renderTurnstile();
        }
      }, 100);

      return () => {
        clearInterval(checkTurnstile);
        clearTimeout(timeoutId);
      };
    }

    return () => {
      clearTimeout(timeoutId);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (e) {
          console.error('Error removing Turnstile:', e);
        }
        widgetIdRef.current = null;
      }
    };
  }, [onVerify, onError]);

  return <div ref={containerRef} style={{ height: 0, overflow: 'hidden' }} />;
}

function trackEvent(event, data = {}) {
  fetch(TRACK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, data }),
  }).catch(() => {}); // Silent fail
}

function SettlementCard({ settlement, sharedTurnstileToken }) {
  const [showEmailInput, setShowEmailInput] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSubscribed, setIsSubscribed] = React.useState(false);
  const [error, setError] = React.useState('');
  const [alreadySubscribed, setAlreadySubscribed] = React.useState(false);

  // Load saved email from localStorage on mount and when email input is shown
  React.useEffect(() => {
    const savedEmail = localStorage.getItem('classActionEmail');
    if (savedEmail && !email) {
      setEmail(savedEmail);
    }
  }, [showEmailInput]);

  // Check if already subscribed to this settlement
  React.useEffect(() => {
    const subscribedSettlements = JSON.parse(localStorage.getItem('subscribedSettlements') || '[]');
    const isAlreadySubscribed = subscribedSettlements.includes(settlement.id);
    setAlreadySubscribed(isAlreadySubscribed);
  }, [settlement.id]);

  // Calculate urgency
  const getUrgency = (deadline) => {
    const daysUntil = Math.floor((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return { color: 'gray', bg: 'bg-gray-100', text: 'EXPIRED', textColor: 'text-gray-600' };
    if (daysUntil < 7) return { color: 'red', bg: 'bg-red-100', text: 'URGENT', textColor: 'text-red-700' };
    if (daysUntil < 30) return { color: 'yellow', bg: 'bg-yellow-100', text: 'SOON', textColor: 'text-yellow-700' };
    return { color: 'green', bg: 'bg-green-100', text: 'TIME', textColor: 'text-green-700' };
  };

  const urgency = getUrgency(settlement.deadline);

  const handleShare = async () => {
    trackEvent('share_click', { settlementId: settlement.id, settlementName: settlement.name });
    const shareText = `${settlement.name} - ${settlement.payout}\nDeadline: ${settlement.deadline}\n${settlement.claimUrl}`;
    
    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({ 
          title: settlement.name, 
          text: shareText, 
          url: settlement.claimUrl 
        });
      } catch (err) {
        // User cancelled share, ignore
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    } else {
      // Fallback to clipboard (desktop)
      try {
        await navigator.clipboard.writeText(shareText);
        alert('✅ Settlement details copied to clipboard!\n\nYou can now paste it anywhere to share.');
      } catch (err) {
        // Clipboard API failed, show the text in an alert as last resort
        alert('Share this settlement:\n\n' + shareText);
      }
    }
  };

  const handleNotifyMe = async () => {
    setError('');
    
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    if (!sharedTurnstileToken) {
      setError('Please wait for security verification to complete');
      return;
    }

    setIsSubmitting(true);
    console.log('Subscribing to settlement:', settlement.name, 'with email:', email);

    try {
      const response = await fetch('https://class-action-settlement-finder.onrender.com/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          settlementId: settlement.id,
          settlementName: settlement.name,
          deadline: settlement.deadline,
          turnstileToken: sharedTurnstileToken,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('✅ Successfully subscribed to:', settlement.name);
        trackEvent('notify_me_subscribe', { settlementId: settlement.id, settlementName: settlement.name });
        // Save email to localStorage for future use
        localStorage.setItem('classActionEmail', email);
        // Mark this settlement as subscribed
        const subscribedSettlements = JSON.parse(localStorage.getItem('subscribedSettlements') || '[]');
        if (!subscribedSettlements.includes(settlement.id)) {
          subscribedSettlements.push(settlement.id);
          localStorage.setItem('subscribedSettlements', JSON.stringify(subscribedSettlements));
        }
        setIsSubscribed(true);
        setAlreadySubscribed(true);
        setError('');
      } else {
        console.error('❌ Subscription failed:', data.error);
        
        // Check if it's the "already subscribed but not confirmed" error
        if (data.error && data.error.includes('already subscribed') && data.error.includes('not confirmed')) {
          // Still show success locally
          console.log('📧 Email pending confirmation, showing success...');
          localStorage.setItem('classActionEmail', email);
          // Mark this settlement as subscribed
          const subscribedSettlements = JSON.parse(localStorage.getItem('subscribedSettlements') || '[]');
          if (!subscribedSettlements.includes(settlement.id)) {
            subscribedSettlements.push(settlement.id);
            localStorage.setItem('subscribedSettlements', JSON.stringify(subscribedSettlements));
          }
          setIsSubscribed(true);
          setAlreadySubscribed(true);
          setError('');
        } else {
          // Other errors - show error message
          setError(data.error || 'Failed to subscribe');
        }
      }
    } catch (error) {
      console.error('❌ Subscribe error:', error);
      setError('Failed to subscribe. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 min-w-[450px] max-w-[450px] w-full">
      <div className="p-4">
        <div className="flex gap-4 items-start">
          <img
            src={settlement.thumbnail}
            alt={settlement.name}
            className="h-20 w-20 rounded-lg object-cover flex-none"
          />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-lg leading-tight mb-1">
              {settlement.name}
            </div>
            <div className="text-sm text-black/60 line-clamp-2 mb-2">
              {settlement.description}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-1 text-green-700 bg-green-50 px-2 py-1 rounded-full">
                <DollarSign className="h-3 w-3" />
                <span className="font-medium">{settlement.payout}</span>
              </div>
              <div className="flex items-center gap-1 text-orange-700 bg-orange-50 px-2 py-1 rounded-full">
                <Calendar className="h-3 w-3" />
                <span className="font-medium">{settlement.deadline}</span>
              </div>
              <div className={`flex items-center gap-1 ${urgency.textColor} ${urgency.bg} px-2 py-1 rounded-full font-bold`}>
                {urgency.text}
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-3 pt-3 border-t border-black/5">
          <div className="text-xs text-black/50 mb-2">
            <strong>Eligibility:</strong> {settlement.eligibility}
          </div>
          <div className="flex gap-2">
            <a
              href={settlement.claimUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('file_claim_click', { settlementId: settlement.id, settlementName: settlement.name })}
              className="flex items-center justify-center gap-2 flex-1 bg-black hover:bg-gray-800 text-white font-medium py-2.5 px-4 rounded-lg transition"
            >
              File My Claim
              <ExternalLink className="h-4 w-4" />
            </a>
            <button
              onClick={() => !alreadySubscribed && setShowEmailInput(true)}
              disabled={alreadySubscribed}
              className={`flex items-center justify-center gap-2 font-medium py-2.5 px-4 rounded-lg transition whitespace-nowrap ${
                alreadySubscribed 
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
              title={alreadySubscribed ? 'Already subscribed' : 'Get reminder before deadline'}
            >
              {alreadySubscribed ? '✅ Subscribed' : '🔔 Remind Me'}
            </button>
            <button
              onClick={handleShare}
              className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 px-4 rounded-lg transition"
              title="Share this settlement"
            >
              <Share2 className="h-4 w-4" />
            </button>
          </div>
          
          {/* Email Input Section */}
          <div className="mt-3">
            {isSubscribed ? (
              <div className="w-full flex items-center justify-between gap-2 bg-green-100 text-green-700 font-medium py-2 px-4 rounded-lg border border-green-300">
                <span>✅ Subscribed! You'll receive a reminder before the deadline.</span>
                <button
                  onClick={() => {
                    setIsSubscribed(false);
                    setShowEmailInput(false);
                  }}
                  className="text-green-700 hover:text-green-900 font-bold"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            ) : showEmailInput ? (
              <div>
                {email && localStorage.getItem('classActionEmail') === email && (
                  <p className="text-xs text-gray-600 mb-2">📧 Using saved email: <span className="font-medium">{email}</span></p>
                )}
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleNotifyMe()}
                    disabled={isSubmitting}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={handleNotifyMe}
                    disabled={isSubmitting || !sharedTurnstileToken}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white font-medium py-2 px-4 rounded-lg transition flex items-center gap-2"
                  >
                    {!sharedTurnstileToken ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Verifying...
                      </>
                    ) : isSubmitting ? 'Sending...' : 'Remind Me'}
                  </button>
                  <button
                    onClick={() => { setShowEmailInput(false); setEmail(''); }}
                    disabled={isSubmitting}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-3 rounded-lg transition"
                  >
                    ✕
                  </button>
                </div>
                {error && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-600">❌ {error}</p>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">By providing your email you give us permission to email you regarding upcoming class action lawsuits.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const CATEGORIES = ["All", "Technology", "Healthcare", "Financial", "Consumer", "Retail"];
const US_STATES = ["US", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
const AGE_RANGES = [
  { label: "All Ages", min: null, max: null },
  { label: "18-25", min: 18, max: 25 },
  { label: "26-45", min: 26, max: 45 },
  { label: "46-65", min: 46, max: 65 },
  { label: "65+", min: 65, max: 99 }
];

export default function ClassActionFinder() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ dragFree: true, loop: false });
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);
  const widgetProps = useWidgetProps();
  
  const [selectedCategory, setSelectedCategory] = React.useState(widgetProps?.category || "All");
  const [ageRangeIndex, setAgeRangeIndex] = React.useState(0);
  const [userLocation, setUserLocation] = React.useState(widgetProps?.state || "US");
  React.useEffect(() => {
    const categoryFromProps = widgetProps?.category;
    if (categoryFromProps) {
      setSelectedCategory(categoryFromProps);
    } else if (categoryFromProps === undefined || categoryFromProps === null) {
      setSelectedCategory("All");
    }
  }, [widgetProps?.category]);
  const [sortBy, setSortBy] = React.useState("deadline");
  const [showFeedback, setShowFeedback] = React.useState(false);
  const [feedbackText, setFeedbackText] = React.useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = React.useState(false);
  const [showGlobalNotify, setShowGlobalNotify] = React.useState(false);
  const [globalEmail, setGlobalEmail] = React.useState('');
  const [isGlobalSubmitting, setIsGlobalSubmitting] = React.useState(false);
  const [isGlobalSubscribed, setIsGlobalSubscribed] = React.useState(false);
  const [globalError, setGlobalError] = React.useState('');
  const [sharedTurnstileToken, setSharedTurnstileToken] = React.useState('');
  const maxHeight = useMaxHeight() ?? undefined;

  // Load saved email from localStorage on mount
  React.useEffect(() => {
    const savedEmail = localStorage.getItem('classActionEmail');
    if (savedEmail) {
      setGlobalEmail(savedEmail);
    }
  }, []);
  const allSettlements = settlementsData.settlements;

  const handleScrollPrev = React.useCallback(() => {
    trackEvent('carousel_prev');
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const handleScrollNext = React.useCallback(() => {
    trackEvent('carousel_next');
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const handleGlobalNotifySubmit = async () => {
    if (!globalEmail || !globalEmail.includes('@')) {
      setGlobalError('Please enter a valid email address');
      return;
    }

    if (!sharedTurnstileToken) {
      setGlobalError('Please wait for security verification to complete');
      return;
    }

    setIsGlobalSubmitting(true);
    setGlobalError('');

    try {
      const response = await fetch('https://class-action-settlement-finder.onrender.com/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: globalEmail,
          settlementId: 'global-notifications',
          settlementName: 'Global Class Action Notifications',
          deadline: null,
          turnstileToken: sharedTurnstileToken,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        trackEvent('global_notify_subscribe', { email: globalEmail });
        // Save email to localStorage for future use
        localStorage.setItem('classActionEmail', globalEmail);
        setIsGlobalSubscribed(true);
        setTimeout(() => {
          setShowGlobalNotify(false);
          setIsGlobalSubscribed(false);
        }, 3000);
      } else {
        setGlobalError(data.error || 'Failed to subscribe. Please try again.');
      }
    } catch (error) {
      console.error('Subscribe error:', error);
      setGlobalError('Failed to subscribe. Please check your connection and try again.');
    } finally {
      setIsGlobalSubmitting(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) {
      alert('Please enter some feedback');
      return;
    }

    try {
      await fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          event: 'user_feedback', 
          data: { feedback: feedbackText }
        }),
      });

      setFeedbackSubmitted(true);
      setTimeout(() => {
        setShowFeedback(false);
        setFeedbackText('');
        setFeedbackSubmitted(false);
      }, 2000);
    } catch (error) {
      alert('Failed to submit feedback. Please try again.');
    }
  };

  const updateScrollButtons = React.useCallback(() => {
    if (!emblaApi) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      return;
    }

    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) {
      return undefined;
    }

    updateScrollButtons();
    emblaApi.on("select", updateScrollButtons);
    emblaApi.on("reInit", updateScrollButtons);

    return () => {
      emblaApi.off("select", updateScrollButtons);
      emblaApi.off("reInit", updateScrollButtons);
    };
  }, [emblaApi, updateScrollButtons]);
  
  // Filter settlements based on category, age, and location
  let filteredSettlements = allSettlements;
  
  // Company name filter (from server parameter)
  if (widgetProps?.companyName) {
    const searchTerm = widgetProps.companyName.toLowerCase();
    filteredSettlements = filteredSettlements.filter(s => 
      s.name.toLowerCase().includes(searchTerm)
    );
  }
  
  // Deadline filter (from server parameter)
  if (widgetProps?.deadlineWithinDays) {
    const now = new Date();
    const maxDate = new Date(now.getTime() + (widgetProps.deadlineWithinDays * 24 * 60 * 60 * 1000));
    filteredSettlements = filteredSettlements.filter(s => {
      const deadline = new Date(s.deadline);
      return deadline >= now && deadline <= maxDate;
    });
  }
  
  // Category filter
  if (selectedCategory !== "All") {
    filteredSettlements = filteredSettlements.filter(s => s.category === selectedCategory);
  }
  
  // Age filter
  const selectedAgeRange = AGE_RANGES[ageRangeIndex];
  if (selectedAgeRange.min !== null) {
    filteredSettlements = filteredSettlements.filter(s => {
      // Check if the settlement's age range overlaps with the selected range
      return s.ageRange[1] >= selectedAgeRange.min && s.ageRange[0] <= selectedAgeRange.max;
    });
  }
  
  // Location filter
  if (userLocation !== "US") {
    filteredSettlements = filteredSettlements.filter(s => 
      s.location === "US" || s.location === userLocation
    );
  }
  
  // Sort settlements - expired ones go to the end
  const settlements = [...filteredSettlements].sort((a, b) => {
    const now = new Date();
    const aExpired = new Date(a.deadline) < now;
    const bExpired = new Date(b.deadline) < now;
    
    // If one is expired and the other isn't, expired goes to end
    if (aExpired && !bExpired) return 1;
    if (!aExpired && bExpired) return -1;
    
    // Both expired or both active - sort normally
    if (sortBy === "payout") {
      return b.payoutAmount - a.payoutAmount;
    } else {
      return new Date(a.deadline) - new Date(b.deadline);
    }
  });

  return (
    <div
      className="w-full bg-white overflow-hidden"
      style={{ maxHeight, height: maxHeight }}
    >
      {/* Global Turnstile - verify once for all forms */}
      <div style={{ position: 'absolute', left: '-9999px' }}>
        <Turnstile onVerify={setSharedTurnstileToken} />
      </div>
      <div className="p-6">
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-2xl font-bold text-gray-900">
              Class Action Settlements
            </h2>
            <button
              onClick={() => setShowGlobalNotify(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-black hover:bg-gray-800 text-white rounded-lg transition"
              title="Get notified of new settlements"
            >
              🔔 Notify Me
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            {settlements.length} settlement{settlements.length !== 1 ? 's' : ''} {selectedCategory !== "All" ? `in ${selectedCategory}` : 'you may be eligible for'}
          </p>
          
          {/* Personalization Controls */}
          <div className="flex flex-wrap gap-3 mb-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Age:</label>
              <select
                value={ageRangeIndex}
                onChange={(e) => {
                  const newValue = parseInt(e.target.value);
                  trackEvent('filter_age_change', { from: AGE_RANGES[ageRangeIndex].label, to: AGE_RANGES[newValue].label });
                  setAgeRangeIndex(newValue);
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {AGE_RANGES.map((range, index) => (
                  <option key={index} value={index}>{range.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">State:</label>
              <select
                value={userLocation}
                onChange={(e) => {
                  const newValue = e.target.value;
                  trackEvent('filter_state_change', { from: userLocation, to: newValue });
                  setUserLocation(newValue);
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {US_STATES.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Sort:</label>
              <select
                value={sortBy}
                onChange={(e) => {
                  const newValue = e.target.value;
                  trackEvent('filter_sort_change', { from: sortBy, to: newValue });
                  setSortBy(newValue);
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="deadline">Deadline</option>
                <option value="payout">Highest Payout</option>
              </select>
            </div>
          </div>
          
          {/* Category Filter Buttons */}
          <div className="flex flex-wrap gap-2 mb-4">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                onClick={() => {
                  trackEvent('filter_category_change', { from: selectedCategory, to: category });
                  setSelectedCategory(category);
                }}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedCategory === category
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-white text-gray-700 hover:bg-gray-100 shadow-sm ring-1 ring-black/5'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={handleScrollPrev}
            disabled={!canScrollPrev}
            aria-label="Previous settlements"
            className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/10 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              canScrollPrev ? "" : "opacity-40 cursor-not-allowed"
            }`}
          >
            <ChevronLeft className="h-5 w-5 text-gray-700" />
          </button>

          <div className="overflow-hidden" ref={emblaRef}>
            <div className="flex gap-4">
              {settlements.map((settlement) => (
                <SettlementCard key={settlement.id} settlement={settlement} sharedTurnstileToken={sharedTurnstileToken} />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleScrollNext}
            disabled={!canScrollNext}
            aria-label="Next settlements"
            className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/10 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              canScrollNext ? "" : "opacity-40 cursor-not-allowed"
            }`}
          >
            <ChevronRight className="h-5 w-5 text-gray-700" />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-gray-500 text-center flex-1">
            Swipe to browse settlements • Click "File Claim" to visit official site
          </div>
          <button
            onClick={() => setShowFeedback(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white hover:bg-gray-50 text-gray-700 rounded-lg shadow-sm ring-1 ring-black/5 transition"
            title="Send Feedback"
          >
            <MessageCircle className="h-4 w-4" />
            Feedback
          </button>
        </div>

        {/* Global Notifications Modal */}
        {showGlobalNotify && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowGlobalNotify(false)}>
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-gray-900">Set Notifications</h3>
                <button
                  onClick={() => setShowGlobalNotify(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">We'll email you any new class action suits you may be eligible for</p>
              
              {isGlobalSubscribed ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">✓</div>
                  <p className="text-green-600 font-medium">Subscribed! You'll receive notifications about new settlements.</p>
                </div>
              ) : (
                <>
                  {globalEmail && localStorage.getItem('classActionEmail') === globalEmail && (
                    <p className="text-xs text-gray-600 mb-2">📧 Using saved email: <span className="font-medium">{globalEmail}</span></p>
                  )}
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={globalEmail}
                    onChange={(e) => {
                      setGlobalEmail(e.target.value);
                      setGlobalError('');
                    }}
                    onKeyPress={(e) => e.key === 'Enter' && handleGlobalNotifySubmit()}
                    disabled={isGlobalSubmitting}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-2 ${globalError ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}
                  />
                  {globalError && (
                    <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm text-red-600">❌ {globalError}</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mb-4">By providing your email you give us permission to email you regarding upcoming class action lawsuits.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowGlobalNotify(false);
                        setGlobalError('');
                        setGlobalEmail('');
                      }}
                      className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleGlobalNotifySubmit}
                      disabled={isGlobalSubmitting || !sharedTurnstileToken}
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg font-medium transition flex items-center justify-center gap-2"
                    >
                      {!sharedTurnstileToken ? (
                        <>
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Verifying...
                        </>
                      ) : isGlobalSubmitting ? 'Subscribing...' : 'Subscribe'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Feedback Modal */}
        {showFeedback && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowFeedback(false)}>
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">Send Feedback</h3>
                <button
                  onClick={() => setShowFeedback(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>
              
              {feedbackSubmitted ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2">✓</div>
                  <p className="text-green-600 font-medium">Thank you for your feedback!</p>
                </div>
              ) : (
                <>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Tell us what you think..."
                    className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  />
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setShowFeedback(false)}
                      className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleFeedbackSubmit}
                      className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
                    >
                      Submit
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("class-action-root")).render(<ClassActionFinder />);
