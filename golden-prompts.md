# Golden Prompt Set - BMI Health Calculator

This document contains test prompts to validate the BMI Health Calculator connector's metadata and behavior.

## Purpose
Use these prompts to test:
- **Precision**: Does the right tool get called?
- **Recall**: Does the tool get called when it should?
- **Accuracy**: Are the right parameters passed?

---

## Direct Prompts (Should ALWAYS trigger the connector)

### 1. Explicit Tool Name
**Prompt**: "Calculate my BMI"
**Expected**: ✅ Calls `bmi-health-calculator` with default values
**Status**: [ ] Pass / [ ] Fail

### 2. Specific Metrics
**Prompt**: "Calculate BMI for someone 180cm and 75kg"
**Expected**: ✅ Calls `bmi-health-calculator` with height=180, weight=75
**Status**: [ ] Pass / [ ] Fail

### 3. Ideal Weight Query
**Prompt**: "What is my ideal weight if I'm 5'10"?"
**Expected**: ✅ Calls `bmi-health-calculator` with height=5'10" (parsed)
**Status**: [ ] Pass / [ ] Fail

### 4. Detailed Parameters
**Prompt**: "Calculate body fat for male, 30 years old, 180cm, 80kg, waist 85cm"
**Expected**: ✅ Calls `bmi-health-calculator` with all parameters
**Status**: [ ] Pass / [ ] Fail

### 5. Health Assessment
**Prompt**: "Am I overweight at 90kg and 5 foot 8 inches?"
**Expected**: ✅ Calls `bmi-health-calculator` to analyze BMI
**Status**: [ ] Pass / [ ] Fail

---

## Indirect Prompts (Should trigger the connector)

### 6. Weight Loss Question
**Prompt**: "How much weight should I lose?"
**Expected**: ✅ Calls `bmi-health-calculator` to check ideal weight
**Status**: [ ] Pass / [ ] Fail

### 7. Fitness Progress
**Prompt**: "Check my body composition"
**Expected**: ✅ Calls `bmi-health-calculator`
**Status**: [ ] Pass / [ ] Fail

### 8. Comparison
**Prompt**: "Is my weight healthy for my height?"
**Expected**: ✅ Calls `bmi-health-calculator`
**Status**: [ ] Pass / [ ] Fail

---

## Negative Prompts (Should NOT trigger the connector)

### 9. Medical Diagnosis
**Prompt**: "Why does my stomach hurt?"
**Expected**: ❌ Does NOT call `bmi-health-calculator` (medical advice)
**Status**: [ ] Pass / [ ] Fail

### 10. Diet Plan
**Prompt**: "Give me a keto diet plan"
**Expected**: ❌ Does NOT call `bmi-health-calculator` (general advice)
**Status**: [ ] Pass / [ ] Fail

### 11. Exercise Routine
**Prompt**: "Best exercises for abs"
**Expected**: ❌ Does NOT call `bmi-health-calculator` (general advice)
**Status**: [ ] Pass / [ ] Fail

---

## Edge Cases

### 12. Ambiguous Units
**Prompt**: "I weigh 160"
**Expected**: ✅ Calls `bmi-health-calculator` (infers lbs usually)
**Status**: [ ] Pass / [ ] Fail

### 13. Mixed Units
**Prompt**: "Height 1.8m weight 160lbs"
**Expected**: ✅ Calls `bmi-health-calculator` with correct conversions
**Status**: [ ] Pass / [ ] Fail

---

## Testing Instructions

### How to Test
1. Open ChatGPT in **Developer Mode**
2. Link your BMI Health Calculator connector
3. For each prompt above:
   - Enter the exact prompt
   - Observe which tool gets called
   - Check the parameters passed
   - Verify the widget renders correctly
   - Mark Pass/Fail in the Status column