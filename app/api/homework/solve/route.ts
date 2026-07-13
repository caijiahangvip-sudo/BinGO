import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createHomeworkSolveJob } from '@/lib/server/homework-job-store';
import { runHomeworkSolveJob } from '@/lib/server/homework-job-runner';
import {
  getHomeworkUploads,
  parseHomeworkLanguage,
  validateHomeworkUploads,
} from '@/lib/server/homework-solver';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import type { PDFProviderId } from '@/lib/pdf/types';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

const log = createLogger('Homework Solve API');

export async function POST(req: NextRequest) {
  let fileName = 'unknown';
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return apiError('INVALID_REQUEST', 400, 'Expected multipart/form-data');
    }

    const formData = await req.formData();
    const uploads = getHomeworkUploads(formData);
    if (uploads.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'file is required');
    }
    try {
      validateHomeworkUploads(uploads);
    } catch (validationError) {
      return apiError(
        'INVALID_REQUEST',
        400,
        validationError instanceof Error ? validationError.message : 'Invalid homework upload',
      );
    }
    fileName = uploads.map((upload) => upload.fileName).join(', ');
    const language = parseHomeworkLanguage(formData.get('language'));
    const pdfProviderId = (formData.get('pdfProviderId') as PDFProviderId | null) || undefined;
    const pdfApiKey = (formData.get('pdfApiKey') as string | null) || undefined;
    const pdfBaseUrl = (formData.get('pdfBaseUrl') as string | null) || undefined;
    const resolvedModel = resolveModelFromHeaders(req);
    const jobId = nanoid(10);
    const job = await createHomeworkSolveJob({
      jobId,
      uploads,
      language,
      pdfProviderId,
      modelString: resolvedModel.modelString,
    });
    const pollUrl = `${buildRequestOrigin(req)}/api/homework/solve/${jobId}`;

    after(() =>
      runHomeworkSolveJob({
        jobId,
        resolvedModel,
        pdfProviderId,
        pdfApiKey,
        pdfBaseUrl,
      }),
    );

    return apiSuccess(
      {
        jobId,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        message: job.message,
        logs: job.logs,
        inputSummary: job.inputSummary,
        heartbeatAt: job.heartbeatAt,
        updatedAt: job.updatedAt,
        pollUrl,
        pollIntervalMs: 3000,
        done: false,
      },
      202,
    );
  } catch (error) {
    log.error(`Homework solve job creation failed [file="${fileName}"]:`, error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to create homework solve job',
    );
  }
}
