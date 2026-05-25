// Minimal ambient declaration for the pdf-parse library implementation entry.
// (We import the lib path directly to avoid the package's debug harness, and
// @types/pdf-parse only declares the top-level "pdf-parse" module.)
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer | Uint8Array, options?: Record<string, unknown>): Promise<PdfParseResult>;
  export default pdfParse;
}
