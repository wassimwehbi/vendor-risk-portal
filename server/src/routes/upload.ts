import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { parseQuestionnaire } from '../services/extraction';
import { ALLOWED_EVIDENCE_LABEL, classifyEvidence, extractEvidence } from '../services/evidenceExtraction';
import { addEvidenceFiles, getAssessment, replaceItems } from '../services/store';
import type { NewEvidence } from '../services/store';
import { analyzeAssessment } from '../services/aiEngine';
import type { AnalyzeResult, EvidenceFile } from '../types';
import { fail, getScope, ok, parseId } from './_helpers';
import { requireTenantRole } from '../middleware/tenant';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, '..', '..', 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_BYTES } });
const uploadFields = upload.fields([
  { name: 'questionnaire', maxCount: 1 },
  { name: 'evidence', maxCount: 20 },
]);

// Wrap multer so its errors (e.g. file too large) return a clean envelope
// instead of falling through to the default Express 500 handler.
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  uploadFields(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'A file exceeds the 25 MB limit.');
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
          return fail(res, 400, 'Too many files (max 20 evidence files).');
        return fail(res, 400, `Upload error: ${err.message}`);
      }
      return fail(res, 400, (err as Error).message || 'Upload failed');
    }
    next();
  });
}

const router = Router();

router.post('/assessments/:id/upload', requireTenantRole('Analyst', 'Submitter'), handleUpload, async (req, res) => {
  const id = parseId(req.params.id);
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const questionnaire = files?.questionnaire?.[0];
  const evidenceFiles = files?.evidence ?? [];
  const allPaths = [questionnaire?.path, ...evidenceFiles.map((f) => f.path)].filter(Boolean) as string[];
  const cleanup = () => {
    for (const p of allPaths) {
      try {
        unlinkSync(p);
      } catch {
        /* best effort */
      }
    }
  };

  const scope = getScope(req);

  if (id === null) {
    cleanup();
    return fail(res, 400, 'Invalid assessment id');
  }
  if (!getAssessment(id, scope)) {
    cleanup();
    return fail(res, 404, 'Assessment not found');
  }

  if (!questionnaire) {
    cleanup();
    return fail(res, 400, 'A questionnaire file (field "questionnaire") is required');
  }

  // Validate evidence file types up-front against the supported allow-list.
  const rejected = evidenceFiles.filter((f) => classifyEvidence(f.originalname, f.mimetype) === null);
  if (rejected.length > 0) {
    cleanup();
    return fail(
      res,
      422,
      `Unsupported evidence file type: ${rejected.map((f) => f.originalname).join(', ')}. Allowed: ${ALLOWED_EVIDENCE_LABEL}.`,
    );
  }

  // Parse the questionnaire into structured items.
  let items;
  try {
    const parsed = await parseQuestionnaire(questionnaire.path, questionnaire.originalname);
    if (parsed.length === 0) {
      cleanup();
      return fail(
        res,
        422,
        'No questionnaire rows could be extracted. Check the file columns (Question, Response, ...).',
      );
    }
    items = replaceItems(id, parsed, scope);
  } catch (err) {
    cleanup();
    return fail(res, 422, `Failed to parse questionnaire: ${(err as Error).message}`);
  }

  // Parse each evidence file (extract text/metadata). Parsing never throws.
  let evidence: EvidenceFile[] = [];
  if (evidenceFiles.length > 0) {
    const records: NewEvidence[] = await Promise.all(
      evidenceFiles.map(async (f) => {
        const ex = await extractEvidence(f.path, f.originalname, f.mimetype);
        return {
          original_name: f.originalname,
          stored_name: f.filename,
          mime_type: f.mimetype,
          size: f.size,
          kind: ex.kind,
          parse_status: ex.status,
          extracted_chars: ex.chars,
          extracted_text: ex.text ? ex.text : null,
          parse_note: ex.note,
        };
      }),
    );
    evidence = addEvidenceFiles(id, records, scope);
  }

  // Auto-analyze on submit so a (preliminary) outcome exists immediately — a
  // submitter cannot run analysis manually, and an analyst can re-run it later.
  // A failure here must not fail the upload: the assessment stays 'extracted'
  // and analysis can be re-run.
  let analysis: AnalyzeResult | null = null;
  try {
    analysis = await analyzeAssessment(id, scope);
  } catch (err) {
    console.warn(`[upload] auto-analyze failed for assessment ${id}:`, (err as Error).message);
  }

  ok(res, { assessment: getAssessment(id, scope), items, evidence, analysis });
});

export default router;
