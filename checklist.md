# OpenAI App SDK Checklist

## Deployment
- [ ] **README/Docs**: Only update product name and project description. **DO NOT** change build/run instructions.
- [ ] **Secure Transport**:
    - [ ] Ensure HTTPS end-to-end for production.
    - [ ] Clarify in README that HTTP endpoints are for local development only.

## Storage & State
- [ ] **Local Storage**:
    - [ ] Implement persistent local storage (e.g., for email addresses).
    - [ ] **Data Expiry**: Implement explicit expiry for `localStorage` (e.g., purge after 72 hours) OR expose a "Clear saved data" button with documentation.
- [ ] **Backend Storage**: Ensure backend storage is connected and functional.
- [ ] **Widget State**: Use `window.openai.setWidgetState()` to preserve user context across conversations.
- [ ] **User Database**: Verify user database integration.

## Privacy & Data Use
- [ ] **Policy Documentation**: Add a "Privacy & Data Use" section to the README (or link to org policy).
    - [ ] Document what is collected: location, locale, device, log timestamps, inferred query.
    - [ ] Document retention period: e.g., 30 days for analytics logs.
    - [ ] Document how users can request deletion (contact email or endpoint).

## UX & Design
- [ ] **Aesthetics**: Verify Color, Typography, and Layout match design system by inspecting **.html files**.
- [ ] **Floating Button**: Ensure floating button is present and functional in **.html files**.
- [ ] **Scroll Handling**: (Check **.html files** for these properties)
    - [ ] `touch-action: auto` on embedded widgets.
    - [ ] Add `-webkit-overflow-scrolling: touch` and `overscroll-behavior: auto` on main wrappers.
    - [ ] Use `overflow: hidden` to preserve clipping (e.g., carousels) but avoid blocking vertical gestures.
    - [ ] **Avoid** `touch-action: pan-y` on wrappers unless strictly necessary.

## Text Suppression (Widget Responses)
- [ ] **Suppress Extra Text**:
    - [ ] Return empty content (`content: []`) when returning a widget.
    - [ ] Keep `structuredContent` populated.
    - [ ] Keep `_meta` with the widget resource/outputTemplate.
    - [ ] Ensure `openai/resultCanProduceWidget: true` is set.

## Metadata (Crucial for Inference)
> **Goal**: Use longer than normal titles and metadata to give OpenAI the most amount of data to extrapolate from.

- [ ] **Server Metadata**: Detailed descriptions.
- [ ] **Package Metadata**: Comprehensive package description.
- [ ] **App Metadata**:
    - [ ] **Starter Prompts**: defined and descriptive.
    - [ ] **Sample Conversations**: included.
- [ ] **Tool Definitions**:
    - [ ] **Titles**: Long, descriptive titles.
    - [ ] **Descriptions**: detailed.
    - [ ] **Input Schema**: Zod parsers with clear properties.
    - [ ] **Hydration Helpers**: Modify `baseDefaults`, `mergeProgramDefaults`, `summary rendering` to expect new parameter names but keep hydration flow.

## Security
- [ ] **CSP**: Content Security Policy configured.
- [ ] **Captcha**: Cloudflare integration.
    - [ ] Site Key: `0x4AAAAAAB88oeIlUFfNX1o7`
    - [ ] Secret Key: `0x4AAAAAAB88oQxvKf3YbzwBHTsOhQaNmYs`

## Analytics & Performance
- [ ] **User Analytics**: Track Location, Language, Device/Browser, Inferred Query.
- [ ] **Feedback**: Improvement/Feedback button for users.
- [ ] **Performance Alerts**:
    - [ ] **Tool Call Failures**: Log `CallToolRequest` errors. Alert if >5/day.
    - [ ] **Parameter Parsing Errors**: Log Zod validation errors. Alert if >3/week.
    - [ ] **Empty Result Sets**: Log when filtered results == 0. Alert if >20% of calls.
    - [ ] **Widget Load Failures**: Error boundary in `src/class-action/index.jsx`. Alert immediately on crash.
    - [ ] **Subscription Failures**: Log `/api/subscribe` errors. Alert if >10% failure rate.
- [ ] **Automated Monitoring**:
    - [ ] Implement cron/worker or external monitoring (Pingdom, Datadog) to hit `/analytics` and trigger alerts based on above thresholds.
    - [ ] Alternatively, emit metrics to CloudWatch/Grafana.

## Extra Features
- [ ] **PDF Export**: Functionality available (Check **.html files**).
- [ ] **Print Functionality**: Ensure project has print functionality implemented.
