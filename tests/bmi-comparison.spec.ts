import { test, expect } from '@playwright/test';
import path from 'path';

const LOCAL_CALCULATOR_PATH = path.resolve(process.cwd(), 'assets/bmi-health-calculator.html');
const EXTERNAL_CALCULATOR_URL = 'https://www.calculator.net/bmi-calculator.html';

const TEST_CASES = [
    { height: 180, weight: 75, age: 30, gender: 'male' },
    { height: 160, weight: 55, age: 25, gender: 'female' },
    { height: 190, weight: 100, age: 45, gender: 'male' },
];

test.describe('BMI Calculator Comparison', () => {
    for (const params of TEST_CASES) {
        test(`Compare BMI for ${params.height}cm, ${params.weight}kg, ${params.age}yo, ${params.gender}`, async ({ page }) => {
            // 1. Get External Result
            await page.goto(EXTERNAL_CALCULATOR_URL);

            // Clear and fill Age
            await page.locator('#cage').fill(params.age.toString());

            // Select Gender
            if (params.gender === 'male') {
                await page.locator('#csex1').check({ force: true });
            } else {
                await page.locator('#csex2').check({ force: true });
            }

            // Fill Height (cm)
            await page.locator('#cheightmeter').fill(params.height.toString());

            // Fill Weight (kg)
            await page.locator('#ckg').fill(params.weight.toString());

            // Calculate
            await page.locator('input[value="Calculate"]').click();

            // Extract BMI
            const externalBmiText = await page.locator('.bigtext b').first().textContent();
            const externalBmi = parseFloat(externalBmiText?.split(' ')[2] || '0'); // Format is usually "BMI = 23.1 kg/m2"
            console.log(`External BMI: ${externalBmi}`);

            // 2. Get Local Result
            // We load the file directly. Note: The component might need hydration or specific setup.
            // Since it's a widget, it might expect to be in an iframe or have specific styles.
            // For this test, we assume we can load the HTML file.
            await page.goto(`file://${LOCAL_CALCULATOR_PATH}`);

            // Wait for the component to be interactive. 
            // Based on component.tsx, inputs have type="number" and are in stat cards.
            // We need to identify them. The component doesn't have IDs, so we might need to use labels or layout.
            // "Weight (kg)" is a label following the input.

            // Helper to fill local input
            async function fillLocalInput(label: string, value: string) {
                // Find the label text, then find the input in the same container (statCard)
                // The structure is: statCard -> [icon, div(input), label]
                // So we can find the label, go up to parent, then find input.
                const labelLocator = page.getByText(label, { exact: true });
                const cardLocator = labelLocator.locator('..');
                const inputLocator = cardLocator.locator('input');
                await inputLocator.fill(value);
            }

            await fillLocalInput('Height (cm)', params.height.toString());
            await fillLocalInput('Weight (kg)', params.weight.toString());
            await fillLocalInput('Age', params.age.toString());

            // Note: Gender is not easily selectable in the current UI based on component.tsx (it has state but no visible toggle in the snippet provided? 
            // Looking at component.tsx: const [gender, setGender] = useState("male"); 
            // There is no UI to change gender in the snippet I saw! 
            // It defaults to male. 
            // Wait, let me check component.tsx again.
            // It has `const [gender, setGender] = useState("male");` but I don't see any input to change it in the JSX.
            // It seems the "Profile" section shows "Guest User" and maybe the gender is hidden or hardcoded for now?
            // Actually, looking at the code, `idealWeightBase` depends on gender.
            // If the UI doesn't allow changing gender, we might only be able to test Male defaults or we need to update the UI.
            // For now, let's assume we can only test the inputs available.
            // If gender affects BMI, it doesn't. BMI is weight/height^2. 
            // Gender affects Ideal Weight and Body Fat.
            // The prompt asked to compare outputs.
            // The local tool calculates BMI.

            // Extract Local BMI
            // It's in a progress ring with class or style?
            // Text is in `styles.progressText`.
            // In the first goal card (BMI Score).
            // We can look for "BMI Score" title, then the value.
            const bmiTitle = page.getByText('BMI Score');
            const bmiCard = bmiTitle.locator('../..'); // Up to goalCard
            const localBmiText = await bmiCard.locator('span').last().textContent(); // The text inside the ring
            const localBmi = parseFloat(localBmiText || '0');
            console.log(`Local BMI: ${localBmi}`);

            // 3. Compare
            expect(Math.abs(localBmi - externalBmi)).toBeLessThanOrEqual(0.1);
        });
    }
});
