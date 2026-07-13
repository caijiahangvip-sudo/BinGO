import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  devIndicators: false,
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  outputFileTracingExcludes: {
    '/*': [
      './desktop-dist/**',
      './src-tauri/**',
      './dev/**',
      './logs/**',
      './reports/**',
      './.cache/**',
      './.hf-cache/**',
      './.modelscope-cache/**',
      './.torch-cache/**',
      './.uv-cache/**',
      './.uv-python/**',
      './bingo-*.log',
      './bingo-*.err.log',
    ],
  },
};

export default nextConfig;
