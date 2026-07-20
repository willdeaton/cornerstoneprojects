declare module 'html2pdf.js' {
  interface Html2PdfWorker {
    set(options: Record<string, unknown>): Html2PdfWorker;
    from(element: HTMLElement | string): Html2PdfWorker;
    save(): Promise<void>;
    /** Resolves to the rendered PDF in the requested form (e.g. 'blob'). */
    outputPdf(type?: string, options?: unknown): Promise<Blob>;
    then(onFulfilled?: (value: unknown) => unknown): Promise<unknown>;
  }
  function html2pdf(): Html2PdfWorker;
  export default html2pdf;
}
