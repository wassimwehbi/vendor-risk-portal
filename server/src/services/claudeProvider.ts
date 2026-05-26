import Anthropic from '@anthropic-ai/sdk';
import type {
  AnalysisProvider,
  Completeness,
  ControlStrength,
  DataCategory,
  EvidenceSufficiency,
  ItemAnalysis,
  QuestionnaireItem,
} from '../types';
import { CONTROL_DOMAINS } from '../data/controlDomains';
import { getMapping } from './frameworkMapping';
import { scoreItem } from './riskScoring';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const DOMAIN_NAMES = CONTROL_DOMAINS.map((d) => d.name).join(', ');

// Large, stable instruction block -> marked for prompt caching so repeated
// per-item calls reuse it cheaply.
const SYSTEM_PROMPT = `You are a vendor-risk analyst assistant. You analyze a single answer from a SIG security questionnaire and return a STRICT JSON object. You never make final risk decisions — a human analyst validates your output.

Classify the answer into exactly ONE of these control domains (use the exact string), or "Uncategorized":
${DOMAIN_NAMES}.

Assess these qualitative dimensions:
- control_strength: "Strong" (clearly implemented, broad scope, specifics/standards given), "Medium" (partial scope or unqualified yes), "Weak" (vague/optional), or "None" (absent/no).
- completeness: "Complete", "Partial", "Vague" (non-specific buzzwords like "industry-standard"), or "Missing".
- evidence_sufficiency: "Sufficient", "Insufficient" (generic policy / no implementation proof), "None" (no evidence), "Expired" (cert/report past its date), or "Misaligned" (evidence does not match the answer).
- data_categories: array, any of: personal, sensitive_personal, phi, children, employee, financial, cross_border, subprocessors (only those clearly implied).
- ai_finding: one concise sentence describing the gap or status.
- ai_rationale: one sentence explaining your reasoning.
- follow_up_questions: array of 1-4 targeted, specific follow-up questions to close gaps.

Return ONLY minified JSON with keys: control_domain, control_strength, completeness, evidence_sufficiency, data_categories, ai_finding, ai_rationale, follow_up_questions. No prose, no code fences.`;

// Built once and reused (the system block is identical across calls -> cache hit).
// cache_control is accepted by the /v1/messages endpoint; the type is asserted
// because this SDK version only declares it on the beta namespace.
const SYSTEM_BLOCKS = [
  { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
] as unknown as Anthropic.TextBlockParam[];

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseModelJson(text: string): any {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

export function createClaudeProvider(): AnalysisProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  async function analyzeItem(item: QuestionnaireItem): Promise<ItemAnalysis> {
    const userContent = `Question ID: ${item.question_id}
Question: ${item.question_text}
Response type: ${item.response_type}
Response: ${item.response}
Vendor comments: ${item.vendor_comments ?? '(none)'}
Evidence provided: ${item.evidence_text ?? '(none)'}
Evidence location: ${item.evidence_location ?? '(none)'}
Relevant date: ${item.relevant_date ?? '(none)'}
Expiration date: ${item.expiration_date ?? '(none)'}`;

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM_BLOCKS,
      messages: [{ role: 'user', content: userContent }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '{}';
    const parsed = parseModelJson(raw);

    const control_domain: string =
      typeof parsed.control_domain === 'string' && parsed.control_domain.trim()
        ? parsed.control_domain.trim()
        : 'Uncategorized';
    const control_strength = coerce<ControlStrength>(
      parsed.control_strength,
      ['Strong', 'Medium', 'Weak', 'None'],
      'Medium',
    );
    const completeness = coerce<Completeness>(
      parsed.completeness,
      ['Complete', 'Partial', 'Vague', 'Missing'],
      'Partial',
    );
    const evidence_sufficiency = coerce<EvidenceSufficiency>(
      parsed.evidence_sufficiency,
      ['Sufficient', 'Insufficient', 'None', 'Expired', 'Misaligned'],
      'None',
    );
    const allowedCats: DataCategory[] = [
      'personal',
      'sensitive_personal',
      'phi',
      'children',
      'employee',
      'financial',
      'cross_border',
      'subprocessors',
    ];
    const data_categories: DataCategory[] = Array.isArray(parsed.data_categories)
      ? parsed.data_categories.filter((c: unknown): c is DataCategory => allowedCats.includes(c as DataCategory))
      : [];
    const follow_up_questions: string[] = Array.isArray(parsed.follow_up_questions)
      ? parsed.follow_up_questions.filter((q: unknown): q is string => typeof q === 'string')
      : [];

    // Framework mapping + risk score stay deterministic for auditability.
    const framework_mappings = getMapping(control_domain);
    const risk_level = scoreItem({
      control_strength,
      evidence_sufficiency,
      completeness,
      data_categories,
      control_domain,
    });

    return {
      control_domain,
      framework_mappings,
      completeness,
      control_strength,
      evidence_sufficiency,
      risk_level,
      ai_finding: typeof parsed.ai_finding === 'string' ? parsed.ai_finding : '',
      ai_rationale: typeof parsed.ai_rationale === 'string' ? parsed.ai_rationale : '',
      follow_up_questions,
      data_categories,
    };
  }

  return { name: 'claude', analyzeItem };
}
