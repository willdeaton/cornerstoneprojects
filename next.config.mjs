/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg'],
  experimental: {
    /*
     * File uploads (project files, quote attachments, invoice PDFs) all go
     * through Server Actions, and every one of them allows up to 10 MB per
     * file. Next's default action body limit is 1 MB, which rejected anything
     * larger with a 413 before the action ever ran — so the ceiling here has
     * to clear the 10 MB the actions themselves enforce, with room for the
     * multipart overhead. Files above their own limit are still turned away by
     * the action, with a message, rather than by this.
     */
    serverActions: { bodySizeLimit: '12mb' },
  },
};

export default nextConfig;
