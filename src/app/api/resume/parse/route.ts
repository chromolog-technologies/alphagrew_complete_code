import { NextRequest, NextResponse } from 'next/server';
import { extractClaimsFromText } from '@/lib/engine/claimExtractor';
import {
  extractTextFromPdfBuffer,
  extractTextFromDocxBuffer,
  cleanPdfText,
  extractKeyPointsFromPdfText,
  computeBufferSha256,
  RESUME_PARSER_VERSION
} from '@/lib/engine/pdfParser';
import { SAMPLE_CANDIDATES } from '@/lib/data/sampleResumes';
import { memoryStore } from '@/lib/db/client';
import { LLMService, LLMConfig } from '@/lib/services/llmService';
import { validateToken, extractTokenFromRequest } from '@/lib/auth/authUtils';
import { TelemetryService } from '@/lib/engine/telemetry';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const contentType = req.headers.get('content-type') || '';

    // Get optional auth for user-scoped storage
    const token = extractTokenFromRequest(req);
    const auth = token ? validateToken(token) : null;
    const userId = auth?.userId || null;
    const tenantId = (auth as any)?.tenantId || 'tenant-default';

    let rawText = '';
    let candidateName = 'Candidate';
    let presetId = '';
    let clientLLMConfig: Partial<LLMConfig> | undefined;
    let fileSha256: string | undefined;
    let isDocx = false;
    let pdfBase64: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      candidateName = (formData.get('candidateName') as string) || (file?.name ? file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ') : 'Candidate');
      const llmConfigJson = formData.get('clientLLMConfig') as string | null;

      if (llmConfigJson) {
        try { clientLLMConfig = JSON.parse(llmConfigJson); } catch {}
      }

      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Cache key includes the parser version so a parser upgrade re-parses previously seen files
        fileSha256 = `${RESUME_PARSER_VERSION}:${computeBufferSha256(buffer)}`;

        // 1. FAST DUPLICATE CACHE HIT (SRS FR-002) - Instant < 10ms response
        const cachedProfile = memoryStore.getCachedResume(fileSha256);
        if (cachedProfile) {
          await memoryStore.saveCandidate(cachedProfile, userId || undefined, tenantId);
          return NextResponse.json({
            success: true,
            profile: cachedProfile,
            cached: true,
            processingTimeMs: Date.now() - startTime,
            textLength: cachedProfile.rawExtractedText?.length || 0,
            keyPointsCount: cachedProfile.scannedKeyPoints?.length || 0,
            parserSource: cachedProfile.parserSource || 'cached_content_hash'
          });
        }

        const fileNameLower = file.name.toLowerCase();
        if (fileNameLower.endsWith('.docx') || file.type.includes('wordprocessingml')) {
          isDocx = true;
          rawText = extractTextFromDocxBuffer(buffer);
        } else if (fileNameLower.endsWith('.pdf') || file.type === 'application/pdf') {
          // Fast Spatial PDF Text Extraction
          rawText = await extractTextFromPdfBuffer(buffer);
          // Only attach Base64 if text extraction was sparse (< 40 words)
          const wordCount = rawText.split(/\s+/).filter(Boolean).length;
          if (wordCount < 40) {
            pdfBase64 = buffer.toString('base64');
          }
        } else {
          rawText = cleanPdfText(buffer.toString('utf-8'));
        }
      }
    } else {
      const body = await req.json();
      rawText = body.rawText ? cleanPdfText(body.rawText) : '';
      candidateName = body.candidateName || 'Candidate';
      presetId = body.presetId || '';
      clientLLMConfig = body.clientLLMConfig;
    }

    let profile;

    if (presetId) {
      const preset = SAMPLE_CANDIDATES.find(c => c.id === presetId);
      profile = preset || SAMPLE_CANDIDATES[0];
    } else {
      const hasUsableText = rawText && rawText.trim().length >= 20;
      const effectiveLLM = LLMService.getEffectiveConfig(clientLLMConfig);
      const canUseMultimodal = Boolean(pdfBase64 && effectiveLLM && effectiveLLM.provider === 'gemini');

      if (!hasUsableText && !canUseMultimodal) {
        return NextResponse.json({
          success: false,
          error: 'The uploaded resume could not be reliably read (unreadable or empty file). Please upload a clearer PDF/DOCX or enter text manually.'
        }, { status: 422 });
      }

      // Parallelize AI Parsing and Native Key Point Extraction
      const [aiResult, directKeyPoints] = await Promise.all([
        (async () => {
          if (effectiveLLM && (hasUsableText || canUseMultimodal)) {
            try {
              return await LLMService.parseResumeWithLLM(rawText, candidateName, effectiveLLM, pdfBase64);
            } catch (aiErr) {
              console.warn('AI Resume Parse failed, falling back to local extractor:', aiErr);
              return null;
            }
          }
          return null;
        })(),
        Promise.resolve(extractKeyPointsFromPdfText(rawText))
      ]);

      if (aiResult) {
        profile = aiResult;
      } else {
        // High-speed local cognitive claim extractor fallback (< 300ms)
        profile = extractClaimsFromText(rawText || `Resume document for ${candidateName}`, candidateName);
        profile.parserSource = isDocx ? 'docx_parser' : 'direct_pdf_parser';
      }

      // Attach raw scanned text and verbatim key points
      profile.rawExtractedText = rawText;
      profile.scannedKeyPoints = directKeyPoints;

      // Cache by SHA-256 for instant repeat lookups
      if (fileSha256) {
        memoryStore.saveCachedResume(fileSha256, profile);
      }
    }

    const processingTimeMs = Date.now() - startTime;

    // Record AI Telemetry if AI was called
    if (profile.parserSource?.startsWith('gemini') || profile.parserSource?.startsWith('openai')) {
      const usage = TelemetryService.createUsageRecord(
        'resume_parse',
        (clientLLMConfig?.provider as any) || 'gemini',
        clientLLMConfig?.model || 'gemini-3.6-flash',
        Math.round(rawText.length / 4),
        450,
        processingTimeMs,
        undefined,
        tenantId
      );
      await memoryStore.recordAIUsage(usage);
    }

    // Save candidate with userId for data isolation
    await memoryStore.saveCandidate(profile, userId || undefined, tenantId);

    // Security Audit Log (SRS Section 17)
    await memoryStore.logAuditEvent({
      tenantId,
      userId: userId || undefined,
      action: 'resume_upload',
      entityType: 'resume',
      entityId: profile.id,
      metadataJson: { name: profile.name, processingTimeMs }
    });

    return NextResponse.json({
      success: true,
      profile,
      processingTimeMs,
      textLength: rawText.length,
      keyPointsCount: profile.scannedKeyPoints?.length || 0,
      parserSource: profile.parserSource || 'direct_pdf_parser'
    });
  } catch (error: any) {
    console.error('Error parsing resume:', error);
    return NextResponse.json({ success: false, error: error.message || 'An error occurred while parsing the resume.' }, { status: 500 });
  }
}
