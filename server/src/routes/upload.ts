import { Router } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';
import { parseQuestionnaire } from '../services/extraction';
import { addEvidenceFiles, getAssessment, replaceItems } from '../services/store';
import { fail, getContext, ok, parseId } from './_helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, '..', '..', 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

const router = Router();

router.post(
  '/assessments/:id/upload',
  upload.fields([
    { name: 'questionnaire', maxCount: 1 },
    { name: 'evidence', maxCount: 20 },
  ]),
  (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return fail(res, 400, 'Invalid assessment id');
    if (!getAssessment(id)) return fail(res, 404, 'Assessment not found');

    const { actor, role } = getContext(req);
    if (role === 'Viewer') return fail(res, 403, 'Viewers cannot upload');

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const questionnaire = files?.questionnaire?.[0];
    if (!questionnaire) return fail(res, 400, 'A questionnaire file (field "questionnaire") is required');

    let items;
    try {
      const parsed = parseQuestionnaire(questionnaire.path, questionnaire.originalname);
      if (parsed.length === 0) {
        return fail(res, 422, 'No questionnaire rows could be extracted. Check the file columns (Question, Response, ...).');
      }
      items = replaceItems(id, parsed, actor, role);
    } catch (err) {
      return fail(res, 422, `Failed to parse questionnaire: ${(err as Error).message}`);
    }

    const evidenceFiles = files?.evidence ?? [];
    if (evidenceFiles.length > 0) {
      addEvidenceFiles(
        id,
        evidenceFiles.map((f) => ({
          original_name: f.originalname,
          stored_name: f.filename,
          mime_type: f.mimetype,
          size: f.size,
        })),
        actor,
        role,
      );
    }

    ok(res, { assessment: getAssessment(id), items });
  },
);

export default router;
