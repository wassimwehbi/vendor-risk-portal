import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { parseQuestionnaire } from '../services/extraction';
import {
  ALLOWED_EVIDENCE_LABEL,
  classifyEvidence,
  extractEvidence,
} from '../services/evidenceExtraction';
import { addEvidenceFiles, getAssessment, replaceItems } from '../services/store';
import type { NewEvidence } from '../services/store';
import type { EvidenceFile } from '../types';
import { fail, getContext, ok, parseId } from './_helpers';

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
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return fail(res, 400, 'Too many files (max 20 evidence files).');
        return fail(res, 400, `Upload error: ${err.message}`);
      }
      return fail(res, 400, (err as Error).message || 'Upload failed');
    }
    next();
  });
}

const router = Router();

router.post('/assessments/:id/upload', handleUpload, async (req, res) => {
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

  if (id === null) {
    cleanup();
    return fail(res, 400, 'Invalid assessment id');
  }
  if (!getAssessment(id)) {
    cleanup();
    return fail(res, 404, 'Assessment not found');
  }

  const { actor, role } = getContext(req);
  if (role === 'Viewer') {
    cleanup();
    return fail(res, 403, 'Viewers cannot upload');
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
    const parsed = parseQuestionnaire(questionnaire.path, questionnaire.originalname);
    if (parsed.length === 0) {
      cleanup();
      return fail(res, 422, 'No questionnaire rows could be extracted. Check the file columns (Question, Response, ...).');
    }
    items = replaceItems(id, parsed, actor, role);
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
    evidence = addEvidenceFiles(id, records, actor, role);
  }

  ok(res, { assessment: getAssessment(id), items, evidence });
});

export default router;
