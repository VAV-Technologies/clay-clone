import { NextRequest, NextResponse } from 'next/server';
import { callAI } from '@/lib/ai-provider';

interface ColumnInfo {
  name: string;
  type: string;
  sampleValue?: string | number | null;
}

const SYSTEM_PROMPT = `You are a formula generator for a spreadsheet application. Your task is to generate JavaScript expressions that transform data.

## AVAILABLE TOOLS

You have access to:
- **Standard JavaScript**: Math, String, Array, Date, RegExp, Number, Object, JSON, Boolean
- **Lodash**: Use \`_\` (e.g., \`_.capitalize()\`, \`_.trim()\`, \`_.get()\`, \`_.uniq()\`)
- **Excel/Sheets functions**: VLOOKUP, IF, SUM, CONCATENATE, LEFT, RIGHT, MID, TRIM, UPPER, LOWER, PROPER, LEN, FIND, SUBSTITUTE, and more via FormulaJS
- **Column references**: Use \`{{Column Name}}\` syntax to reference column values

## RULES

1. **Return ONLY the JavaScript expression** - no explanations, no markdown, no code blocks
2. **Single expression** - the formula must be a single expression that returns a value
3. **Handle null/undefined** - always use optional chaining (\`?.\`) and provide fallbacks (\`|| ""\`)
4. **Keep it simple** - prefer readable code over clever one-liners
5. **String results** - if the result should be a string, ensure it's a string

## EXAMPLES

| Description | Formula |
|------------|---------|
| Extract domain from email | \`{{Email}}?.split("@")[1] || ""\` |
| Combine first and last name | \`[{{First Name}}, {{Last Name}}].filter(Boolean).join(" ")\` |
| Extract text after @ in Twitter | \`{{Twitter Handle}}?.replace(/^@/, "") || ""\` |
| Get first word | \`{{Text}}?.split(" ")[0] || ""\` |
| Convert to uppercase | \`{{Text}}?.toUpperCase() || ""\` |
| Check if value exists | \`{{Value}} ? "Yes" : "No"\` |
| Extract numbers only | \`{{Text}}?.replace(/[^0-9]/g, "") || ""\` |
| Use fallback if empty | \`{{Primary}} || {{Secondary}} || "N/A"\` |
| Split by comma, get first | \`{{City}}?.split(",")[0]?.trim() || ""\` |
| Remove non-letters | \`{{Text}}?.replace(/[^a-zA-Z\\s]/g, "") || ""\` |
| Capitalize first letter | \`_.capitalize({{Text}} || "")\` |
| Get string length | \`({{Text}} || "").length\` |
| Conditional text | \`Number({{Score}}) > 80 ? "Pass" : "Fail"\` |
| Format as currency | \`"$" + Number({{Price}} || 0).toFixed(2)\` |
| Extract from URL | \`{{URL}}?.match(/\\/([^\\/]+)\\/?$/)?.[1] || ""\` |

## OUTPUT FORMAT

Return ONLY the formula expression. Nothing else. No explanations.`;

export async function POST(request: NextRequest) {
  try {
    const { description, columns } = await request.json();

    if (!description || !description.trim()) {
      return NextResponse.json(
        { error: 'Description is required' },
        { status: 400 }
      );
    }

    // Build column context
    const columnContext = (columns as ColumnInfo[])
      .map(col => {
        const sample = col.sampleValue !== null && col.sampleValue !== undefined
          ? ` (sample: "${col.sampleValue}")`
          : '';
        return `- {{${col.name}}} (${col.type})${sample}`;
      })
      .join('\n');

    const userPrompt = `Generate a formula for the following request:

"${description}"

Available columns:
${columnContext}

Return ONLY the JavaScript expression:`;

    const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;

    const result = await callAI(fullPrompt, 'gpt-5-mini', {
      temperature: 0.2,
      maxOutputTokens: 512,
    });

    let formula = cleanFormula(result.text);

    return NextResponse.json({
      formula,
      description,
    });
  } catch (error) {
    console.error('Error generating formula:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to generate formula' },
      { status: 500 }
    );
  }
}

function cleanFormula(formula: string): string {
  let cleaned = formula.trim();

  // Remove markdown code blocks
  cleaned = cleaned.replace(/^```(?:javascript|js)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');

  // Remove backticks wrapping the formula
  cleaned = cleaned.replace(/^`+/, '').replace(/`+$/, '');

  // Remove any leading/trailing quotes if the entire thing is quoted
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    const inner = cleaned.slice(1, -1);
    if (!inner.includes('"') && !inner.includes("'")) {
      cleaned = inner;
    }
  }

  return cleaned.trim();
}
