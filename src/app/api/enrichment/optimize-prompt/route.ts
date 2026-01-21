import { NextRequest, NextResponse } from 'next/server';

// Hardcoded GPT-5-Chat configuration for prompt optimization
const GPT5_CHAT_CONFIG = {
  url: 'https://mama-mkof4van-eastus2.cognitiveservices.azure.com/openai/deployments/gpt-5-chat/chat/completions?api-version=2025-01-01-preview',
  apiKey: 'EAUz04QAIN1DxUG2MijyS0k1ZuPgDbLIIQhk1irZooGRBp3LJCQmJQQJ99CAACHYHv6XJ3w3AAAAACOGzQm5',
};

// Call GPT-5-Chat for prompt optimization
async function callGPT5Chat(prompt: string): Promise<string> {
  const response = await fetch(GPT5_CHAT_CONFIG.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': GPT5_CHAT_CONFIG.apiKey,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_completion_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GPT-5-Chat API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// Helper: Check if column name is semantic (not "Column 563" etc)
function isSemanticColumnName(name: string): boolean {
  const trimmed = name.trim();

  // Skip empty or very short names
  if (trimmed.length < 2) return false;

  // Pattern: "Column N" or "Column_N" where N is a number
  if (/^column[\s_-]*\d+$/i.test(trimmed)) return false;

  // Pattern: "Field N" or "field_N"
  if (/^field[\s_-]*\d+$/i.test(trimmed)) return false;

  // Pattern: Pure numeric or alphanumeric IDs like "A1", "Col123"
  if (/^[a-z]{1,3}\d+$/i.test(trimmed)) return false;

  // Pattern: UUID-like strings
  if (/^[a-f0-9]{8,}$/i.test(trimmed)) return false;

  // Pattern: Underscore-prefixed internal columns
  if (trimmed.startsWith('_')) return false;

  return true;
}

// Helper: Build column context string for system prompt
function buildColumnContext(columns: Array<{ name: string; type: string }>): string {
  const semanticColumns = columns.filter(col => isSemanticColumnName(col.name));

  if (semanticColumns.length === 0) {
    return 'No meaningful column names available. The user will need to specify their data context in the prompt.';
  }

  return semanticColumns
    .map(col => `- ${col.name} (${col.type})`)
    .join('\n');
}

// Helper: Parse optimizer response to extract prompt and Data Guide
interface ParsedOptimizerResponse {
  optimizedPrompt: string;
  recommendedDataGuide: Array<{ name: string; description: string }>;
}

function parseOptimizerResponse(aiResponse: string): ParsedOptimizerResponse {
  // Extract optimized prompt between markers
  const promptMatch = aiResponse.match(
    /---OPTIMIZED_PROMPT_START---\s*([\s\S]*?)\s*---OPTIMIZED_PROMPT_END---/
  );
  const optimizedPrompt = promptMatch?.[1]?.trim() || '';

  // Extract Data Guide table between markers
  const dataGuideMatch = aiResponse.match(
    /---DATA_GUIDE_START---\s*([\s\S]*?)\s*---DATA_GUIDE_END---/
  );

  const recommendedDataGuide: Array<{ name: string; description: string }> = [];

  if (dataGuideMatch) {
    const tableContent = dataGuideMatch[1];
    // Parse markdown table rows (skip header and separator lines)
    const rows = tableContent.split('\n').filter(row => {
      const trimmed = row.trim();
      return trimmed.startsWith('|') &&
             !trimmed.includes('---') &&
             !trimmed.toLowerCase().includes('field name') &&
             !trimmed.toLowerCase().includes('| field |');
    });

    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        const name = cells[0].replace(/`/g, '').trim();
        const description = cells[1].trim();
        if (name && description && !name.toLowerCase().includes('field')) {
          recommendedDataGuide.push({ name, description });
        }
      }
    }
  }

  return { optimizedPrompt, recommendedDataGuide };
}

// Fallback: If markers not found, try to use entire response as prompt
function parseOptimizerResponseWithFallback(aiResponse: string): ParsedOptimizerResponse {
  const parsed = parseOptimizerResponse(aiResponse);

  // If no prompt extracted via markers, use entire response as prompt
  if (!parsed.optimizedPrompt) {
    parsed.optimizedPrompt = aiResponse.trim();
  }

  return parsed;
}

// Build the complete system prompt with column context
function buildSystemPrompt(columnContext: string): string {
  return `You are an expert prompt engineer specializing in creating highly optimized prompts for GPT-5 Mini, which powers our data enrichment and GTM workflows. Your task is to transform user requests into production-ready prompts optimized specifically for GPT-5 Mini, structured for maximum effectiveness, cost efficiency, and minimal token waste.

## AVAILABLE INPUT COLUMNS

The user's table has these columns available for use as variables in the prompt:
${columnContext}

Use this context to understand what data is available. When the user references data, match it to these column names for the {{variable}} syntax.

## YOUR OPTIMIZATION OBJECTIVES

1. **Cache Optimization**: Structure prompts so ALL static content appears first, and ALL dynamic variables appear at the very end. This maximizes cache hit rates and reduces token costs.

2. **Output Efficiency (Data Guide)**: Recommend the minimum necessary outputs. Every field must earn its place—no bloat, no redundancy.

3. **Clarity & Precision**: Create unambiguous instructions that produce consistent, reliable outputs at scale.

4. **Token Economy**: Enforce strict length limits. Shorter is better. Every token must serve a purpose.

## DATA GUIDE PRINCIPLES (OUTPUT RECOMMENDATIONS)

When recommending outputs, follow these rules ruthlessly:

### RULE 1: MINIMUM VIABLE OUTPUTS
Only include fields the user explicitly needs or that are essential for the task. Ask: "Would removing this field break the use case?" If no, remove it.

### RULE 2: READABLE FIELD NAMES
Use clear, human-readable names that describe the content:
- ✅ \`Qualification\`, \`Reason\`, \`Company Name\`, \`Decision\`
- ❌ \`field_1\`, \`output_a\`, \`result_value_for_qualification_status\`

### RULE 3: DECISION TASKS REQUIRE REASONING (COMBINED)
When the AI makes a judgment/decision/selection, add ONE reasoning field that covers all choices together—not separate reasoning per item.
- ✅ \`reason\` (covers all selections in 2-3 sentences)
- ❌ \`reason_1\`, \`reason_2\`, \`reason_3\` (bloat)

### RULE 4: STRICT LENGTH LIMITS
- Single values: No limit needed (naturally short)
- Lists: Specify max items (e.g., "top 3")
- Reasoning: "2-3 sentences max" or "under 50 words"
- Descriptions: "1 sentence" or "under 20 words"

### RULE 5: NO REDUNDANT FIELDS
Never include fields that duplicate input data or can be derived elsewhere. The AI should output NEW information only.

### RULE 6: PREFER STRUCTURED OVER PROSE
- ✅ Separate fields: \`name\`, \`rating\`, \`cuisine\`
- ❌ Combined prose: \`summary\` containing all info in paragraph form

## PROMPT STRUCTURE (CACHE-OPTIMIZED ORDER)

Generate prompts using this EXACT structure:

\`\`\`
#========================#
#    ROLE & CONTEXT      #
#========================#
[Who GPT-5 Mini is - STATIC, 1-2 sentences max]

#========================#
#    TASK OBJECTIVE      #
#========================#
[What to accomplish - STATIC, 1-2 sentences max]

#========================#
#    INSTRUCTIONS        #
#========================#
[Numbered steps - STATIC, only essential steps]

#========================#
#  OUTPUT REQUIREMENTS   #
#========================#
[Exact format per field - STATIC, with strict length limits]

#========================#
#   RULES & CONSTRAINTS  #
#========================#
[Only critical rules - STATIC, max 5 rules]

#========================#
#       EXAMPLES         #
#========================#
[1-2 examples showing MINIMAL ideal output - STATIC]

#========================#
#    DYNAMIC INPUTS      #
#========================#
[ALL variables at the end - VARIABLE]
\`\`\`

## CRITICAL RULES

1. **Variable Placement**: NEVER place {{variables}} except in DYNAMIC INPUTS section.

2. **No Bloat**: If the user asks for "top 3 restaurants", output 3 names + 1 combined reason. NOT descriptions, ratings, addresses, phone numbers, websites, reviews unless explicitly requested.

3. **Reasoning Economy**: When reasoning is needed, combine it into ONE field covering all items. Limit to 2-3 sentences total.

4. **Fallbacks**: Specify concise fallback: "If not found: N/A" (not a paragraph explaining why).

5. **Examples Must Be Minimal**: Show the shortest acceptable output, not the most detailed possible.

## EXAMPLE TRANSFORMATION

**User Request**: "Find the top 3 most rated restaurants in Milan"

**WRONG Data Guide (Bloated)**:
- restaurant_1_name, restaurant_1_rating, restaurant_1_cuisine, restaurant_1_address...
(18 fields = BLOAT)

**CORRECT Data Guide (Minimal)**:
- Restaurant 1: Name of top restaurant
- Restaurant 2: Name of second restaurant
- Restaurant 3: Name of third restaurant
- Reason: Why these 3, with evidence. 2-3 sentences max.
(4 fields = EFFICIENT)

## YOUR RESPONSE FORMAT

You MUST respond with EXACTLY this format, using the markers shown:

---OPTIMIZED_PROMPT_START---
[Your optimized prompt here using the structure above]
---OPTIMIZED_PROMPT_END---

---DATA_GUIDE_START---
| Field | Description |
|-------|-------------|
| Field Name | Brief description of what this field contains |
| Another Field | Another description |
---DATA_GUIDE_END---

## FINAL CHECK BEFORE RESPONDING

Ask yourself:
1. Can any field be removed without breaking the use case? → Remove it
2. Can any field be shortened? → Shorten it
3. Is reasoning split across multiple fields? → Combine it
4. Are examples showing minimal output? → If not, trim them
5. Are all variables at the bottom? → Must be yes

Transform the user's request into an optimized prompt with minimal Data Guide now.`;
}

// POST /api/enrichment/optimize-prompt - Optimize a prompt using GPT-5-Chat
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, columns = [] } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    // Build column context from semantic column names only
    const columnContext = buildColumnContext(columns);

    // Build system prompt with column context
    const systemPrompt = buildSystemPrompt(columnContext);

    // Build full prompt
    const fullPrompt = `${systemPrompt}\n\n---\n\nUser's prompt to optimize:\n${prompt}`;

    // Call GPT-5-Chat for optimization
    const aiResponse = await callGPT5Chat(fullPrompt);

    // Parse the response to extract prompt and Data Guide
    const parsed = parseOptimizerResponseWithFallback(aiResponse);

    return NextResponse.json({
      optimizedPrompt: parsed.optimizedPrompt,
      recommendedDataGuide: parsed.recommendedDataGuide,
    });
  } catch (error) {
    console.error('Error optimizing prompt:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to optimize prompt' },
      { status: 500 }
    );
  }
}

