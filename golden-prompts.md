# Golden Prompt Set - Mortgage Calculator

This document contains test prompts to validate the Mortgage Calculator connector's metadata and behavior.

## Purpose
Use these prompts to test:
- **Precision**: Does the right tool get called?
- **Recall**: Does the tool get called when it should?
- **Accuracy**: Are the right parameters passed?

---

## Direct Prompts (Should ALWAYS trigger the connector)

### 1. Explicit Tool Name
**Prompt**: "Calculate my mortgage payment"
**Expected**: ✅ Calls `mortgage-calculator` with default values
**Status**: [ ] Pass / [ ] Fail

### 2. Specific Amount
**Prompt**: "Calculate mortgage for a $350,000 house"
**Expected**: ✅ Calls `mortgage-calculator` with homePrice=350000
**Status**: [ ] Pass / [ ] Fail

### 3. Monthly Payment Query
**Prompt**: "What's my monthly payment for a $400k home?"
**Expected**: ✅ Calls `mortgage-calculator` with homePrice=400000
**Status**: [ ] Pass / [ ] Fail

### 4. Detailed Parameters
**Prompt**: "Calculate mortgage for $500k home with $100k down and 7% interest"
**Expected**: ✅ Calls `mortgage-calculator` with all parameters
**Status**: [ ] Pass / [ ] Fail

### 5. Budget Planning
**Prompt**: "Help me plan my home purchase budget"
**Expected**: ✅ Calls `mortgage-calculator` with default values
**Status**: [ ] Pass / [ ] Fail

---

## Indirect Prompts (Should trigger the connector)

### 6. Affordability Question
**Prompt**: "How much house can I afford?"
**Expected**: ✅ Calls `mortgage-calculator` to help estimate
**Status**: [ ] Pass / [ ] Fail

### 7. Total Cost Query
**Prompt**: "What's the total cost of a 30-year mortgage?"
**Expected**: ✅ Calls `mortgage-calculator` with loanTerm=30
**Status**: [ ] Pass / [ ] Fail

### 8. Rate Comparison
**Prompt**: "Compare mortgage rates at 6% vs 7%"
**Expected**: ✅ Calls `mortgage-calculator` twice or shows comparison
**Status**: [ ] Pass / [ ] Fail

### 9. Payment Breakdown
**Prompt**: "Break down my monthly mortgage costs"
**Expected**: ✅ Calls `mortgage-calculator`
**Status**: [ ] Pass / [ ] Fail

### 10. Loan Term Comparison
**Prompt**: "Should I get a 15 or 30 year mortgage?"
**Expected**: ✅ Calls `mortgage-calculator` to compare
**Status**: [ ] Pass / [ ] Fail

---

## Negative Prompts (Should NOT trigger the connector)

### 11. Real Estate Search
**Prompt**: "Find me a house in California"
**Expected**: ❌ Does NOT call `mortgage-calculator` (use web search)
**Status**: [ ] Pass / [ ] Fail

### 12. Legal Advice
**Prompt**: "Can I break my mortgage contract?"
**Expected**: ❌ Does NOT call `mortgage-calculator` (legal advice)
**Status**: [ ] Pass / [ ] Fail

### 13. Refinancing Details
**Prompt**: "Should I refinance my existing mortgage?"
**Expected**: ❌ Does NOT call `mortgage-calculator` (general advice)
**Status**: [ ] Pass / [ ] Fail

### 14. Unrelated Topics
**Prompt**: "What's the weather today?"
**Expected**: ❌ Does NOT call `mortgage-calculator` (unrelated)
**Status**: [ ] Pass / [ ] Fail

### 15. Credit Score
**Prompt**: "What credit score do I need for a mortgage?"
**Expected**: ❌ Does NOT call `mortgage-calculator` (general knowledge)
**Status**: [ ] Pass / [ ] Fail

---

## Edge Cases

### 16. Ambiguous Intent
**Prompt**: "Tell me about settlements"
**Expected**: ⚠️ May or may not call `find-settlements` (clarification needed)
**Status**: [ ] Pass / [ ] Fail

### 17. Past Tense
**Prompt**: "What class actions have I missed?"
**Expected**: ✅ Calls `find-settlements` (should show expired ones at the end)
**Status**: [ ] Pass / [ ] Fail

### 18. Specific Company
**Prompt**: "Are there any Facebook class actions?"
**Expected**: ✅ Calls `find-settlements`, possibly filters by Technology
**Status**: [ ] Pass / [ ] Fail

### 19. Multiple Categories
**Prompt**: "Show me healthcare and financial settlements"
**Expected**: ✅ Calls `find-settlements` twice or shows all with filtering
**Status**: [ ] Pass / [ ] Fail

### 20. Deadline Urgency
**Prompt**: "What class actions are expiring soon?"
**Expected**: ✅ Calls `find-settlements`, widget should sort by deadline
**Status**: [ ] Pass / [ ] Fail

---

## Testing Instructions

### How to Test
1. Open ChatGPT in **Developer Mode**
2. Link your Class Action Finder connector
3. For each prompt above:
   - Enter the exact prompt
   - Observe which tool gets called
   - Check the parameters passed
   - Verify the widget renders correctly
   - Mark Pass/Fail in the Status column

### Success Criteria
- **Direct prompts**: 100% recall (5/5 should trigger)
- **Indirect prompts**: 80%+ recall (4/5 should trigger)
- **Negative prompts**: 100% precision (0/5 should trigger)
- **Edge cases**: Document behavior for future reference

### Tracking Results
Create a log entry for each test run:

```
Date: 2025-10-25
Metadata Version: v1.0
Results:
- Direct: 5/5 ✅
- Indirect: 3/5 ⚠️ (missed prompts #7, #9)
- Negative: 5/5 ✅
- Edge: 3/5 ⚠️

Action Items:
- Update description to mention "privacy violations"
- Add "medical billing" to healthcare category description
```

---

## Iteration Log

### Version 1.0 (2025-10-25)
- Initial golden prompt set created
- 20 prompts covering direct, indirect, negative, and edge cases
- Ready for first round of testing

### Version 1.1 (TBD)
- Update based on test results
- Add prompts that failed unexpectedly
- Remove prompts that are too similar